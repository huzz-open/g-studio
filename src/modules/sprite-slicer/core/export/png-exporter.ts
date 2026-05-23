import type { ISpriteExporter } from '../../interfaces/sprite-exporter'
import type { DetectedSprite } from '../../interfaces/sprite-detector'
import { createOffscreenCanvas } from '../utils/canvas-utils'

export class PngExporter implements ISpriteExporter {
  async exportPng(
    _sprites: DetectedSprite[],
    cleanImageData: ImageData,
  ): Promise<Blob> {
    const { canvas, ctx } = createOffscreenCanvas(cleanImageData.width, cleanImageData.height)
    ctx.putImageData(cleanImageData, 0, 0)
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
  }

  async exportZip(sprites: DetectedSprite[]): Promise<Blob> {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    for (const sprite of sprites) {
      const resp = await fetch(sprite.dataUrl)
      const blob = await resp.blob()
      const name = sprite.name.endsWith('.png') ? sprite.name : `${sprite.name}.png`
      zip.file(name, blob)
    }

    return zip.generateAsync({ type: 'blob' })
  }

  async exportMetaJson(
    sprites: DetectedSprite[],
    options?: { format?: 'generic' | 'godot-atlas' },
  ): Promise<Blob> {
    const format = options?.format ?? 'generic'

    if (format === 'godot-atlas') {
      const atlas = {
        textures: [{
          image: 'spritesheet.png',
          size: { w: 0, h: 0 },
          sprites: sprites.map(s => ({
            filename: s.name,
            region: { x: s.rect.x, y: s.rect.y, w: s.rect.w, h: s.rect.h },
          })),
        }],
      }
      return new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' })
    }

    const meta = {
      sprites: sprites.map(s => ({
        name: s.name,
        x: s.rect.x,
        y: s.rect.y,
        w: s.rect.w,
        h: s.rect.h,
      })),
    }
    return new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
  }
}
