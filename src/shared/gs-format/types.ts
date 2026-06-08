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

export interface SceneRegion {
  id: string
  name: string
  type: RegionType
  groups?: string[]
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

export interface SpriteEntry {
  name: string
  rect: [number, number, number, number]
  originalRect?: [number, number, number, number]
}

export interface SliceConfig {
  detectionMode: string
  bgRemoverId?: string
  bgColor?: [number, number, number]
  bgTolerance?: number
  bgSpillStrength?: number
  mergeGap?: number
  minArea?: number
  cols?: number
  rows?: number
  gapH?: number
  gapV?: number
  marginH?: number
  marginV?: number
  arrangeMode?: 'none' | 'standardize' | 'bin-pack'
  namePrefix?: string
}

export interface SpriteData {
  texture: string
  size: [number, number]
  isComposite: boolean
  sliceConfig: SliceConfig
  sprites: SpriteEntry[]
}

export interface TilesetData {
  texture: string
  size: [number, number]
  mode: 'sdf' | 'subtile'
  layout: string
  terrainName: string
  sdfConfig?: {
    tileSize: number
    profile: {
      style: string
      edgeOffset: number
      cornerRadius: number
      innerDepth: number
      noiseAmp: number
      haloWidth: number
      borderWidth: number
      borderDarken: number
    }
  }
  subtileConfig?: {
    useMagenta: boolean
    magentaTolerance: number
  }
}

export interface GsFile<T = unknown> {
  gs: 1
  type: GsType
  gen: string
  version: number
  data: T
}

export type SceneRegionGsFile = GsFile<SceneRegionData>
export type SpriteGsFile = GsFile<SpriteData>
export type TilesetGsFile = GsFile<TilesetData>

export const GS_FORMAT_VERSION = 1 as const
