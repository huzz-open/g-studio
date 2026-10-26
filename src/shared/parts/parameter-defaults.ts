import { createPart, clonePart, type PartAsset } from './schema'
import { createBuiltinParts } from './builtins'
import { buildItem, spriteBounds } from '../../modules/scene-lighting/model'
import { templateGeometry, meshExtents } from '../../modules/scene-lighting/part-geometry'
import { decodeMesh } from './mesh'

const builtins = createBuiltinParts()

/** Factory defaults, independent of the current draft or last saved edits. */
export function partParameterDefaults(part: PartAsset) {
  const builtin = builtins.find(p => p.id === part.id)
  const defaults = builtin ? clonePart(builtin) : createPart('Part defaults', part.image, part.id)
  if (part.geometry.kind === 'mesh') {
    defaults.geometry = { ...clonePart(part.geometry), size: meshExtents(decodeMesh(part.geometry.mesh!.uri)).size.map(v=>Math.max(.02,Math.min(8,v))) as [number,number,number] }
  } else if (part.geometry.kind === 'template') {
    const id = part.geometry.template!
    defaults.geometry = templateGeometry(id)
    const b = spriteBounds(buildItem(id), part.image.width / part.image.height)
    defaults.alignment = {anchor:[Math.max(0,Math.min(1,-b.left/b.width)),Math.max(0,Math.min(1,1+b.bottom/b.height))],offset:[0,0],scale:1}
  } else if (builtin) {
    const generic = createPart('Part defaults', part.image, part.id)
    defaults.geometry = generic.geometry
    defaults.alignment = generic.alignment
  }
  return defaults
}
