import { createScene, RIGHT, UP, YAW, type SceneState } from '../../modules/scene-lighting/model'
import { add, dot, scale, type Vec3 } from '../../modules/experiments/umbrella/math'
import { TEMPLATE_IDS, type PartAsset, type TemplateId } from './schema'

/** A shape choice changes the proxy, not the authored dimensions or alignment. */
export function changePartGeometry(part: PartAsset, choice: string) {
  const size: PartAsset['geometry']['size'] = [...part.geometry.size]
  if (choice.startsWith('template:')) {
    const template = choice.slice(9) as TemplateId
    if (!TEMPLATE_IDS.includes(template)) throw new Error('Unknown geometry template')
    part.geometry = { kind: 'template', template, size }
  } else if (choice === 'silhouette' || choice === 'box' || choice === 'cylinder') {
    part.geometry = { kind: choice, size }
  }
}

export function createPartPreview(part: PartAsset): SceneState {
  return { ...createScene(), showNames: false, showSelectionRing: false,
    items: [{ id: 'preview', assetId: part.id, x: 0, z: 0, scale: 1, visible: true, casts: true, receives: true }],
    selected: 'preview', zoom: 5, light: [-2, Math.min(8, part.geometry.size[1] + 1.5), 2.5], target: [0, 1, 0],
  }
}

/** Frame the object and point-light handles together without moving either. */
export function fitPartPreview(state: SceneState, part: PartAsset, aspect = 1) {
  const item = state.items[0]
  if (!item) return
  const [w, h, d] = part.geometry.size.map(v => v * item.scale)
  const origin: Vec3 = [item.x, 0, item.z]
  const corners: Vec3[] = []
  const angle = part.geometry.kind === 'silhouette' ? YAW * Math.PI / 180 : 0
  for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) {
    corners.push([x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle)])
  }
  const points = corners.map(p => add(origin, p))
  // Include the aligned image as well as the geometry, so switching display
  // modes does not require another fit. Its height follows the renderer bounds.
  const projectedY = corners.map(p => dot(p, UP))
  const imageHeight = (Math.max(...projectedY) - Math.min(...projectedY)) * part.alignment.scale
  const imageWidth = imageHeight * part.image.width / part.image.height
  const left = -imageWidth * part.alignment.anchor[0] + part.alignment.offset[0] * item.scale
  const bottom = -imageHeight * (1 - part.alignment.anchor[1]) + part.alignment.offset[1] * item.scale
  for (const x of [left, left + imageWidth]) for (const y of [bottom, bottom + imageHeight]) {
    points.push(add(origin, add(scale(RIGHT, x), scale(UP, y))))
  }
  if (state.lightKind === 'point') points.push([...state.light], [state.light[0], 0, state.light[2]])
  const xs = points.map(p => dot(p, RIGHT)), ys = points.map(p => dot(p, UP))
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const center: Vec3 = [item.x, h / 2, item.z]
  state.target = add(center, add(scale(RIGHT, (minX + maxX) / 2 - dot(center, RIGHT)), scale(UP, (minY + maxY) / 2 - dot(center, UP))))
  // Leave space around the light handles and the bottom-left canvas controls.
  state.zoom = Math.max(4, Math.min(40, 1.3 * Math.max(maxY - minY, (maxX - minX) / Math.max(.1, aspect)) / .8))
}
