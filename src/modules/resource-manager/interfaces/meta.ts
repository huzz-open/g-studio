export type MetaResourceType = 'icon' | 'animation' | 'spritesheet' | 'map-data' | 'tile' | 'item' | 'generic'

export type OriginSource = 'uploaded' | 'derived' | 'imported' | 'external'

export type RelationType = 'derived-from' | 'produces' | 'used-by' | 'variant-of'

export interface MetaOrigin {
  source: OriginSource
  method?: string
  sourceFiles?: string[]
  createdBy: 'g-studio' | 'external'
  importedAt?: number
}

export interface PipelineStep {
  step: string
  at: number
  detail?: string
}

export interface MetaRelation {
  rel: RelationType
  uid?: string
  path?: string
}

export interface SlicerSliceConfig {
  detectionMode?: string
  bgRemoverId?: string
  bgColor?: number[]
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

export interface SlicerSpriteEntry {
  name: string
  rect: { x: number; y: number; w: number; h: number }
  originalRect?: { x: number; y: number; w: number; h: number }
}

export interface SlicerModuleData {
  sliceConfig?: SlicerSliceConfig
  sprites?: SlicerSpriteEntry[]
  isComposite?: boolean
}

export interface TilesetMakerModuleData {
  mode: 'sdf' | 'subtile'
  layout: '8x6' | '11x5'
  terrainName: string
  sdfConfig?: {
    textureUid: string
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

export interface MetaFile {
  __version: number
  uid: string

  boundFileName: string
  contentHash: string
  fileSize: number

  type: MetaResourceType
  tags?: string[]
  description?: string

  openWith?: string

  origin?: MetaOrigin
  pipeline?: PipelineStep[]
  relations?: MetaRelation[]

  moduleData?: {
    'sprite-slicer'?: SlicerModuleData
    'map-editor'?: Record<string, unknown>
    'tileset-maker'?: TilesetMakerModuleData
    [key: string]: unknown
  }

  createdAt: number
  updatedAt: number
}

export const META_VERSION = 1

export interface FsEntry {
  name: string
  kind: 'file' | 'directory'
  path: string
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  meta?: MetaFile | null
  children?: FsEntry[]
}

export interface ScanResult {
  tree: FsEntry[]
  linked: Array<{ file: FsEntry; meta: MetaFile }>
  unmatchedFiles: FsEntry[]
  orphanedMetas: Array<{ path: string; meta: MetaFile; handle: FileSystemFileHandle }>
  corruptMetas: string[]
}

export type UidIndex = Record<string, string>
