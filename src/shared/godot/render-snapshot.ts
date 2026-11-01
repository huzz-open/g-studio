import { clonePart, validatePart, type PartAsset } from '../parts/schema'
import { buildPartModel } from '../../modules/scene-lighting/part-model'
/** Authoritative GS render geometry. Export is a serialization step, never a fit. */
export function renderSnapshot(part:PartAsset){
 validatePart(part)
 if(part.model.kind!=='mesh'||!part.model.frozen||part.model.imageFit||part.model.repair||(!part.model.original&&!part.model.registration))throw Error('A current frozen GS model is required')
 const model=buildPartModel(part,{width:0,height:0,data:new Uint8ClampedArray()})
 return {part:clonePart(part),vertices:model.vertices.slice(),triangles:model.triangles.map(t=>t.map(p=>[...p] as [number,number,number]))}
}
