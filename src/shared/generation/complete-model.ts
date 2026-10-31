import { createPart,clonePart,type PartAsset,type PartModel } from '../parts/schema'
import { initializeComparison } from '../parts/model-comparison'
import { loadImage } from '../parts/images'
import { optimizeModel } from '../parts/optimize-model'
import { saveReview } from '../parts/optimization-storage'
/** Finish the optional optimization step before publishing a generated model. */
export async function completeGeneratedModel(name:string,image:string,model:PartModel,enabled:boolean,signal:AbortSignal,frame?:PartAsset['imageFrame']){
  const bitmap=await loadImage(image)
  let part=createPart(name,{uri:image,width:bitmap.naturalWidth,height:bitmap.naturalHeight},`review:${model.mesh!.sha256}`)
  part.version=2;part.model=clonePart(model);if(frame)part.imageFrame=clonePart(frame)
  part=initializeComparison(part);part.modelComparison!.autoOptimize=enabled
  if(enabled)part=await optimizeModel(part,signal)
  if(signal.aborted)throw new DOMException('Cancelled','AbortError')
  await saveReview(part)
  return part.modelComparison!
}
