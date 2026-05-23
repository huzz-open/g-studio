import type { DetectedSprite } from './sprite-detector'

export interface ISpriteExporter {
  exportPng(
    sprites: DetectedSprite[],
    cleanImageData: ImageData,
  ): Promise<Blob>

  exportZip(sprites: DetectedSprite[]): Promise<Blob>

  exportMetaJson(
    sprites: DetectedSprite[],
    options?: { format?: 'generic' | 'godot-atlas' },
  ): Promise<Blob>
}
