import type { ISpriteDetector, DetectedSprite, AutoDetectOptions } from '../../interfaces/sprite-detector'
import { imageDataToDataUrl } from '../utils/canvas-utils'
import { createOffscreenCanvas, padIndex } from '../utils/canvas-utils'

interface Component {
  minX: number; maxX: number; minY: number; maxY: number
  cx: number; cy: number; area: number
}

function findComponents(px: Uint8ClampedArray, w: number, h: number): Component[] {
  const visited = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  const result: Component[] = []

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (visited[idx]) continue
      if (px[idx * 4 + 3] < 60) { visited[idx] = 1; continue }

      let minX = x, maxX = x, minY = y, maxY = y
      let sumX = 0, sumY = 0, area = 0
      let qHead = 0, qTail = 0
      queue[qTail++] = idx
      visited[idx] = 1

      while (qHead < qTail) {
        const ci = queue[qHead++]
        const cx = ci % w
        const cy = (ci - cx) / w
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        sumX += cx; sumY += cy; area++

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = cx + dx, ny = cy + dy
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
            const ni = ny * w + nx
            if (visited[ni]) continue
            visited[ni] = 1
            if (px[ni * 4 + 3] < 60) continue
            queue[qTail++] = ni
          }
        }
      }

      if (area >= 10) {
        result.push({
          minX, maxX, minY, maxY,
          cx: sumX / area, cy: sumY / area, area,
        })
      }
    }
  }
  return result
}

export class CcaDetector implements ISpriteDetector {
  readonly id = 'cca'

  detect(imageData: ImageData, width: number, height: number, options: AutoDetectOptions): DetectedSprite[] {
    const px = imageData.data
    const components = findComponents(px, width, height)
      .filter(c => c.area >= options.minArea)

    components.sort((a, b) => b.area - a.area)

    const gap = options.mergeGap
    const merged: Component[] = []
    const used = new Set<number>()

    for (let i = 0; i < components.length; i++) {
      if (used.has(i)) continue
      const base = { ...components[i] }
      let changed = true
      while (changed) {
        changed = false
        for (let j = i + 1; j < components.length; j++) {
          if (used.has(j)) continue
          const o = components[j]
          const overlaps = (
            base.maxX + gap >= o.minX && o.maxX + gap >= base.minX
            && base.maxY + gap >= o.minY && o.maxY + gap >= base.minY
          )
          if (!overlaps) continue
          const total = base.area + o.area
          base.cx = (base.cx * base.area + o.cx * o.area) / total
          base.cy = (base.cy * base.area + o.cy * o.area) / total
          base.minX = Math.min(base.minX, o.minX)
          base.maxX = Math.max(base.maxX, o.maxX)
          base.minY = Math.min(base.minY, o.minY)
          base.maxY = Math.max(base.maxY, o.maxY)
          base.area = total
          used.add(j)
          changed = true
        }
      }
      merged.push(base)
    }

    const rowThreshold = 20
    merged.sort((a, b) => {
      const dy = a.minY - b.minY
      if (Math.abs(dy) > rowThreshold) return dy
      return a.minX - b.minX
    })

    const { ctx: tmpCtx } = createOffscreenCanvas(width, height)
    tmpCtx.putImageData(imageData, 0, 0)

    return merged.map((c, idx) => {
      const rect = {
        x: c.minX, y: c.minY,
        w: c.maxX - c.minX + 1,
        h: c.maxY - c.minY + 1,
      }
      const cellData = tmpCtx.getImageData(rect.x, rect.y, rect.w, rect.h)
      return {
        id: idx,
        rect,
        imageData: cellData,
        dataUrl: imageDataToDataUrl(cellData, rect.w, rect.h),
        name: `sprite-${padIndex(idx)}`,
      }
    })
  }
}
