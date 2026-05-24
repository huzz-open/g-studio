import { imageDataToDataUrl, createOffscreenCanvas } from '../utils/canvas-utils'
import type { DetectedSprite } from '../../interfaces/sprite-detector'

export interface Point {
  x: number
  y: number
}

/**
 * Rasterize a line segment onto a binary mask (Bresenham's algorithm).
 */
function rasterizeLine(
  x0: number, y0: number, x1: number, y1: number,
  mask: Uint8Array, w: number, h: number,
) {
  let cx = x0, cy = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy

  while (true) {
    if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
      mask[cy * w + cx] = 1
    }
    if (cx === x1 && cy === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; cx += sx }
    if (e2 < dx) { err += dx; cy += sy }
  }
}

/**
 * Find connected regions in a w×h grid separated by polyline walls.
 * Returns an Int32Array region map (0-based region IDs, one per pixel).
 *
 * Reusable for any context: single sprite splitting, full-image splitting, etc.
 */
export function findRegionsByLines(
  w: number, h: number,
  lines: Point[][],
): Int32Array {
  const walls = new Uint8Array(w * h)

  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      rasterizeLine(
        Math.round(line[i].x), Math.round(line[i].y),
        Math.round(line[i + 1].x), Math.round(line[i + 1].y),
        walls, w, h,
      )
    }
  }

  const regionMap = new Int32Array(w * h).fill(-1)
  let regionId = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (walls[idx] || regionMap[idx] >= 0) continue

      const queue = [idx]
      regionMap[idx] = regionId
      let head = 0
      while (head < queue.length) {
        const ci = queue[head++]
        const cx = ci % w
        const cy = (ci - cx) / w
        if (cy > 0     && !walls[ci - w] && regionMap[ci - w] < 0) { regionMap[ci - w] = regionId; queue.push(ci - w) }
        if (cy < h - 1 && !walls[ci + w] && regionMap[ci + w] < 0) { regionMap[ci + w] = regionId; queue.push(ci + w) }
        if (cx > 0     && !walls[ci - 1] && regionMap[ci - 1] < 0) { regionMap[ci - 1] = regionId; queue.push(ci - 1) }
        if (cx < w - 1 && !walls[ci + 1] && regionMap[ci + 1] < 0) { regionMap[ci + 1] = regionId; queue.push(ci + 1) }
      }
      regionId++
    }
  }

  // Assign wall pixels to nearest adjacent region (forward pass)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (regionMap[idx] >= 0) continue
      if (y > 0     && regionMap[idx - w] >= 0) { regionMap[idx] = regionMap[idx - w]; continue }
      if (y < h - 1 && regionMap[idx + w] >= 0) { regionMap[idx] = regionMap[idx + w]; continue }
      if (x > 0     && regionMap[idx - 1] >= 0) { regionMap[idx] = regionMap[idx - 1]; continue }
      if (x < w - 1 && regionMap[idx + 1] >= 0) { regionMap[idx] = regionMap[idx + 1]; continue }
    }
  }
  // Reverse pass for any remaining unassigned (thick walls or corners)
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const idx = y * w + x
      if (regionMap[idx] >= 0) continue
      if (y > 0     && regionMap[idx - w] >= 0) { regionMap[idx] = regionMap[idx - w]; continue }
      if (y < h - 1 && regionMap[idx + w] >= 0) { regionMap[idx] = regionMap[idx + w]; continue }
      if (x > 0     && regionMap[idx - 1] >= 0) { regionMap[idx] = regionMap[idx - 1]; continue }
      if (x < w - 1 && regionMap[idx + 1] >= 0) { regionMap[idx] = regionMap[idx + 1]; continue }
    }
  }

  return regionMap
}

/**
 * Split a sprite into multiple sprites using polyline walls and flood fill.
 * Reads pixels directly from sprite.imageData (works correctly after auto-arrange).
 * Lines should be in global (source image) coordinates.
 */
export function splitSpriteByLines(
  sprite: DetectedSprite,
  lines: Point[][],
  nextId: number,
): DetectedSprite[] {
  const { rect } = sprite
  const srcData = sprite.imageData.data
  const srcW = rect.w

  const localLines = lines.map(line =>
    line.map(p => ({ x: p.x - rect.x, y: p.y - rect.y })),
  )

  const regionMap = findRegionsByLines(rect.w, rect.h, localLines)

  const regions = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>()

  for (let py = 0; py < rect.h; py++) {
    for (let px = 0; px < rect.w; px++) {
      const srcIdx = (py * srcW + px) * 4
      if (srcData[srcIdx + 3] < 60) continue

      const region = regionMap[py * rect.w + px]
      if (region < 0) continue

      let r = regions.get(region)
      if (!r) {
        r = { minX: px, minY: py, maxX: px, maxY: py }
        regions.set(region, r)
      } else {
        if (px < r.minX) r.minX = px
        if (py < r.minY) r.minY = py
        if (px > r.maxX) r.maxX = px
        if (py > r.maxY) r.maxY = py
      }
    }
  }

  const results: DetectedSprite[] = []
  let idCounter = nextId

  for (const [regionId, bounds] of regions) {
    const rw = bounds.maxX - bounds.minX + 1
    const rh = bounds.maxY - bounds.minY + 1
    const { ctx } = createOffscreenCanvas(rw, rh)
    const cellData = ctx.createImageData(rw, rh)
    const out = cellData.data

    for (let py = bounds.minY; py <= bounds.maxY; py++) {
      for (let px = bounds.minX; px <= bounds.maxX; px++) {
        if (regionMap[py * rect.w + px] !== regionId) continue
        const srcIdx = (py * srcW + px) * 4
        const dstIdx = ((py - bounds.minY) * rw + (px - bounds.minX)) * 4
        out[dstIdx] = srcData[srcIdx]
        out[dstIdx + 1] = srcData[srcIdx + 1]
        out[dstIdx + 2] = srcData[srcIdx + 2]
        out[dstIdx + 3] = srcData[srcIdx + 3]
      }
    }

    results.push({
      id: idCounter++,
      rect: {
        x: rect.x + bounds.minX,
        y: rect.y + bounds.minY,
        w: rw,
        h: rh,
      },
      imageData: cellData,
      dataUrl: imageDataToDataUrl(cellData, rw, rh),
      name: `${sprite.name}-${results.length + 1}`,
    })
  }

  return results
}
