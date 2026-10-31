import {clonePart,validateInstances} from '../../shared/parts/schema'
import {DEFAULT_ROOM,type SceneState} from './model'

export function parseScene(value: any): SceneState {
  if (!value || !Array.isArray(value.items)) throw new Error('Invalid scene')
  const migrated = clonePart(value)
  migrated.items = migrated.items.map((item: any) => ({ ...item, assetId: item.assetId ?? `example:${item.id}`, scale: item.scale ?? 1 }))
  validateInstances(migrated.items)
  if (!['open', 'corner'].includes(migrated.scene) || !['sprites', 'model', 'visibility'].includes(migrated.mode)
    || !['objects', 'light'].includes(migrated.tool) || typeof migrated.shadows !== 'boolean' || typeof migrated.filtered !== 'boolean'
    || !Array.isArray(migrated.light) || migrated.light.length !== 3 || !migrated.light.every((v: number) => Number.isFinite(v))
    || Math.abs(migrated.light[0]) > 40 || Math.abs(migrated.light[2]) > 40 || migrated.light[1] < .5 || migrated.light[1] > 12
    || !Number.isFinite(migrated.zoom) || migrated.zoom < 4 || migrated.zoom > 40
    || !Number.isFinite(migrated.ambient) || migrated.ambient < 0 || migrated.ambient > 1
    || !Number.isFinite(migrated.power) || migrated.power < 0 || migrated.power > 60) throw new Error('Invalid scene settings')
  const room=migrated.room??{...DEFAULT_ROOM}, lightKind=migrated.lightKind??'point', sun=migrated.sun??{azimuth:45,elevation:45,intensity:1.2}
  if(!room||!sun||!['point','directional'].includes(lightKind)
    ||!Number.isFinite(room.width)||room.width<2||room.width>24||!Number.isFinite(room.depth)||room.depth<2||room.depth>24
    ||!Number.isFinite(room.height)||room.height<.5||room.height>12||!Number.isFinite(sun.azimuth)||Math.abs(sun.azimuth)>180
    ||!Number.isFinite(sun.elevation)||sun.elevation<5||sun.elevation>85||!Number.isFinite(sun.intensity)||sun.intensity<0||sun.intensity>4)throw new Error('Invalid room or light settings')
  const selected = migrated.selected === '' || migrated.items.some((i: any) => i.id === migrated.selected) ? migrated.selected : migrated.items[0]?.id ?? ''
  if (migrated.target !== undefined && (!Array.isArray(migrated.target) || migrated.target.length !== 3 || !migrated.target.every(Number.isFinite))) throw new Error('Invalid camera target')
  return { room,lightKind,sun, showNames: migrated.showNames !== false, scene: migrated.scene, mode: migrated.mode, tool: migrated.tool, shadows: migrated.shadows, filtered: migrated.filtered,
    light: migrated.light, zoom: migrated.zoom, ambient: migrated.ambient, power: migrated.power, items: migrated.items, selected,
    ...(migrated.target === undefined ? {} : { target: migrated.target }) }
}
