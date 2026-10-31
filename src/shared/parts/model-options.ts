import type { LocalJob } from '../generation/jobs'
import { clonePart, isPartModelAllowed, type PartAsset, type PartModel } from './schema'
import { resolveGeneratedModel } from '../generation/models'

export function modelKey(model: PartModel): string {
  if (model.kind === 'mesh') { const mesh = resolveGeneratedModel(model).mesh!; return `mesh:${mesh.modelId || mesh.sha256}` }
  return model.kind
}

/** Match the actual input image, including jobs created outside the part editor. */
export function matchingModelJobs(jobs: LocalJob[], inputSha256: string): LocalJob[] {
  if (!inputSha256) return []
  return jobs.filter(job => !job.resultRejected && job.model?.kind === 'mesh'
    && job.request.inputSha256 === inputSha256 && job.model.mesh?.inputSha256 === inputSha256)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function partModelOptions(part: PartAsset, jobs: LocalJob[] = []): PartModel[] {
  const options = new Map<string, PartModel>()
  // Most recent model first; saved selections retain their adjusted dimensions.
  for (const job of jobs) if (job.model?.kind === 'mesh') options.set(modelKey(job.model), job.model)
  for (const model of [...(part.modelAlternatives ?? []), part.model]) {
    if (model.kind==='mesh'&&isPartModelAllowed(part, model)) {
      const resolved=resolveGeneratedModel(model.frozen?{...model,frozen:undefined}:model)
      // Offer a newly generated source without applying the old snapshot's fit.
      const option:PartModel=model.frozen&&resolved.mesh?.sha256!==model.mesh?.sha256?{kind:'mesh',mesh:resolved.mesh,size:resolved.size,original:true}:resolved
      options.set(modelKey(model),option)
    }
  }
  return [...options.values()].sort((a, b) => Number(b.kind === 'mesh') - Number(a.kind === 'mesh'))
}

/** Keep previous models inside the asset so switching survives save/export/reload. */
export function selectPartModel(part: PartAsset, model: PartModel) {
  if (!isPartModelAllowed(part, model)) throw new Error('Unsupported model choice')
  if (modelKey(part.model) === modelKey(model)&&part.model.mesh?.sha256===model.mesh?.sha256) return
  const next = clonePart(model), previous = clonePart(part.model)
  part.modelAlternatives = (part.modelAlternatives ?? [])
    .filter(g => modelKey(g) !== modelKey(next) && modelKey(g) !== modelKey(previous))
  part.modelAlternatives.unshift(previous)
  part.modelAlternatives = part.modelAlternatives.slice(0, 32)
  part.model = next
  delete part.modelComparison
  if (next.kind === 'mesh') part.version = 2
}
