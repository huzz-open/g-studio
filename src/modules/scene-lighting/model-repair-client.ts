import type { Mesh } from './model'
import { cacheRepair, type ModelRepair, type RepairStats } from './model-repair'
import type { PartAsset } from '../../shared/parts/schema'
function runRepair(payload:{mesh?:Mesh;part?:PartAsset;pixels?:{width:number;height:number;data:Uint8ClampedArray};spec:ModelRepair},signal:AbortSignal):Promise<{mesh:Mesh;stats:RepairStats}>{
  if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'))
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./model-repair.worker.ts',import.meta.url),{type:'module'})
    const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort)}
    const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'))}
    signal.addEventListener('abort',abort,{once:true})
    worker.onmessage=event=>{cleanup();if(event.data.result){cacheRepair(payload.spec,event.data.result);resolve(event.data.result)}else reject(new Error(event.data.error))}
    worker.onerror=event=>{cleanup();reject(new Error(event.message||'Model repair failed'))}
    worker.postMessage(payload)
  })
}
export const computeModelRepair=(mesh:Mesh,spec:ModelRepair,signal:AbortSignal)=>runRepair({mesh,spec},signal)
export const computePartRepair=(part:PartAsset,pixels:{width:number;height:number;data:Uint8ClampedArray},spec:ModelRepair,signal:AbortSignal)=>runRepair({part,pixels,spec},signal)
