import { shallowReactive } from 'vue'
import type { PartAsset, PartGeometry } from '../parts/schema'
import type { LocalJob } from './jobs'
import { generationDatabase } from './storage'

export const generatedModels = shallowReactive(new Map<string, PartGeometry>())
const legacyModels = new Map<string, string>()
export function legacyKeysFor(modelId: string | undefined) { return [...legacyModels].filter(([,id])=>id===modelId).map(([key])=>key) }
const legacyKey = (geometry: PartGeometry) => geometry.mesh ? `${geometry.mesh.providerId}:${geometry.mesh.inputSha256}:${geometry.mesh.sha256}` : ''
export type ModelRecord = Pick<LocalJob, 'localId' | 'modelId' | 'modelRevision' | 'geometry' | 'legacyModelKeys'>

/** Legacy embedded copies gain a stable identity without changing their authored size. */
export function identifyModel(job: ModelRecord) {
  if (!job.geometry?.mesh) return
  job.modelId ??= job.geometry.mesh.modelId || job.localId
  job.modelRevision ??= job.geometry.mesh.modelRevision || 1
  if (!job.geometry.mesh.modelId) job.legacyModelKeys = [...new Set([...(job.legacyModelKeys || []), legacyKey(job.geometry)])]
  job.geometry.mesh.modelId = job.modelId
  job.geometry.mesh.modelRevision = job.modelRevision
}
export function modelRecord(job: ModelRecord): ModelRecord {
  return JSON.parse(JSON.stringify({ localId:job.localId, modelId:job.modelId, modelRevision:job.modelRevision, geometry:job.geometry, legacyModelKeys:job.legacyModelKeys }))
}
export function publishModel(job: ModelRecord) {
  identifyModel(job)
  if (!job.modelId || !job.geometry?.mesh) return
  for (const key of job.legacyModelKeys || []) legacyModels.set(key, job.modelId)
  if ((generatedModels.get(job.modelId)?.mesh?.modelRevision || 0) > (job.modelRevision || 1)) return
  generatedModels.set(job.modelId, JSON.parse(JSON.stringify(job.geometry)))
}
export function resolveModelGeometry(geometry: PartGeometry): PartGeometry {
  if (!geometry.mesh) return geometry
  const id = geometry.mesh.modelId || legacyModels.get(legacyKey(geometry))
  const latest = id ? generatedModels.get(id) : undefined
  if (!latest?.mesh || (geometry.mesh.modelId === id && geometry.mesh.modelRevision === latest.mesh.modelRevision)) return geometry
  return { ...geometry, mesh:{ ...latest.mesh } }
}
export function resolvePartModels(part: PartAsset): PartAsset {
  const geometry = resolveModelGeometry(part.geometry)
  const alternatives = part.geometryAlternatives?.map(resolveModelGeometry)
  if (geometry === part.geometry && alternatives?.every((g,i)=>g === part.geometryAlternatives![i]) !== false) return part
  return { ...part, geometry, ...(alternatives ? { geometryAlternatives:alternatives } : {}) }
}
let loading: Promise<void> | undefined
export function loadGeneratedModels() {
  return loading ??= (async () => {
    const database = await generationDatabase()
    const readAll = <T>(store: string) => new Promise<T[]>((resolve,reject)=>{
      const read = database.transaction(store).objectStore(store).getAll()
      read.onsuccess=()=>resolve(read.result); read.onerror=()=>reject(read.error)
    })
    const [jobs, models] = await Promise.all([readAll<LocalJob>('jobs'),readAll<ModelRecord>('models')])
    for (const job of jobs) if (!job.replaces) publishModel(job)
    for (const model of models) publishModel(model)
    // Keep models independently of task history, including legacy completed jobs.
    await new Promise<void>((resolve,reject)=>{
      const tx=database.transaction('models','readwrite'), store=tx.objectStore('models')
      for (const job of jobs) if (!job.replaces && job.geometry?.mesh) {
        const read=store.get(job.modelId!)
        read.onsuccess=()=>{if(!read.result)store.put(modelRecord(job))}
      }
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error)
    })
  })().catch(error=>{ loading=undefined; throw error })
}
