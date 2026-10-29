import type { PartAsset } from '../../shared/parts/schema'
import { resolveModelGeometry } from '../../shared/generation/models'
import { activeRepair, buildPartGeometry } from './part-geometry'
import { cachedRepair } from './geometry-repair'
import { computePartRepair } from './geometry-repair-client'

export async function buildPartGeometryAsync(part:PartAsset,pixels:{width:number;height:number;data:Uint8ClampedArray},signal:AbortSignal){
  if(signal.aborted)throw new DOMException('Cancelled','AbortError')
  const spec=activeRepair(part)
  if(!spec)return buildPartGeometry(part,pixels)
  const cached=cachedRepair(spec);if(cached)return cached.mesh
  return (await computePartRepair({...part,geometry:resolveModelGeometry(part.geometry)},pixels,spec,signal)).mesh
}
