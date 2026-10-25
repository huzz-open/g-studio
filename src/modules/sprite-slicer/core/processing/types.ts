import type { BgRemovalOptions } from '../../interfaces/background-remover'
import type { DetectionOptions, DetectedSprite } from '../../interfaces/sprite-detector'

export interface SliceTask {
  sourceId: number
  image: ImageData
  background: { id: string; options: BgRemovalOptions }
  detection: DetectionOptions
  arrange: 'none' | 'standardize' | 'bin-pack'
}
export interface SliceResult {
  clean: ImageData
  cleanUrl: string
  displayUrl: string
  width: number
  height: number
  sprites: DetectedSprite[]
  detector: 'opencv' | 'fallback' | 'grid'
}
