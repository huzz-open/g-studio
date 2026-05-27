/** Seeded PRNG (mulberry32) for deterministic noise */
export function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller transform for normal distribution */
export function normalRandom(rng: () => number): number {
  const u1 = rng()
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2)
}

function reflectIndex(i: number, n: number): number {
  if (i < 0) return Math.min(-i, n - 1)
  if (i >= n) return Math.max(2 * n - 2 - i, 0)
  return i
}

export function gaussianBlur1D(input: Float64Array, sigma: number): Float64Array {
  if (sigma < 0.5) return new Float64Array(input)
  const n = input.length
  if (n === 0) return new Float64Array(0)

  const radius = Math.ceil(sigma * 3)
  const kernelSize = radius * 2 + 1
  const kernel = new Float64Array(kernelSize)
  let sum = 0
  for (let i = 0; i < kernelSize; i++) {
    const x = i - radius
    kernel[i] = Math.exp((-x * x) / (2 * sigma * sigma))
    sum += kernel[i]
  }
  const invSum = 1 / sum

  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let ki = 0; ki < kernelSize; ki++) {
      const idx = reflectIndex(i + ki - radius, n)
      acc += input[idx] * kernel[ki]
    }
    out[i] = acc * invSum
  }
  return out
}

/** Separable anisotropic 2D Gaussian filter */
export function gaussianFilter2D(arr: Float64Array, rows: number, cols: number, sigmaY: number, sigmaX: number): Float64Array {
  let tmp: Float64Array

  if (sigmaX >= 0.5) {
    tmp = new Float64Array(rows * cols)
    const rowBuf = new Float64Array(cols)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) rowBuf[c] = arr[r * cols + c]
      const blurred = gaussianBlur1D(rowBuf, sigmaX)
      for (let c = 0; c < cols; c++) tmp[r * cols + c] = blurred[c]
    }
  } else {
    tmp = new Float64Array(arr)
  }

  if (sigmaY >= 0.5) {
    const out = new Float64Array(rows * cols)
    const colBuf = new Float64Array(rows)
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) colBuf[r] = tmp[r * cols + c]
      const blurred = gaussianBlur1D(colBuf, sigmaY)
      for (let r = 0; r < rows; r++) out[r * cols + c] = blurred[r]
    }
    return out
  }
  return tmp
}

export function convolve1DSame(input: Float64Array, kernel: number[]): Float64Array {
  const n = input.length
  const k = kernel.length
  const half = Math.floor(k / 2)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let ki = 0; ki < k; ki++) {
      const idx = Math.max(0, Math.min(n - 1, i + ki - half))
      acc += input[idx] * kernel[ki]
    }
    out[i] = acc
  }
  return out
}

/** Multi-octave fractal noise, normalized to [-1, 1] */
export function fractalNoise(ts: number, rng: () => number, octaves: number, baseSigma: number, persistence: number): Float64Array {
  const size = ts * ts
  const result = new Float64Array(size)
  let amp = 1.0
  let sigma = baseSigma

  for (let o = 0; o < octaves; o++) {
    const effectiveSigma = Math.max(sigma, 0.5)
    const data = new Float64Array(size)
    for (let i = 0; i < size; i++) data[i] = normalRandom(rng)
    const blurred = gaussianFilter2D(data, ts, ts, effectiveSigma, effectiveSigma)
    for (let i = 0; i < size; i++) result[i] += blurred[i] * amp
    amp *= persistence
    sigma /= 2
  }

  let peak = 0
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(result[i]))
  if (peak > 0) {
    for (let i = 0; i < size; i++) result[i] /= peak
  }
  return result
}

export function applyNoiseMasked(sdf: Float64Array, noise: Float64Array, factor: number, maskThresh: number): void {
  for (let i = 0; i < sdf.length; i++) {
    if (Math.abs(sdf[i]) < maskThresh) {
      sdf[i] += noise[i] * factor
    }
  }
}
