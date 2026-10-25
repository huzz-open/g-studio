import type { ISpriteDetector, DetectedSprite, AutoDetectOptions } from '../../interfaces/sprite-detector'
import { spritesFromLabels } from './sprites-from-labels'

export class CcaDetector implements ISpriteDetector {
  readonly id = 'cca'

  detect(imageData: ImageData, width: number, height: number, options: AutoDetectOptions): DetectedSprite[] {
    // With no eroded seeds, the shared ownership pass labels original components.
    return spritesFromLabels(imageData, width, height, new Int32Array(width * height), options)
  }
}
