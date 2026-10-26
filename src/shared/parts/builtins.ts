import { normalSettings } from '../types/normal-settings'
import { createPart, type PartAsset } from './schema'
import { buildItem, DEFINITIONS, spriteBounds } from '../../modules/scene-lighting/model'
import { templateGeometry } from '../../modules/scene-lighting/part-geometry'

// Stable IDs retain compatibility with previously saved scenes.
const builtinIds = new Set(DEFINITIONS.map(d => 'example:' + d.id))
export function isBuiltinPart(part: PartAsset) { return builtinIds.has(part.id) }

export function createBuiltinParts(): PartAsset[] {
  const names = ['油纸伞', '酒桶', '靠背椅', '青花瓷瓶', '木箱', '松树盆栽'], detail = [1.5, 3, 2, .6, 2, 3]
  return DEFINITIONS.map((d, i) => {
    const asset = createPart(names[i], { uri: `builtin:${d.id}`, width: d.width, height: d.height }, `example:${d.id}`)
    asset.geometry = templateGeometry(d.id); asset.normal = normalSettings({ detailStrength: detail[i] })
    const bounds = spriteBounds(buildItem(d.id), d.width / d.height)
    asset.alignment.anchor = [Math.max(0, Math.min(1, -bounds.left / bounds.width)), Math.max(0, Math.min(1, 1 + bounds.bottom / bounds.height))]
    return asset
  })
}
