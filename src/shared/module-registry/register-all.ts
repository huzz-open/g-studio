import { registerModuleHandler } from './index'
import { GsType } from '../gs-format/types'
import type { SceneRegionData, SpriteData, TilesetData } from '../gs-format/types'

registerModuleHandler({
  moduleId: 'scene-region-editor',
  gsType: GsType.SceneRegion,
  label: '场景区域编辑器',
  icon: 'layers',
  route: '/scene-region-editor',
  createLabel: '新建场景区域',
  fileSummary: (data: unknown) => {
    const d = data as SceneRegionData
    return `${d.regions.length} 个区域`
  },
})

registerModuleHandler({
  moduleId: 'sprite-slicer',
  gsType: GsType.Sprite,
  label: '精灵图切分',
  icon: 'scissors',
  route: '/sprite-slicer',
  createLabel: '新建精灵图切分',
  fileSummary: (data: unknown) => {
    const d = data as SpriteData
    return `${d.sprites.length} 个切片`
  },
})

registerModuleHandler({
  moduleId: 'tileset-maker',
  gsType: GsType.Tileset,
  label: '瓦片集制作',
  icon: 'grid',
  route: '/tileset-maker',
  createLabel: '新建瓦片集',
  fileSummary: (data: unknown) => {
    const d = data as TilesetData
    return `${d.terrainName} (${d.mode})`
  },
})
