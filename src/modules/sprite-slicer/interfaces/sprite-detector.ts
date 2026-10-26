import type { Rect } from '../../../shared/types'
import type { NormalSettings } from '../../../shared/types/normal-settings'
import type { PartAsset } from '../../../shared/parts/schema'

export interface DetectedSprite {
  id: number
  rect: Rect
  imageData: ImageData
  dataUrl: string
  name: string
  normalSettings?: NormalSettings
  partAsset?: PartAsset
  /** IDs of components merged into this sprite */
  mergedFrom?: number[]
  /** Original rects before merge, for smart split restoration */
  mergedFromRects?: Rect[]
  /** ID of the parent sprite this was split from */
  splitFrom?: number
  _origDataUrl?: string
  _origRect?: Rect
  _origImageData?: ImageData
}

export interface AutoDetectOptions {
  mode: 'auto'
  mergeGap: number
  minArea: number
}

export interface GridDetectOptions {
  mode: 'grid'
  cols: number
  rows: number
  gapH: number
  gapV: number
  marginH: number
  marginV: number
}

export type DetectionOptions = AutoDetectOptions | GridDetectOptions

export interface ISpriteDetector {
  readonly id: string
  detect(imageData: ImageData, width: number, height: number, options: DetectionOptions): DetectedSprite[]
}
