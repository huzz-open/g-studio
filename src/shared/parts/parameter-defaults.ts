import { createPart, clonePart, type PartAsset } from './schema'
import { createBuiltinParts } from './builtins'
import { meshExtents } from '../../modules/scene-lighting/part-model'
import { decodeMesh } from './mesh'


/** Factory defaults, independent of the current draft or last saved edits. */
export function partParameterDefaults(part: PartAsset) {
  const builtin = createBuiltinParts().find(p => p.id === part.id)
  const defaults = builtin ? clonePart(builtin) : createPart('Part defaults', part.image, part.id)
  if (part.model.kind === 'mesh') {
    defaults.model = { ...clonePart(part.model), size: meshExtents(decodeMesh(part.model.mesh!.uri)).size.map(v=>Math.max(.02,Math.min(8,v))) as [number,number,number] }
  } else if (builtin) {
    const generic = createPart('Part defaults', part.image, part.id)
    defaults.model = generic.model
  }
  if (part.model.imageFit) defaults.model.size = [...part.model.imageFit.size]
  if (part.model.defaultSize) defaults.model.size = [...part.model.defaultSize]
  return defaults
}
