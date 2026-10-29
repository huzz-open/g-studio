import { RIGHT, UP, type Mesh } from './model'
import type { Vec3 } from '../experiments/umbrella/math'
import { visiblePixelBounds } from './image-fit'
import { nelderMead } from '../../shared/utils/nelder-mead'
import { contourField, symmetricChamfer } from './contour-distance'
import { visibleSurface, surfaceRetention } from './surface-visibility'

export type Pixels = { width: number; height: number; data: Uint8ClampedArray }
export interface OrientationResult { rotation: Vec3; projection: Vec3; score: number; initialScore: number; loss: number; surfaceRetention?: number; reviewRequired?: boolean; silhouetteCandidate?: {rotation:Vec3;score:number;surfaceRetention:number} }

/** World Y (heading), then X (tilt), then Z (roll), in degrees. */
export function rotationMatrix([pitch, yaw, roll]: Vec3) {
  const [x, y, z] = [pitch, yaw, roll].map(v => v * Math.PI / 180)
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z)
  return [cz * cy - sz * sx * sy, -sz * cx, cz * sy + sz * sx * cy,
    sz * cy + cz * sx * sy, cz * cx, sz * sy - cz * sx * cy,
    -cx * sy, sx, cx * cy]
}

export function rotateMesh(mesh: Mesh, rotation: Vec3): Mesh {
  const m = rotationMatrix(rotation)
  const rotate = (p: Vec3): Vec3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]]
  const vertices = mesh.vertices.slice()
  for (let i = 0; i < vertices.length; i += 9) for (const offset of [0, 3]) vertices.set(rotate(Array.from(vertices.slice(i + offset, i + offset + 3)) as Vec3), i + offset)
  return { vertices, triangles: mesh.triangles.map(tri => tri.map(rotate)) }
}

/** Union of projected triangles. No back-face culling or depth needed for a silhouette.
 * All faces participate, including small features; no triangle subsampling. */
export function rasterizeProjection(positions: Float32Array, rotation: Vec3, resolution: number, options?: { aspect: number; projection?: Vec3; margin?: number }): Uint8Array {
  const m = rotationMatrix(rotation)
  const axis = (a: Vec3) => [a[0] * m[0] + a[1] * m[3] + a[2] * m[6], a[0] * m[1] + a[1] * m[4] + a[2] * m[7], a[0] * m[2] + a[1] * m[5] + a[2] * m[8]]
  const right = axis(RIGHT), up = axis(UP), projected = new Float64Array(positions.length / 3 * 2)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    const x = right[0] * positions[i] + right[1] * positions[i + 1] + right[2] * positions[i + 2]
    const y = up[0] * positions[i] + up[1] * positions[i + 1] + up[2] * positions[i + 2]
    projected[j] = x; projected[j + 1] = y
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const mask = new Uint8Array(resolution * resolution)
  if (maxX - minX < 1e-8 || maxY - minY < 1e-8) return mask
  const [logScale, shiftX, shiftY] = options?.projection ?? [0, 0, 0]
  const aspect = options?.aspect ?? (maxX - minX) / (maxY - minY)
  const scale = Math.min(aspect / (maxX - minX), 1 / (maxY - minY)) * Math.exp(logScale)
  const margin = options?.margin ?? 0, extent = 1 - 2 * margin
  for (let i = 0; i < projected.length; i += 2) {
    projected[i] = (margin + (.5 + shiftX + (projected[i] - (minX + maxX) / 2) * scale / aspect) * extent) * resolution
    projected[i + 1] = (margin + (.5 - shiftY - (projected[i + 1] - (minY + maxY) / 2) * scale) * extent) * resolution
  }
  for (let i = 0; i < projected.length; i += 6) {
    const x = [projected[i], projected[i + 2], projected[i + 4]], y = [projected[i + 1], projected[i + 3], projected[i + 5]]
    const start = Math.max(0, Math.ceil(Math.min(...y) - .5)), end = Math.min(resolution - 1, Math.floor(Math.max(...y) - .5))
    for (let row = start; row <= end; row++) {
      const scan = row + .5
      let left = Infinity, right = -Infinity
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3
        if ((y[a] <= scan && scan < y[b]) || (y[b] <= scan && scan < y[a])) {
          const intersection = x[a] + (scan - y[a]) / (y[b] - y[a]) * (x[b] - x[a])
          left = Math.min(left, intersection); right = Math.max(right, intersection)
        }
      }
      const from = Math.max(0, Math.ceil(left - .5)), to = Math.min(resolution - 1, Math.floor(right - .5))
      if (from <= to) mask.fill(1, row * resolution + from, row * resolution + to + 1)
    }
  }
  return mask
}

