import type { DetectedSprite, AutoDetectOptions } from '../../interfaces/sprite-detector'
import { getCV } from '../opencv/loader'
import { imageDataToDataUrl, createOffscreenCanvas, padIndex } from '../utils/canvas-utils'

interface RawComponent {
  x: number; y: number; w: number; h: number
  area: number
  cx: number; cy: number
}

class UnionFind {
  private parent: number[]
  private rank: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = new Array(n).fill(0)
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x])
    return this.parent[x]
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b)
    if (ra === rb) return
    if (this.rank[ra] < this.rank[rb]) { this.parent[ra] = rb }
    else if (this.rank[ra] > this.rank[rb]) { this.parent[rb] = ra }
    else { this.parent[rb] = ra; this.rank[ra]++ }
  }
}

function bboxIntersectionArea(a: RawComponent, b: RawComponent): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return 0
  return (x1 - x0) * (y1 - y0)
}

const ERODE_ITERATIONS = 2
const ERODE_KERNEL_SIZE = 3
const MERGE_THRESHOLD = 0.5

export async function opencvDetect(
  imageData: ImageData,
  width: number,
  height: number,
  options: AutoDetectOptions,
): Promise<DetectedSprite[]> {
  const cv = await getCV()

  const src = cv.matFromImageData(imageData)
  const channels = new cv.MatVector()
  cv.split(src, channels)
  const alpha = channels.get(3)

  const binary = new cv.Mat()
  cv.threshold(alpha, binary, 60, 255, cv.THRESH_BINARY)

  const kernel = cv.getStructuringElement(
    cv.MORPH_ELLIPSE,
    new cv.Size(ERODE_KERNEL_SIZE, ERODE_KERNEL_SIZE),
  )
  const eroded = new cv.Mat()
  cv.erode(binary, eroded, kernel, new cv.Point(-1, -1), ERODE_ITERATIONS)

  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const centroids = new cv.Mat()
  const count = cv.connectedComponentsWithStats(eroded, labels, stats, centroids)

  const raw: RawComponent[] = []
  for (let i = 1; i < count; i++) {
    const x = stats.intAt(i, cv.CC_STAT_LEFT)
    const y = stats.intAt(i, cv.CC_STAT_TOP)
    const w = stats.intAt(i, cv.CC_STAT_WIDTH)
    const h = stats.intAt(i, cv.CC_STAT_HEIGHT)
    const area = stats.intAt(i, cv.CC_STAT_AREA)
    const cxVal = centroids.doubleAt(i, 0)
    const cyVal = centroids.doubleAt(i, 1)

    const pad = ERODE_ITERATIONS
    const ex = Math.max(0, x - pad)
    const ey = Math.max(0, y - pad)
    const ex2 = Math.min(width, x + w + pad)
    const ey2 = Math.min(height, y + h + pad)

    raw.push({
      x: ex, y: ey,
      w: ex2 - ex, h: ey2 - ey,
      area, cx: cxVal, cy: cyVal,
    })
  }

  // Cleanup OpenCV mats
  src.delete(); channels.delete(); alpha.delete()
  binary.delete(); kernel.delete(); eroded.delete()
  labels.delete(); stats.delete(); centroids.delete()

  // Auto-merge: IOSA (contour area) > threshold
  const uf = new UnionFind(raw.length)
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const inter = bboxIntersectionArea(raw[i], raw[j])
      if (inter <= 0) continue
      const smallerArea = Math.min(raw[i].area, raw[j].area)
      if (inter / smallerArea > MERGE_THRESHOLD) {
        uf.union(i, j)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < raw.length; i++) {
    const root = uf.find(i)
    const arr = groups.get(root) ?? []
    arr.push(i)
    groups.set(root, arr)
  }

  interface MergedComponent {
    x: number; y: number; w: number; h: number
    area: number; cx: number; cy: number
    sourceIds: number[]
  }

  const merged: MergedComponent[] = []
  for (const [, indices] of groups) {
    let mx = Infinity, my = Infinity, mx2 = 0, my2 = 0
    let totalArea = 0, sumCx = 0, sumCy = 0
    for (const idx of indices) {
      const c = raw[idx]
      mx = Math.min(mx, c.x)
      my = Math.min(my, c.y)
      mx2 = Math.max(mx2, c.x + c.w)
      my2 = Math.max(my2, c.y + c.h)
      totalArea += c.area
      sumCx += c.cx * c.area
      sumCy += c.cy * c.area
    }
    merged.push({
      x: mx, y: my,
      w: mx2 - mx, h: my2 - my,
      area: totalArea,
      cx: sumCx / totalArea,
      cy: sumCy / totalArea,
      sourceIds: indices.length > 1 ? indices : [],
    })
  }

  // Filter by minArea
  const filtered = merged.filter(c => c.area >= options.minArea)

  // Sort: row-based adaptive threshold, then left-to-right
  const heights = filtered.map(c => c.h)
  const avgH = heights.length > 0
    ? heights.reduce((a, b) => a + b, 0) / heights.length
    : 20
  const rowThreshold = avgH * 0.5

  filtered.sort((a, b) => {
    const dy = a.y - b.y
    if (Math.abs(dy) > rowThreshold) return dy
    return a.x - b.x
  })

  // Extract image data for each sprite
  const { ctx: tmpCtx } = createOffscreenCanvas(width, height)
  tmpCtx.putImageData(imageData, 0, 0)

  return filtered.map((c, idx) => {
    const rect = { x: c.x, y: c.y, w: c.w, h: c.h }
    const cellData = tmpCtx.getImageData(rect.x, rect.y, rect.w, rect.h)
    const sprite: DetectedSprite = {
      id: idx,
      rect,
      imageData: cellData,
      dataUrl: imageDataToDataUrl(cellData, rect.w, rect.h),
      name: `sprite-${padIndex(idx)}`,
    }
    if (c.sourceIds.length > 0) {
      sprite.mergedFrom = c.sourceIds
    }
    return sprite
  })
}
