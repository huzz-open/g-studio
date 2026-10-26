import { createScene, type SceneState } from '../../modules/scene-lighting/model'
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
  return { ...createScene(),
    items: [{ id: 'preview', assetId: part.id, x: 0, z: 0, scale: 1, visible: true, casts: true, receives: true }],
    selected: 'preview', zoom: 5, light: [-2, Math.min(8, part.geometry.size[1] + 1.5), 2.5], target: [0, 1, 0],
  }
}

/** Only opening the editor or an explicit Fit action should change its camera. */
export function fitPartPreview(state: SceneState, part: PartAsset, aspect = 1) {
  const item = state.items[0]
  if (!item) return
  const [w, h, d] = part.geometry.size.map(v => v * item.scale)
  const height = h + .4 * d + .2 * w, width = Math.hypot(w, d)
  state.target = [item.x, h * .5, item.z]
  state.zoom = Math.max(4, Math.min(20, 1.25 * Math.max(height, width / Math.max(.1, aspect)) / .8))
}
