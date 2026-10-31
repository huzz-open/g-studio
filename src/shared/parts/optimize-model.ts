import { clonePart,validatePart,type PartAsset } from './schema'
import { originalVersion,storeCandidate,chooseModelVersion } from './model-comparison'
import { partPixels } from './images'
import { imageBounds, alignPartModel, buildPartModel } from '../../modules/scene-lighting/part-model'
import { orientationReference, ORIENTATION_METHOD } from './orientation-reference'
import { repairSpec } from '../../modules/scene-lighting/model-repair'
import { computeModelRepair } from '../../modules/scene-lighting/model-repair-client'
import { searchOrientation } from '../../modules/scene-lighting/orientation-client'

/** Explicit generation/postprocessing operation. Never called by viewing an asset. */
export async function optimizeModel(part:PartAsset,signal:AbortSignal,onProgress:(value:number)=>void=()=>{}):Promise<PartAsset>{
  const copy=clonePart(originalVersion(part))
  delete copy.model.original;delete copy.model.repair
  const {pixels}=await partPixels(copy),referenceRotation=orientationReference(copy.model)
  alignPartModel(copy,pixels)
  const fit=copy.model.imageFit!,source=buildPartModel({...copy,model:{...copy.model,imageFit:undefined}},pixels)
  const result=await searchOrientation(source,pixels,referenceRotation,signal,onProgress)
  fit.rotation=[...result.rotation];fit.projection=[...result.projection]
  fit.orientation={...result,rotation:[...result.rotation],projection:[...result.projection],meshSha256:copy.model.mesh!.sha256,method:ORIENTATION_METHOD,referenceRotation}
  const bounds=imageBounds(copy),spec=repairSpec(copy,pixels,[bounds.left,bounds.bottom,bounds.width,bounds.height])
  const repaired=await computeModelRepair(buildPartModel(copy,pixels),spec,signal)
  if(repaired.stats.status==='repaired'){spec.status=repaired.stats.status;copy.model.repair=spec}
  if(signal.aborted)throw new DOMException('Cancelled','AbortError')
  const next=clonePart(part);storeCandidate(next,copy);chooseModelVersion(next,'optimized');validatePart(next)
  return next
}
