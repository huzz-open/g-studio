import { registerModuleHandler } from './index'
import { GsType } from '../gs-format/types'
import type { SceneRegionData } from '../gs-format/types'

registerModuleHandler({
  moduleId: 'scene-region-editor',
  gsType: GsType.SceneRegion,
  label: '场景区域编辑器',
  icon: 'map',
  route: '/scene-region-editor',
  createLabel: '新建场景区域',
  fileSummary: (data: unknown) => {
    const d = data as SceneRegionData
    return `${d.regions.length} 个区域`
  },
})