export function imageSilhouette(pixels: Pixels, resolution: number, margin = 0): Uint8Array {
  const bounds = visiblePixelBounds(pixels), mask = new Uint8Array(resolution * resolution)
  const top = 1 - bounds.bottom - bounds.height
  // Four samples per cell reduce aliasing without filling holes via dilation.
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    let count = 0
    for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
      const u = ((x + dx) / resolution - margin) / (1 - 2 * margin), v = ((y + dy) / resolution - margin) / (1 - 2 * margin)
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
      const px = Math.min(pixels.width - 1, Math.floor((bounds.left + u * bounds.width) * pixels.width))
      const py = Math.min(pixels.height - 1, Math.max(0, Math.floor((top + v * bounds.height) * pixels.height)))
      if (pixels.data[(py * pixels.width + px) * 4 + 3] / 255 >= .08) count++
    }
    mask[y * resolution + x] = count >= 2 ? 1 : 0
  }
  return mask
}

export function silhouetteIoU(a: Uint8Array, b: Uint8Array) {
  let intersection = 0, union = 0
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) intersection++; if (a[i] || b[i]) union++ }
  return union ? intersection / union : 0
}


function multiply(a: number[], b: number[]) {
  return Array.from({ length: 9 }, (_, i) => { const row = Math.floor(i / 3), col = i % 3; return a[row * 3] * b[col] + a[row * 3 + 1] * b[col + 3] + a[row * 3 + 2] * b[col + 6] })
}
function matrixAngles(m: number[]): Vec3 {
  const pitch = Math.asin(Math.max(-1, Math.min(1, m[7])))
  const regular = Math.abs(Math.cos(pitch)) > 1e-7
  return [pitch, regular ? Math.atan2(-m[6], m[8]) : Math.atan2(m[2], m[0]), regular ? Math.atan2(-m[1], m[4]) : 0].map(v => v * 180 / Math.PI) as Vec3
}
/** Exponential-map increments avoid Euler-angle singularities during optimization. */
function increment(base: number[], vector: number[]): Vec3 {
  const angle = Math.hypot(...vector), [x, y, z] = vector.map(v => v / (angle || 1))
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  return matrixAngles(multiply([t*x*x+c,t*x*y-s*z,t*x*z+s*y,t*x*y+s*z,t*y*y+c,t*y*z-s*x,t*x*z-s*y,t*y*z+s*x,t*z*z+c], base))
}
function radicalInverse(n: number, base: number) {
  let value = 0, fraction = 1 / base
  while (n) { value += (n % base) * fraction; n = Math.floor(n / base); fraction /= base }
  return value
}
/** Shoemake's unit-quaternion parameterization, fed deterministic low-discrepancy
 * samples instead of randomness. Covers SO(3), with no object-class pose limits. */
function globalRotation(i: number): Vec3 {
  const u = radicalInverse(i, 2), a = 2 * Math.PI * radicalInverse(i, 3), b = 2 * Math.PI * radicalInverse(i, 5)
  const x = Math.sqrt(1-u)*Math.sin(a), y = Math.sqrt(1-u)*Math.cos(a), z = Math.sqrt(u)*Math.sin(b), w = Math.sqrt(u)*Math.cos(b)
  return matrixAngles([1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)])
}

/** Orthographic silhouette registration of a 3D similarity transform. Global
 * SO(3) sampling followed by multistart Nelder–Mead on rotation-vector increments,
 * log scale and two image-plane translations. IoU + symmetric Chamfer objective.
 * Source geometry, filenames, provider IDs and object categories play no role. */
