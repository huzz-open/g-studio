import type { Point } from './line-splitter'

export function constrainAngle(from: Point, to: Point, shift: boolean): Point {
  if (!shift) return to
  const dx = to.x - from.x, dy = to.y - from.y
  const absDx = Math.abs(dx), absDy = Math.abs(dy)
  if (absDx > absDy * 2) return { x: to.x, y: from.y }
  if (absDy > absDx * 2) return { x: from.x, y: to.y }
  const d = Math.min(absDx, absDy)
  return { x: from.x + d * Math.sign(dx), y: from.y + d * Math.sign(dy) }
}

export function snapToBoundary(pos: Point, threshold: number, w: number, h: number): Point {
  let { x, y } = pos
  if (Math.abs(x) <= threshold) x = 0
  else if (Math.abs(x - w) <= threshold) x = w
  if (Math.abs(y) <= threshold) y = 0
  else if (Math.abs(y - h) <= threshold) y = h
  return { x, y }
}

export function clampToRect(pos: Point, w: number, h: number): Point {
  return {
    x: Math.max(0, Math.min(w, pos.x)),
    y: Math.max(0, Math.min(h, pos.y)),
  }
}

export function raySegIntersect(
  rOx: number, rOy: number, rDx: number, rDy: number,
  ax: number, ay: number, bx: number, by: number,
): number | null {
  const sdx = bx - ax, sdy = by - ay
  const denom = rDx * sdy - rDy * sdx
  if (Math.abs(denom) < 1e-10) return null
  const t = ((ax - rOx) * sdy - (ay - rOy) * sdx) / denom
  const u = ((ax - rOx) * rDy - (ay - rOy) * rDx) / denom
  if (t <= 0.01 || u < -0.001 || u > 1.001) return null
  return t
}

export function findClosestHit(
  origin: Point, dir: Point, w: number, h: number, otherLines: Point[][],
): Point | null {
  let bestT = Infinity
  let bestPt: Point | null = null
  const check = (t: number | null) => {
    if (t !== null && t < bestT) {
      bestT = t
      bestPt = { x: Math.round(origin.x + dir.x * t), y: Math.round(origin.y + dir.y * t) }
    }
  }
  check(raySegIntersect(origin.x, origin.y, dir.x, dir.y, 0, 0, w, 0))
  check(raySegIntersect(origin.x, origin.y, dir.x, dir.y, w, 0, w, h))
  check(raySegIntersect(origin.x, origin.y, dir.x, dir.y, w, h, 0, h))
  check(raySegIntersect(origin.x, origin.y, dir.x, dir.y, 0, h, 0, 0))
  for (const line of otherLines) {
    for (let i = 0; i < line.length - 1; i++) {
      check(raySegIntersect(origin.x, origin.y, dir.x, dir.y, line[i].x, line[i].y, line[i + 1].x, line[i + 1].y))
    }
  }
  return bestPt
}
