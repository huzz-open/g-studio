/** Alpha-tested, uniformly extruded silhouette above the receiver plane z = 0. */
export const SHADOW_ALPHA_CUTOFF = 0.5
export const CASTER_HEIGHT_RATIO = 0.1
export interface ShadowModel { vertices: Float32Array; edgeCount: number }

export function casterHeight(width: number, height: number) { return Math.max(width, height) * CASTER_HEIGHT_RATIO }
export function lightElevation(width: number, height: number, relativeHeight: number) {
  return Math.max(0.001, Math.max(width, height) * relativeHeight)
}

/** Perspective projection of an occluder point onto the ground from a point light.
 * Points at/above the light plane project to infinity; the GPU uses homogeneous
 * coordinates for that case instead of inventing a maximum shadow length.
 */
export function projectOntoGround(x: number, y: number, z: number, light: { x: number; y: number; z: number }) {
  if (z >= light.z) return null
  return { x: (light.z * x - z * light.x) / (light.z - z), y: (light.z * y - z * light.y) / (light.z - z) }
}

/** Merge collinear mask boundary edges. Each wall becomes two triangles whose
 * third coordinate selects the bottom (0) or top (1) of the extrusion.
 * Top and bottom caps are drawn separately as alpha-tested textured quads.
 */
export function buildShadowModel(data: Uint8ClampedArray, width: number, height: number): ShadowModel {
  if (width < 1 || height < 1 || data.length !== width * height * 4) throw new Error('Invalid shadow source')
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] / 255 >= SHADOW_ALPHA_CUTOFF ? 1 : 0
  const solid = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height ? mask[y * width + x] : 0
  const edges: number[] = []
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    if (edges.length >= 250000 * 4) throw new Error('Sprite silhouette is too complex for shadow preview')
    edges.push(x1, y1, x2, y2)
  }
  for (let y = 0; y <= height; y++) {
    let start = -1
    for (let x = 0; x <= width; x++) {
      const boundary = x < width && solid(x, y - 1) !== solid(x, y)
      if (boundary && start < 0) start = x
      else if (!boundary && start >= 0) { edge(start, y, x, y); start = -1 }
    }
  }
  for (let x = 0; x <= width; x++) {
    let start = -1
    for (let y = 0; y <= height; y++) {
      const boundary = y < height && solid(x - 1, y) !== solid(x, y)
      if (boundary && start < 0) start = y
      else if (!boundary && start >= 0) { edge(x, start, x, y); start = -1 }
    }
  }
  const vertices = new Float32Array(edges.length / 4 * 18)
  for (let e = 0; e < edges.length; e += 4) {
    const ax = edges[e], ay = edges[e + 1], bx = edges[e + 2], by = edges[e + 3]
    vertices.set([ax, ay, 0, bx, by, 0, bx, by, 1, ax, ay, 0, bx, by, 1, ax, ay, 1], e / 4 * 18)
  }
  return { vertices, edgeCount: edges.length / 4 }
}
