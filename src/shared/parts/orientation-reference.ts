import type { PartModel, Triple } from './schema'

export const ORIENTATION_METHOD = 'surface-preserving-v2' as const
/** Discard obsolete automatic poses, but retain explicit user rotation edits.
 * Repeated automatic fits use the original reference, preventing gradual drift. */
export function orientationReference(model: PartModel): Triple {
  const fit=model.imageFit,auto=fit?.orientation
  if(auto?.meshSha256!==model.mesh?.sha256)return [0,0,0]
  if(fit?.rotation&&JSON.stringify(fit.rotation)!==JSON.stringify(auto?.rotation))return [...fit.rotation]
  if(auto?.method===ORIENTATION_METHOD)return [...(auto.referenceRotation??[0,0,0])]
  return [0,0,0]
}
