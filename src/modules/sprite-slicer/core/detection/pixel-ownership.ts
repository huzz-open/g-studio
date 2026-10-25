import type { Rect } from '../../../../shared/types'

/** Grow all component seeds together, only through source foreground.
 * This restores eroded tips and translucent edges without copying a neighbour
 * just because its bounding box overlaps. Every pixel has at most one owner.
 */
export function restorePixelOwnership(
  rgba: Uint8ClampedArray, width: number, height: number, seeds: Int32Array,
): Int32Array {
  const owners = seeds.slice()
  const queue = new Int32Array(width * height)
  let head = 0, tail = 0
  for (let i = 0; i < owners.length; i++) {
    if (owners[i] > 0) queue[tail++] = i
  }
  function grow(alphaThreshold: number) {
    while (head < tail) {
      const p = queue[head++]
      const x = p % width, y = Math.floor(p / width)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const q = ny * width + nx
          if (owners[q] || rgba[q * 4 + 3]! <= alphaThreshold) continue
          owners[q] = owners[p]
          queue[tail++] = q
        }
      }
    }
  }
  grow(60)
  // Erosion can remove a whole thin sprite. Recover any foreground component
  // that has no seed, rather than silently losing it (also the JS fallback).
  let nextLabel = 0
  for (const label of owners) nextLabel = Math.max(nextLabel, label)
  for (let p = 0; p < owners.length; p++) {
    if (owners[p] || rgba[p * 4 + 3]! <= 60) continue
    owners[p] = ++nextLabel
    queue[tail++] = p
    grow(60)
  }
  // Assign soft edges only after every solid component has a seed.
  head = 0; tail = 0
  for (let p = 0; p < owners.length; p++) if (owners[p]) queue[tail++] = p
  grow(0)
  return owners
}

/** Merge by foreground pixel distance, never by bounding-box intersection.
 * A gap of zero leaves all labels separate. Distance is measured in pixels
 * (8-neighbour/Chebyshev distance, as in the connected-component detector).
 */
export function groupNearbyLabels(owners: Int32Array, width: number, height: number, gap: number): number[][] {
  const parent = new Map<number, number>()
  const find = (id: number): number => {
    const p = parent.get(id)!
    if (p === id) return id
    const root = find(p)
    parent.set(id, root)
    return root
  }
  for (const id of owners) if (id) parent.set(id, id)
  if (gap > 0) {
    const nearest = owners.slice()
    const distance = new Int32Array(owners.length)
    const queue = new Int32Array(owners.length)
    let head = 0, tail = 0
    // Only boundary pixels need to expand into the background.
    for (let p = 0; p < owners.length; p++) {
      if (!owners[p]) continue
      const x = p % width, y = Math.floor(p / width)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1
        || !owners[p - 1] || !owners[p + 1] || !owners[p - width] || !owners[p + width]
        || !owners[p - width - 1] || !owners[p - width + 1]
        || !owners[p + width - 1] || !owners[p + width + 1]) queue[tail++] = p
    }
    while (head < tail) {
      const p = queue[head++]
      const x = p % width, y = Math.floor(p / width)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const q = ny * width + nx
          if (nearest[q]) {
            // Do not undo erosion's split across a thin foreground bridge.
            if (nearest[p] !== nearest[q] && distance[p] + distance[q] > 0
              && distance[p] + distance[q] + 1 <= gap) {
              parent.set(find(nearest[p]!), find(nearest[q]!))
            }
          } else if (distance[p] + 1 < gap) {
            nearest[q] = nearest[p]!
            distance[q] = distance[p]! + 1
            queue[tail++] = q
          }
        }
      }
    }
  }
  const groups = new Map<number, number[]>()
  for (const label of parent.keys()) {
    const root = find(label)
    const group = groups.get(root) ?? []
    group.push(label)
    groups.set(root, group)
  }
  return [...groups.values()]
}

export interface OwnedRegion { rect: Rect; pixels: Uint8ClampedArray<ArrayBuffer> }

/** Extract each label group, retaining its original position and RGBA values. */
export function extractOwnedRegions(
  rgba: Uint8ClampedArray, width: number, owners: Int32Array, groups: number[][],
): OwnedRegion[] {
  const groupForLabel = new Map<number, number>()
  groups.forEach((labels, group) => labels.forEach(label => groupForLabel.set(label, group)))
  const bounds = groups.map(() => ({ x: Infinity, y: Infinity, right: -1, bottom: -1 }))
  for (let p = 0; p < owners.length; p++) {
    const group = groupForLabel.get(owners[p])
    if (group === undefined || rgba[p * 4 + 3] === 0) continue
    const b = bounds[group]!, x = p % width, y = Math.floor(p / width)
    b.x = Math.min(b.x, x); b.y = Math.min(b.y, y)
    b.right = Math.max(b.right, x); b.bottom = Math.max(b.bottom, y)
  }
  return bounds.map((b, group) => {
    const rect = { x: b.x, y: b.y, w: b.right - b.x + 1, h: b.bottom - b.y + 1 }
    const pixels = new Uint8ClampedArray(rect.w * rect.h * 4)
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const p = (rect.y + y) * width + rect.x + x
        if (groupForLabel.get(owners[p]) !== group) continue
        const dst = (y * rect.w + x) * 4
        pixels.set(rgba.subarray(p * 4, p * 4 + 4), dst)
      }
    }
    return { rect, pixels }
  })
}
