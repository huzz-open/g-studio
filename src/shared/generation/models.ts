import { shallowReactive } from 'vue'
import type { PartAsset, PartModel } from '../parts/schema'
import type { LocalJob } from './jobs'
import { generationDatabase } from './storage'

export const generatedModels = shallowReactive(new Map<string, PartModel>())
const legacyModels = new Map<string, string>()
export function legacyKeysFor(modelId: string | undefined) { return [...legacyModels].filter(([,id])=>id===modelId).map(([key])=>key) }
const legacyKey = (model: PartModel) => model.mesh ? `${model.mesh.providerId}:${model.mesh.inputSha256}:${model.mesh.sha256}` : ''
export type ModelRecord = Pick<LocalJob, 'localId' | 'modelId' | 'modelRevision' | 'model' | 'comparison' | 'legacyModelKeys'>

/** Legacy embedded copies gain a stable identity without changing their authored size. */
export function identifyModel(job: ModelRecord) {
  if (!job.model?.mesh) return
  job.modelId ??= job.model.mesh.modelId || job.localId
  job.modelRevision ??= job.model.mesh.modelRevision || 1
  if (!job.model.mesh.modelId) job.legacyModelKeys = [...new Set([...(job.legacyModelKeys || []), legacyKey(job.model)])]
  job.model.mesh.modelId = job.modelId
  job.model.mesh.modelRevision = job.modelRevision
}
export function modelRecord(job: ModelRecord): ModelRecord {
  return JSON.parse(JSON.stringify({ localId:job.localId, modelId:job.modelId, modelRevision:job.modelRevision, model:job.model, comparison:job.comparison, legacyModelKeys:job.legacyModelKeys }))
}
export function publishModel(job: ModelRecord) {
  identifyModel(job)
  if (!job.modelId || !job.model?.mesh) return
  for (const key of job.legacyModelKeys || []) legacyModels.set(key, job.modelId)
  if ((generatedModels.get(job.modelId)?.mesh?.modelRevision || 0) > (job.modelRevision || 1)) return
  generatedModels.set(job.modelId, JSON.parse(JSON.stringify(job.model)))
}
export function resolveGeneratedModel(model: PartModel): PartModel {
  if(model.frozen)return model
  if (!model.mesh) return model
  const id = model.mesh.modelId || legacyModels.get(legacyKey(model))
  const latest = id ? generatedModels.get(id) : undefined
  if (!latest?.mesh || (model.mesh.modelId === id && model.mesh.modelRevision === latest.mesh.modelRevision)) return model
  return { ...model, mesh:{ ...latest.mesh } }
}
export function resolvePartModels(part: PartAsset): PartAsset {
  const model = resolveGeneratedModel(part.model)
  const alternatives = part.modelAlternatives?.map(resolveGeneratedModel)
  if (model === part.model && alternatives?.every((g,i)=>g === part.modelAlternatives![i]) !== false) return part
  return { ...part, model, ...(alternatives ? { modelAlternatives:alternatives } : {}) }
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
      for (const job of jobs) if (!job.replaces && job.model?.mesh) {
        const read=store.get(job.modelId!)
        read.onsuccess=()=>{if(!read.result)store.put(modelRecord(job))}
      }
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error)
    })
  })().catch(error=>{ loading=undefined; throw error })
}
