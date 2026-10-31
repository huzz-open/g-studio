import { clonePart, type PartAsset } from './schema'
import { partPixels } from './images'
import { comparisonInputKey,repairKey } from '../../modules/scene-lighting/model-repair'
let database:Promise<IDBDatabase>|undefined
function db(){return database??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('g-studio-model-reviews',1)
  request.onupgradeneeded=()=>request.result.createObjectStore('reviews')
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)
})}
export async function reviewKey(part:PartAsset){
 const {pixels}=await partPixels(part)
 const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(pixels.data))
 const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')
 return JSON.stringify(['model-fit-v3',part.model.mesh?.sha256,hash,part.image.width,part.image.height,part.imageFrame])
}
export async function readReview(part:PartAsset){
  const database=await db(),key=await reviewKey(part)
  return new Promise<PartAsset['modelComparison']>((resolve,reject)=>{
    const request=database.transaction('reviews').objectStore('reviews').get(key)
    request.onsuccess=()=>{
      const comparison=request.result as PartAsset['modelComparison']
      if(comparison){comparison.source.mesh=clonePart(part.model.mesh!);if(comparison.candidate)comparison.candidate.mesh=clonePart(part.model.mesh!);comparison.inputKey=comparisonInputKey(part);if(comparison.candidate?.repair)comparison.candidate.repair.key=repairKey({...part,model:comparison.candidate})}
      resolve(comparison)
    };request.onerror=()=>reject(request.error)
  })
}
export async function saveReview(part:PartAsset){
  const snapshot=clonePart(part),key=await reviewKey(snapshot),comparison=snapshot.modelComparison,database=await db()
  return new Promise<void>((resolve,reject)=>{
    const tx=database.transaction('reviews','readwrite');tx.objectStore('reviews').put(comparison,key)
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error)
  })
}