export function findOrientation(positions: Float32Array, pixels: Pixels, initial: Vec3 = [0, 0, 0], progress: (percent: number) => void = () => {}, initialProjection: Vec3 = [0, 0, 0]): OrientationResult {
  const visible = visiblePixelBounds(pixels), aspect = visible.width * pixels.width / (visible.height * pixels.height), margin = .125
  const evaluator = (resolution: number) => {
    const target = imageSilhouette(pixels, resolution, margin), targetContour = contourField(target, resolution)
    return (rotation: Vec3, projection: Vec3): OrientationResult => {
      const mask = rasterizeProjection(positions, rotation, resolution, { aspect, projection, margin })
      const score = silhouetteIoU(mask, target), chamfer = symmetricChamfer(contourField(mask, resolution), targetContour)
      return { rotation, projection, score, initialScore: 0, loss: .7 * (1 - score) + .3 * chamfer }
    }
  }
  const coarse = evaluator(48), candidates: OrientationResult[] = [coarse(initial, initialProjection)]
  // Include cardinal coordinate frames in addition to continuous SO(3) samples.
  for (const x of [-90, 0, 90, 180]) for (const y of [-180, -90, 0, 90]) for (const z of [0, 90]) candidates.push(coarse([x,y,z], [0,0,0]))
  for (let i = 1; i <= 192; i++) { candidates.push(coarse(globalRotation(i), [0,0,0])); if (i % 8 === 0) progress(Math.round(i / 192 * 35)) }
  candidates.sort((a,b) => a.loss - b.loss)
  const seeds: OrientationResult[] = []
  for (const candidate of candidates) {
    const matrix = rotationMatrix(candidate.rotation)
    if (seeds.every(seed => { const other = rotationMatrix(seed.rotation); return matrix.reduce((sum,v,i) => sum + (v-other[i])**2,0) > .15 })) seeds.push(candidate)
    if (seeds.length === 6) break
  }
  seeds.push(candidates.find(c => c.rotation === initial)!)
  const medium = evaluator(80), refined: OrientationResult[] = []
  const optimize = (seed: OrientationResult, evaluate: ReturnType<typeof evaluator>, iterations: number, step: number) => {
    const base = rotationMatrix(seed.rotation)
    const decode = (x: number[]) => ({ rotation: increment(base, x.slice(0,3)), projection: [seed.projection[0]+x[3],seed.projection[1]+x[4],seed.projection[2]+x[5]] as Vec3 })
    const result = nelderMead(x => {
      const {rotation, projection} = decode(x)
      // Numerical search domain, independent of model units or object category.
      if (Math.abs(projection[0]) > .4 || Math.abs(projection[1]) > .25 || Math.abs(projection[2]) > .25) return 2 + projection.reduce((s,v)=>s+v*v,0)
      return evaluate(rotation, projection).loss
    }, [0,0,0,0,0,0], [step,step,step,.035,.02,.02], iterations)
    const {rotation,projection} = decode(result.x); return evaluate(rotation,projection)
  }
  for (const [i,seed] of seeds.entries()) { refined.push(optimize(seed,medium,130,.15)); progress(35+Math.round((i+1)/seeds.length*45)) }
  const fine = evaluator(160), baseline = fine(initial, initialProjection)
  refined.sort((a,b)=>a.loss-b.loss)
  const reference = visibleSurface(positions, rotationMatrix(initial))
  const fixed = nelderMead(x=>{
    if(Math.abs(x[0])>.4||Math.abs(x[1])>.25||Math.abs(x[2])>.25)return 2
    return fine(initial,x as Vec3).loss
  }, [...initialProjection],[.035,.02,.02],100)
  const fixedPose=fine(initial,fixed.x as Vec3)
  let result: OrientationResult = {...(fixedPose.loss<baseline.loss&&fixedPose.score>=baseline.score?fixedPose:baseline),surfaceRetention:1}, silhouetteBest = result
  for (const [i,seed] of refined.entries()) {
    const candidate = optimize(seed,fine,90,.025)
    candidate.surfaceRetention = surfaceRetention(reference, visibleSurface(positions,rotationMatrix(candidate.rotation)))
    if(candidate.loss<silhouetteBest.loss)silhouetteBest=candidate
    // Silhouette alone cannot establish which side of a surface is depicted.
    // Preserve most of the supplied view's visible surface by default, without
    // object labels, up-axis limits, or changing the optimization search space.
    if (candidate.surfaceRetention>=.65&&candidate.loss < result.loss && candidate.score >= baseline.score) result = candidate
    progress(80+Math.round((i+1)/refined.length*18))
  }
  // Quantization-scale improvements do not justify rotating an ambiguous object.
  if (baseline.loss - result.loss < .002) result = {...baseline,surfaceRetention:1}
  const reviewRequired = silhouetteBest.loss + .025 < result.loss
  progress(100); return {...result,initialScore:baseline.score,reviewRequired,silhouetteCandidate:{rotation:silhouetteBest.rotation,score:silhouetteBest.score,surfaceRetention:silhouetteBest.surfaceRetention??1}}
}
