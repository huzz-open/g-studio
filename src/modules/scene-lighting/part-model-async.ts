import type { PartAsset } from '../../shared/parts/schema'
import { resolveGeneratedModel } from '../../shared/generation/models'
import { activeRepair, buildPartModel } from './part-model'
import { cachedRepair } from './model-repair'
import { computePartRepair } from './model-repair-client'

export async function buildPartModelAsync(part:PartAsset,pixels:{width:number;height:number;data:Uint8ClampedArray},signal:AbortSignal){
  if(signal.aborted)throw new DOMException('Cancelled','AbortError')
  const spec=activeRepair(part)
  if(!spec)return buildPartModel(part,pixels)
  const cached=cachedRepair(spec);if(cached)return cached.mesh
  return (await computePartRepair({...part,model:resolveGeneratedModel(part.model)},pixels,spec,signal)).mesh
}
