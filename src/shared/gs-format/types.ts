export const GsType = {
  SceneRegion: 1,
  Tileset: 2,
  Sprite: 3,
  WorldMap: 4,
} as const
export type GsType = (typeof GsType)[keyof typeof GsType]

export const RegionType = {
  Occlude: 1,
  Collision: 2,
} as const
export type RegionType = (typeof RegionType)[keyof typeof RegionType]

export const RegionGroup = {
  TopLayer: 1,
  YSort: 2,
  ScreenMask: 3,
  Opacity50: 4,
} as const
export type RegionGroup = (typeof RegionGroup)[keyof typeof RegionGroup]

export interface SceneRegion {
  id: string
  name: string
  type: RegionType
  groups?: RegionGroup[]
  verts?: [number, number][]
  rect?: [number, number, number, number]
}

export interface SceneRegionData {
  name: string
  texture: string
  size: [number, number]
  y_sort: boolean
  regions: SceneRegion[]
}

export interface GsFile<T = unknown> {
  gs: 1
  type: GsType
  gen: string
  version: number
  data: T
}

export type SceneRegionGsFile = GsFile<SceneRegionData>

export const GS_FORMAT_VERSION = 1 as const
