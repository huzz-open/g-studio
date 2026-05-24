import type { Rect } from '../../../../shared/types'

export interface PackInput {
  id: number
  w: number
  h: number
}

export interface PackResult {
  id: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Shelf Decreasing Height bin-packing.
 * Sorts items by height descending, places them onto horizontal shelves.
 * Returns new positions and the total canvas size needed.
 */
export function shelfPack(
  items: PackInput[],
  padding = 1,
): { packed: PackResult[]; canvasW: number; canvasH: number } {
  if (items.length === 0) return { packed: [], canvasW: 0, canvasH: 0 }

  const sorted = [...items].sort((a, b) => b.h - a.h)

  const totalArea = sorted.reduce((s, i) => s + (i.w + padding) * (i.h + padding), 0)
  const maxW = Math.max(...sorted.map(i => i.w + padding))
  const canvasW = Math.max(maxW, Math.ceil(Math.sqrt(totalArea) * 1.1))

  const packed: PackResult[] = []
  let shelfY = 0
  let shelfH = 0
  let cursorX = 0

  for (const item of sorted) {
    if (cursorX + item.w > canvasW) {
      shelfY += shelfH + padding
      shelfH = 0
      cursorX = 0
    }
    packed.push({ id: item.id, x: cursorX, y: shelfY, w: item.w, h: item.h })
    if (item.h > shelfH) shelfH = item.h
    cursorX += item.w + padding
  }

  const canvasH = shelfY + shelfH

  return { packed, canvasW, canvasH }
}

/**
 * Apply bin-packing to an array of rects, returning repositioned rects
 * and the required canvas dimensions.
 */
export function autoArrangeRects(
  rects: Rect[],
  padding = 1,
): { arranged: Rect[]; canvasW: number; canvasH: number } {
  const inputs: PackInput[] = rects.map((r, i) => ({ id: i, w: r.w, h: r.h }))
  const { packed, canvasW, canvasH } = shelfPack(inputs, padding)

  const idMap = new Map(packed.map(p => [p.id, p]))
  const arranged = rects.map((r, i) => {
    const p = idMap.get(i)
    if (!p) return { x: 0, y: 0, w: r.w, h: r.h }
    return { x: p.x, y: p.y, w: r.w, h: r.h }
  })

  return { arranged, canvasW, canvasH }
}
