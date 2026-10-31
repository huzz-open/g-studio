import { createScene, RIGHT, UP, type SceneState } from '../../modules/scene-lighting/model'
import { add, dot, scale, type Vec3 } from '../../modules/experiments/umbrella/math'
import { type PartAsset } from './schema'
import { buildPartModel, activeRepair, imageBounds } from '../../modules/scene-lighting/part-model'
import { cachedRepairBounds } from '../../modules/scene-lighting/model-repair'

export function createPartPreview(part: PartAsset): SceneState {
  return { ...createScene(), showNames: false,
    items: [{ id: 'preview', assetId: part.id, x: 0, z: 0, scale: 1, visible: true, casts: true, receives: true }],
    selected: 'preview', zoom: 5, light: [-2, Math.min(8, part.model.size[1] + 1.5), 2.5], target: [0, 1, 0],
  }
}

const maximum=(values:number[])=>values.reduce((a,b)=>Math.max(a,b),-Infinity)
const minimum=(values:number[])=>values.reduce((a,b)=>Math.min(a,b),Infinity)

/** Frame the object and point-light handles together without moving either. */
export function fitPartPreview(state: SceneState, part: PartAsset, aspect = 1) {
  const item = state.items[0]
  if (!item) return
  const [w, h, d] = part.model.size.map(v => v * item.scale)
  const origin: Vec3 = [item.x, 0, item.z]
  const corners: Vec3[] = []
  const angle = 0
  for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) {
    corners.push([x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle)])
  }
  const repair=activeRepair(part)
  const readyBounds=repair?cachedRepairBounds(repair):undefined
  if(readyBounds){
    corners.length=0
    for(const x of [readyBounds.min[0],readyBounds.max[0]])for(const y of [readyBounds.min[1],readyBounds.max[1]])for(const z of [readyBounds.min[2],readyBounds.max[2]])corners.push([x*item.scale,y*item.scale,z*item.scale])
  }else if (part.model.imageFit && part.model.kind === 'mesh' && !repair) {
    const mesh = buildPartModel(part, { width: 0, height: 0, data: new Uint8ClampedArray() })
    corners.length = 0
    for (let i = 0; i < mesh.vertices.length; i += 9) corners.push(Array.from(mesh.vertices.slice(i, i + 3)).map(v => v * item.scale) as Vec3)
  }
  const points = corners.map(p => add(origin, p))
  // Include the aligned image as well as the model, so switching display
  // modes does not require another fit. Its rectangle is independent of model bounds.
  const frame=imageBounds(part)
  const imageHeight=frame.height*item.scale,imageWidth=frame.width*item.scale
  const left=frame.left*item.scale,bottom=frame.bottom*item.scale
  for (const x of [left, left + imageWidth]) for (const y of [bottom, bottom + imageHeight]) {
    points.push(add(origin, add(scale(RIGHT, x), scale(UP, y))))
  }
  if (state.lightKind === 'point') points.push([...state.light], [state.light[0], 0, state.light[2]])
  const xs = points.map(p => dot(p, RIGHT)), ys = points.map(p => dot(p, UP))
  const minX = minimum(xs), maxX = maximum(xs), minY = minimum(ys), maxY = maximum(ys)
  const center: Vec3 = [item.x, h / 2, item.z]
  state.target = add(center, add(scale(RIGHT, (minX + maxX) / 2 - dot(center, RIGHT)), scale(UP, (minY + maxY) / 2 - dot(center, UP))))
  // Leave space around the light handles and the bottom-left canvas controls.
  state.zoom = Math.max(4, Math.min(40, 1.3 * Math.max(maxY - minY, (maxX - minX) / Math.max(.1, aspect)) / .8))
}
