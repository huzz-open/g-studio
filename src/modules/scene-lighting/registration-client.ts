import type { Pixels } from './orientation-fit'
import type { fitCameraSilhouette } from './camera-registration'
export function registerCamera(positions:Float32Array,pixels:Pixels,signal:AbortSignal,onProgress:(value:number)=>void=()=>{}):Promise<ReturnType<typeof fitCameraSilhouette>>{
 if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'))
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./registration.worker.ts',import.meta.url),{type:'module'})
  const cleanup=()=>{worker.terminate();signal.removeEventListener('abort',abort)}
  const abort=()=>{cleanup();reject(new DOMException('Cancelled','AbortError'))}
  signal.addEventListener('abort',abort,{once:true})
  worker.onmessage=event=>{if(event.data.progress!==undefined){onProgress(event.data.progress);return}cleanup();if(event.data.result)resolve(event.data.result);else reject(new Error(event.data.error||'Camera registration failed'))}
  worker.onerror=event=>{cleanup();reject(new Error(event.message||'Camera registration failed'))}
  worker.onmessageerror=()=>{cleanup();reject(new Error('Invalid registration worker response'))}
  worker.postMessage({positions,pixels},[positions.buffer])
 })
}
