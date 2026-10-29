/** Symmetric contour Chamfer distance using an eight-neighbor (1, sqrt(2))
 * distance transform. Outer edges and hole boundaries are treated identically. */
export function contourField(mask: Uint8Array, width: number) {
  const edges: number[] = [], distance = new Float64Array(mask.length).fill(Infinity)
  const height = mask.length / width
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (mask[i] && (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width])) {
      edges.push(i); distance[i] = 0
    }
  }
  const diagonal = Math.SQRT2
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1)
    if (y) distance[i] = Math.min(distance[i], distance[i - width] + 1, x ? distance[i - width - 1] + diagonal : Infinity, x + 1 < width ? distance[i - width + 1] + diagonal : Infinity)
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x
    if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 1)
    if (y + 1 < height) distance[i] = Math.min(distance[i], distance[i + width] + 1, x ? distance[i + width - 1] + diagonal : Infinity, x + 1 < width ? distance[i + width + 1] + diagonal : Infinity)
  }
  return { edges, distance, diagonal: Math.hypot(width, height) }
}
export function symmetricChamfer(a: ReturnType<typeof contourField>, b: ReturnType<typeof contourField>) {
  if (!a.edges.length || !b.edges.length) return 1
  return .5 * (a.edges.reduce((s, i) => s + b.distance[i], 0) / a.edges.length + b.edges.reduce((s, i) => s + a.distance[i], 0) / b.edges.length) / a.diagonal
}
