import { clonePart,validatePart,type PartAsset } from './schema'
import { originalVersion,storeCandidate,chooseModelVersion } from './model-comparison'
import { partPixels } from './images'
import { decodeMesh } from './mesh'
import { registerCamera } from '../../modules/scene-lighting/registration-client'
export async function optimizeModel(part:PartAsset,signal:AbortSignal,onProgress:(value:number)=>void=()=>{}):Promise<PartAsset>{
 const copy=clonePart(originalVersion(part));delete copy.model.original;delete copy.model.repair;delete copy.model.imageFit
 const {pixels}=await partPixels(copy),mesh=decodeMesh(copy.model.mesh!.uri),positions=new Float32Array(mesh.vertices.length/3)
 for(let i=0,j=0;i<mesh.vertices.length;i+=9,j+=3)positions.set(mesh.vertices.subarray(i,i+3),j)
 onProgress(0);const result=await registerCamera(positions,pixels,signal,onProgress)
 if(signal.aborted)throw new DOMException('Cancelled','AbortError')
 copy.model.registration={method:'orthographic-camera',pitch:result.pitch,yaw:result.yaw,scale:result.frame.scale,offset:result.frame.offset,width:pixels.width,height:pixels.height}
 const next=clonePart(part);storeCandidate(next,copy);chooseModelVersion(next,'optimized');validatePart(next);onProgress(100);return next
}
