import type { ISpriteDetector, DetectedSprite, GridDetectOptions } from '../../interfaces/sprite-detector'
import { createOffscreenCanvas, imageDataToDataUrl, isCellEmpty, padIndex } from '../utils/canvas-utils'

export class GridDetector implements ISpriteDetector {
  readonly id = 'grid'

  detect(imageData: ImageData, width: number, height: number, options: GridDetectOptions): DetectedSprite[] {
    const { cols, rows, gapH, gapV, marginH, marginV } = options

    const cellW = Math.floor((width - 2 * marginH - (cols - 1) * gapH) / cols)
    const cellH = Math.floor((height - 2 * marginV - (rows - 1) * gapV) / rows)

    if (cellW <= 0 || cellH <= 0) return []

    const { ctx: tmpCtx } = createOffscreenCanvas(width, height)
    tmpCtx.putImageData(imageData, 0, 0)

    const result: DetectedSprite[] = []
    let idx = 0

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = marginH + col * (cellW + gapH)
        const y = marginV + row * (cellH + gapV)
        if (x + cellW > width || y + cellH > height) { idx++; continue }

        const cellData = tmpCtx.getImageData(x, y, cellW, cellH)
        if (isCellEmpty(cellData)) { idx++; continue }

        result.push({
          id: idx,
          rect: { x, y, w: cellW, h: cellH },
          imageData: cellData,
          dataUrl: imageDataToDataUrl(cellData, cellW, cellH),
          name: `sprite-${padIndex(idx)}`,
        })
        idx++
      }
    }

    return result
  }
}
