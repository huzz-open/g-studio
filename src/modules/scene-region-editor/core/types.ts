export type RegionType = 'occlude' | 'collision'

export interface SceneRegion {
  id: string
  name: string
  type: RegionType
  vertices: [number, number][]
  createdAs: 'rect' | 'polygon'
  verticesEdited: boolean
  groups: string[]
  color: string
  colorManuallySet: boolean
  visible: boolean
}

export interface RegionPreset {
  id: string
  name: string
  type: RegionType
  groups: string[]
  color: string
}

export interface SceneRegionData {
  version: '1.0'
  imageSize: { w: number; h: number }
  regions: SceneRegion[]
}
