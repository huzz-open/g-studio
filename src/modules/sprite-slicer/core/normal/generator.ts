// Third-party algorithm license and pinned revision: public/licenses/sprite-normals.txt.
import { normalSettings, type NormalSettings } from '../../../../shared/types/normal-settings'

export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }
const linear = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
function lightness(data: Uint8ClampedArray, i: number): number {
  const r = linear[data[i]], g = linear[data[i + 1]], b = linear[data[i + 2]]
  const l = Math.cbrt(0.41222146 * r + 0.53633255 * g + 0.051445995 * b)
  const m = Math.cbrt(0.2119035 * r + 0.6806995 * g + 0.10739696 * b)
  const s = Math.cbrt(0.08830246 * r + 0.28171885 * g + 0.6299787 * b)
  return 0.21045426 * l + 0.7936178 * m - 0.004072047 * s
}

function squaredLine(source: Float32Array, size: number, out: Float32Array) {
  const sites: number[] = [], starts: number[] = []
  for (let q = 0; q < size; q++) {
    if (!Number.isFinite(source[q])) continue
    let start = -Infinity
    while (sites.length) {
      const p = sites[sites.length - 1]
      start = (source[q] + q * q - source[p] - p * p) / (2 * (q - p))
      if (start > starts[starts.length - 1]) break
      sites.pop(); starts.pop()
    }
    sites.push(q); starts.push(sites.length === 1 ? -Infinity : start)
  }
  if (!sites.length) { out.fill(Infinity, 0, size); return }
  let active = 0
  for (let q = 0; q < size; q++) {
    while (active + 1 < starts.length && starts[active + 1] < q) active++
    out[q] = (q - sites[active]) ** 2 + source[sites[active]]
  }
}

export function distanceTransform(mask: Uint8Array, w: number, h: number) {
  const result = new Float32Array(w * h)
  const source = new Float32Array(Math.max(w, h)), dest = new Float32Array(source.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) source[x] = mask[y * w + x] ? Infinity : 0
    squaredLine(source, w, dest); result.set(dest.subarray(0, w), y * w)
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) source[y] = result[y * w + x]
    squaredLine(source, h, dest)
    for (let y = 0; y < h; y++) result[y * w + x] = Math.sqrt(dest[y])
  }
  return result
}

function gaussian(input: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.05) return input.slice()
  const radius = Math.ceil(sigma * 3)
  const kernel = Float32Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2))
  const sum = kernel.reduce((a, b) => a + b, 0)
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
  const horizontal = new Float32Array(input.length), result = new Float32Array(input.length)
  for (let y = 0; y < h; y++) {
    for (let offset = -radius; offset <= radius; offset++) {
      const weight = kernel[offset + radius]
      for (let x = Math.max(0, -offset); x < Math.min(w, w - offset); x++) {
        horizontal[y * w + x] += input[y * w + x + offset] * weight
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let offset = -radius; offset <= radius; offset++) {
      const row = y + offset
      if (row < 0 || row >= h) continue
      const weight = kernel[offset + radius]
      for (let x = 0; x < w; x++) result[y * w + x] += horizontal[row * w + x] * weight
    }
  }
  return result
}

function maskedGaussian(input: Float32Array, alpha: Float32Array, w: number, h: number, sigma: number) {
  const weighted = Float32Array.from(input, (v, i) => v * alpha[i])
  const numerator = gaussian(weighted, w, h, sigma), denominator = gaussian(alpha, w, h, sigma)
  for (let i = 0; i < numerator.length; i++) numerator[i] /= Math.max(1e-8, denominator[i])
  return numerator
}

export function generateNormals(image: PixelImage, options?: Partial<NormalSettings>): PixelImage {
  const s = normalSettings(options), { width, height, data } = image
  const pad = Math.ceil(3 * Math.max(s.shapeSoftness, s.detailScale * 2)) + 3
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || (width + 2 * pad) * (height + 2 * pad) > 4194304 || data.length !== width * height * 4) {
    throw new Error('Image is empty or exceeds the 4,194,304-pixel processing limit (including padding)')
  }
  const out = new Uint8ClampedArray(data.length), visited = new Uint8Array(width * height)
  for (let i = 0; i < visited.length; i++) {
    out.set([128, 128, 255, data[i * 4 + 3]], i * 4)
    if (data[i * 4 + 3] / 255 <= s.alphaThreshold) visited[i] = 1
  }
  // Process eight-connected islands independently, including diagonally joined strokes.
  for (let start = 0; start < visited.length; start++) {
    if (visited[start]) continue
    const pixels = [start]
    visited[start] = 1
    let minX = start % width, maxX = minX, minY = Math.floor(start / width), maxY = minY
    for (let cursor = 0; cursor < pixels.length; cursor++) {
      const index = pixels[cursor], x = index % width, y = Math.floor(index / width)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const neighbor = ny * width + nx
          if (!visited[neighbor]) { visited[neighbor] = 1; pixels.push(neighbor) }
        }
      }
    }
    const w = maxX - minX + 1 + 2 * pad, h = maxY - minY + 1 + 2 * pad
    const mask = new Uint8Array(w * h), alpha = new Float32Array(w * h), luminance = new Float32Array(w * h)
    let low = 1, high = 0
    const localIndex = (p: number) => (Math.floor(p / width) - minY + pad) * w + p % width - minX + pad
    for (const p of pixels) {
      const i = localIndex(p), value = lightness(data, p * 4)
      mask[i] = 1; alpha[i] = data[p * 4 + 3] / 255; luminance[i] = value
      low = Math.min(low, value); high = Math.max(high, value)
    }
    for (const p of pixels) luminance[localIndex(p)] -= (low + high) * 0.5
    const shape = distanceTransform(mask, w, h)
    for (let i = 0; i < shape.length; i++) shape[i] = s.shapeStrength * s.shapeRadius * Math.log1p(Math.max(0, shape[i] - 0.5) / s.shapeRadius)
    const combined = gaussian(shape, w, h, s.shapeSoftness)
    const fine = maskedGaussian(luminance, alpha, w, h, s.detailScale)
    const broad = maskedGaussian(luminance, alpha, w, h, s.detailScale * 2)
    for (let i = 0; i < combined.length; i++) combined[i] += s.detailStrength * (0.7 * fine[i] + 0.3 * broad[i])
    for (const p of pixels) {
      const i = localIndex(p), up = i - w, down = i + w, d = combined
      const dx = (d[up + 1] + 2 * d[i + 1] + d[down + 1] - d[up - 1] - 2 * d[i - 1] - d[down - 1]) * 0.125
      const dy = (d[down - 1] + 2 * d[down] + d[down + 1] - d[up - 1] - 2 * d[up] - d[up + 1]) * 0.125
      const x = -dx * s.normalStrength * (s.invertX ? -1 : 1)
      const y = dy * s.normalStrength * (s.normalFormat === 'directx' ? -1 : 1) * (s.invertY ? -1 : 1)
      const length = Math.hypot(x, y, 1)
      out[p * 4] = Math.round((x / length * 0.5 + 0.5) * 255)
      out[p * 4 + 1] = Math.round((y / length * 0.5 + 0.5) * 255)
      out[p * 4 + 2] = Math.round((1 / length * 0.5 + 0.5) * 255)
    }
  }
  return { width, height, data: out }
}
