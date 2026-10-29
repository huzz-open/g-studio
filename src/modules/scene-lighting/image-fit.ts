import { FORWARD, RIGHT, UP, type Mesh } from './model'
import { dot, normalize, type Vec3 } from '../experiments/umbrella/math'

/** Similarity registration preserves proportions in all three dimensions.
 * The affine branch only reads older saved fits; source GLB bytes are unchanged. */
export function fitMeshProjection(mesh: Mesh, target: [number, number, number, number], ratios: Vec3, similarity = false, projection: Vec3 = [0, 0, 0]): Mesh {
  let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity
  for (let i = 0; i < mesh.vertices.length; i += 9) {
    const p = Array.from(mesh.vertices.slice(i, i + 3)) as Vec3
    const x = dot(p, RIGHT), y = dot(p, UP)
    left = Math.min(left, x); right = Math.max(right, x)
    bottom = Math.min(bottom, y); top = Math.max(top, y)
  }
  if (right - left < 1e-8 || top - bottom < 1e-8) throw new Error('Cannot align a degenerate model projection')
  const uniform = Math.min(target[2] / (right - left), target[3] / (top - bottom)) * Math.exp(projection[0])
  const sx = similarity ? uniform : target[2] / (right - left), sy = similarity ? uniform : target[3] / (top - bottom), sz = similarity ? uniform : 1
  const tx = target[0] + target[2] * (.5 + projection[1]) - (left + right) / 2 * sx
  const ty = target[1] + target[3] * (.5 + projection[2]) - (bottom + top) / 2 * sy
  const transform = (p: Vec3): Vec3 => {
    const x = dot(p, RIGHT) * sx + tx, y = dot(p, UP) * sy + ty, z = dot(p, FORWARD) * sz
    return RIGHT.map((v, j) => v * x + UP[j] * y + FORWARD[j] * z) as Vec3
  }
  // Translate along the viewing ray to restore ground contact without changing
  // the registered projection. The lighting camera has a nonzero pitch.
  let minY = Infinity
  for (let i = 0; i < mesh.vertices.length; i += 9) minY = Math.min(minY, transform(Array.from(mesh.vertices.slice(i, i + 3)) as Vec3)[1])
  const depthShift = -minY / FORWARD[1]
  const point = (p: Vec3): Vec3 => transform(p).map((v, j) => (v + FORWARD[j] * depthShift) * ratios[j]) as Vec3
  const vertices = mesh.vertices.slice()
  for (let i = 0; i < vertices.length; i += 9) {
    vertices.set(point(Array.from(mesh.vertices.slice(i, i + 3)) as Vec3), i)
    const n = Array.from(mesh.vertices.slice(i + 3, i + 6)) as Vec3
    const x = dot(n, RIGHT) / sx, y = dot(n, UP) / sy, z = dot(n, FORWARD) / sz
    vertices.set(normalize(RIGHT.map((v, j) => (v * x + UP[j] * y + FORWARD[j] * z) / ratios[j]) as Vec3), i + 3)
  }
  return { vertices, triangles: mesh.triangles.map(tri => tri.map(point)) }
}

/** Pixel edges, not pixel centers. Match the renderer's alpha discard (0.08). */
export function visiblePixelBounds(pixels: { width: number; height: number; data: Uint8ClampedArray }) {
  let left = pixels.width, top = pixels.height, right = 0, bottom = 0
  for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
    if (pixels.data[(y * pixels.width + x) * 4 + 3] / 255 < .08) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1)
  }
  if (right <= left || bottom <= top) throw new Error('Image has no visible pixels')
  return { left: left / pixels.width, bottom: 1 - bottom / pixels.height, width: (right - left) / pixels.width, height: (bottom - top) / pixels.height }
}
