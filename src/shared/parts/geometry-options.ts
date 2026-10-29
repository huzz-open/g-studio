import type { LocalJob } from '../generation/jobs'
import { clonePart, isPartGeometryAllowed, partTemplate, type PartAsset, type PartGeometry } from './schema'
import { changePartGeometry } from './preview-state'
import { resolveModelGeometry } from '../generation/models'

export function geometryKey(geometry: PartGeometry): string {
  if (geometry.kind === 'mesh') { const mesh = resolveModelGeometry(geometry).mesh!; return `mesh:${mesh.modelId || mesh.sha256}` }
  if (geometry.kind === 'template') return `template:${geometry.template}`
  return geometry.kind
}

/** Match the actual input image, including jobs created outside the part editor. */
export function matchingModelJobs(jobs: LocalJob[], inputSha256: string): LocalJob[] {
  if (!inputSha256) return []
  return jobs.filter(job => !job.resultRejected && job.geometry?.kind === 'mesh'
    && job.request.inputSha256 === inputSha256 && job.geometry.mesh?.inputSha256 === inputSha256)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function partGeometryOptions(part: PartAsset, jobs: LocalJob[] = []): PartGeometry[] {
  const options = new Map<string, PartGeometry>()
  // Most recent model first; saved selections retain their adjusted dimensions.
  for (const job of jobs) if (job.geometry?.kind === 'mesh') options.set(geometryKey(job.geometry), job.geometry)
  for (const geometry of [...(part.geometryAlternatives ?? []), part.geometry]) {
    if (isPartGeometryAllowed(part, geometry)) {
      const resolved=resolveModelGeometry(geometry.frozen?{...geometry,frozen:undefined}:geometry)
      // Offer a newly generated source without applying the old snapshot's fit.
      const option:PartGeometry=geometry.frozen&&resolved.mesh?.sha256!==geometry.mesh?.sha256?{kind:'mesh',mesh:resolved.mesh,size:resolved.size,original:true}:resolved
      options.set(geometryKey(geometry),option)
    }
  }
  const choices = ['silhouette']
  const template = partTemplate(part)
  if (template) choices.push(`template:${template}`)
  for (const choice of choices) if (!options.has(choice)) {
    const copy = { ...part }
    changePartGeometry(copy, choice)
    options.set(choice, copy.geometry)
  }
  return [...options.values()].sort((a, b) => Number(b.kind === 'mesh') - Number(a.kind === 'mesh'))
}

/** Keep previous models inside the asset so switching survives save/export/reload. */
export function selectPartGeometry(part: PartAsset, geometry: PartGeometry) {
  if (!isPartGeometryAllowed(part, geometry)) throw new Error('Unsupported geometry choice')
  if (geometryKey(part.geometry) === geometryKey(geometry)&&part.geometry.mesh?.sha256===geometry.mesh?.sha256) return
  const next = clonePart(geometry), previous = clonePart(part.geometry)
  part.geometryAlternatives = (part.geometryAlternatives ?? [])
    .filter(g => geometryKey(g) !== geometryKey(next) && geometryKey(g) !== geometryKey(previous))
  part.geometryAlternatives.unshift(previous)
  part.geometryAlternatives = part.geometryAlternatives.slice(0, 32)
  part.geometry = next
  delete part.modelComparison
  if (next.kind === 'mesh') part.version = 2
}
