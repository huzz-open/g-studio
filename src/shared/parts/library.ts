import { shallowReactive, ref, watch, type Ref } from 'vue'
import { generatedModels, loadGeneratedModels, resolvePartModels } from '../generation/models'
import { clonePart, validatePart, sameSource, nextPartRevision, type PartAsset } from './schema'
import { createBuiltinParts } from './builtins'

const hotState=import.meta.hot?.data
export const partLibrary: Record<string, PartAsset> = hotState?.partLibrary ?? shallowReactive<Record<string, PartAsset>>({})
export const libraryReady: Ref<boolean> = hotState?.libraryReady ?? ref(false)
export const libraryError: Ref<string> = hotState?.libraryError ?? ref('')
let loading: Promise<void> | undefined = hotState?.loading, database: Promise<IDBDatabase> | undefined
let writes: Promise<unknown> = Promise.resolve()
if(import.meta.hot)import.meta.hot.dispose(data=>Object.assign(data,{partLibrary,libraryReady,libraryError,loading}))
watch(() => [...generatedModels.values()], () => {
  for (const [id, part] of Object.entries(partLibrary)) partLibrary[id] = resolvePartModels(part)
}, { flush:'sync' })
function db() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('g-studio-parts-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Part library is blocked by another browser tab'))
  })
}
async function readAll(): Promise<PartAsset[]> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const request = database.transaction('assets').objectStore('assets').getAll()
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
}
async function put(parts: PartAsset[]) {
  const database = await db()
  const resolved:PartAsset[]=[]
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('assets', 'readwrite'),store=tx.objectStore('assets')
    for (const part of parts) {
      const read=store.get(part.id)
      read.onsuccess=()=>{const disk=read.result as PartAsset|undefined;if(disk&&disk.revision>=part.revision)resolved.push(disk);else{const copy=clonePart(part);store.put(copy);resolved.push(copy)}}
    }
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Part library write failed'))
  })
  return resolved
}
export function loadPartLibrary() {
  return loading ??= (async () => {
    await loadGeneratedModels()
    for (const part of createBuiltinParts()) partLibrary[part.id] = part
    try {
      for (const part of await readAll()) { try { validatePart(part); partLibrary[part.id] = resolvePartModels(part) } catch { /* Reject only the damaged entry. */ } }
    } catch (e) { libraryError.value = String(e) }
    libraryReady.value = true
  })()
}
export async function savePart(part: PartAsset, expectedRevision?: number): Promise<PartAsset> {
  await loadPartLibrary(); part = resolvePartModels(part); validatePart(part)
  const operation = writes.then(async () => {
    const current = partLibrary[part.id]
    if (expectedRevision !== undefined && current?.revision !== expectedRevision) throw new Error('部件已在其他编辑中更新，请关闭并重新打开后再修改。')
    const database = await db()
    const saved = await new Promise<PartAsset>((resolve, reject) => {
      const tx = database.transaction('assets', 'readwrite'), store = tx.objectStore('assets'), read = store.get(part.id)
      let result: PartAsset, failure: Error | undefined
      read.onsuccess = () => {
        const disk = read.result as PartAsset | undefined
        if (expectedRevision !== undefined && disk && disk.revision !== expectedRevision) {
          partLibrary[disk.id] = disk; failure = new Error('部件已有其他页面保存的新版本，请重新打开。'); tx.abort(); return
        }
        let revision:number
        try { revision=nextPartRevision(part.revision,current||disk?Math.max(current?.revision??0,disk?.revision??0):undefined) }
        catch(error){failure=error as Error;tx.abort();return}
        result = clonePart({ ...part, revision })
        store.put(result)
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('Part library write failed'))
    })
    partLibrary[saved.id] = saved; libraryError.value = ''; return saved
  })
  writes = operation.catch(() => undefined)
  return operation
}
/** A saved sheet can hydrate the library. Never overwrite a newer canonical revision. */
export async function hydrateParts(parts: PartAsset[]) {
  await loadPartLibrary(); parts.forEach(validatePart)
  const operation = writes.then(async () => {
    const incoming = parts.filter(p => !partLibrary[p.id] || p.revision > partLibrary[p.id].revision).map(clonePart)
    if (!incoming.length) return
    const resolved=await put(incoming); resolved.forEach(p => { partLibrary[p.id] = resolvePartModels(p) })
  })
  writes = operation.catch(() => undefined); return operation
}
export function findSourcePart(source: NonNullable<PartAsset['source']>) { return Object.values(partLibrary).find(p => sameSource(p, source)) }
export async function importPart(value: unknown) {
  validatePart(value); await loadPartLibrary()
  const imported = clonePart(value), existing = partLibrary[imported.id]
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(imported)) return existing
    imported.id = crypto.randomUUID(); imported.revision = 1
  }
  return savePart(imported)
}
