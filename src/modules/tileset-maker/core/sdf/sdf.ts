import type { EdgeProfile, Peering } from '../types'
import { mulberry32, normalRandom, gaussianFilter2D, convolve1DSame, fractalNoise, applyNoiseMasked } from './filter'

function applyEdgeStyle(sdf: Float64Array, ts: number, style: string, seed: number, amp: number): void {
  const tsf = ts
  const maskThresh = tsf * 0.3
  const rng = mulberry32(seed)

  switch (style) {
    case 'stone': {
      const noise = fractalNoise(ts, rng, 5, tsf * 0.10, 0.55)
      applyNoiseMasked(sdf, noise, tsf * 0.07 * amp, maskThresh)
      break
    }
    case 'dirt': {
      const noise = fractalNoise(ts, rng, 3, tsf * 0.14, 0.45)
      applyNoiseMasked(sdf, noise, tsf * 0.05 * amp, maskThresh)
      const particleFactor = tsf * 0.05 * amp
      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const idx = y * ts + x
          const s = sdf[idx]
          if (s > -tsf * 0.12 && s < tsf * 0.04 && rng() > 0.91) {
            sdf[idx] += particleFactor
          }
        }
      }
      break
    }
    case 'grass': {
      const colValsRaw = new Float64Array(ts)
      for (let i = 0; i < ts; i++) colValsRaw[i] = normalRandom(rng) * tsf * 0.06
      const colVals = convolve1DSame(colValsRaw, [0.2, 0.6, 0.2])

      const rowValsRaw = new Float64Array(ts)
      for (let i = 0; i < ts; i++) rowValsRaw[i] = normalRandom(rng) * tsf * 0.06
      const rowVals = convolve1DSame(rowValsRaw, [0.2, 0.6, 0.2])

      const size = ts * ts
      const noise1Data = new Float64Array(size)
      for (let i = 0; i < size; i++) noise1Data[i] = normalRandom(rng)
      const blurred1 = gaussianFilter2D(noise1Data, ts, ts, tsf * 0.15, tsf * 0.02)

      const noise2Data = new Float64Array(size)
      for (let i = 0; i < size; i++) noise2Data[i] = normalRandom(rng)
      const blurred2 = gaussianFilter2D(noise2Data, ts, ts, tsf * 0.02, tsf * 0.15)

      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const idx = y * ts + x
          if (Math.abs(sdf[idx]) < maskThresh) {
            const fine = (blurred1[idx] + blurred2[idx]) * tsf * 0.03
            sdf[idx] += (colVals[x] + rowVals[y] + fine) * amp
          }
        }
      }
      break
    }
    case 'brick': {
      const size = ts * ts
      const noiseData = new Float64Array(size)
      for (let i = 0; i < size; i++) noiseData[i] = normalRandom(rng)
      const blurred = gaussianFilter2D(noiseData, ts, ts, tsf * 0.25, tsf * 0.25)
      applyNoiseMasked(sdf, blurred, tsf * 0.012 * amp, maskThresh)
      break
    }
    case 'crystal': {
      const facetChoices = [6, 8, 10, 12]
      const nFacets = facetChoices[Math.floor(rng() * facetChoices.length)]
      const step = (2 * Math.PI) / nFacets
      const offsets = new Float64Array(nFacets)
      for (let i = 0; i < nFacets; i++) offsets[i] = normalRandom(rng) * tsf * 0.02 * amp

      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const idx = y * ts + x
          if (Math.abs(sdf[idx]) < maskThresh) {
            const xc = x - tsf / 2 + 0.5
            const yc = y - tsf / 2 + 0.5
            const angle = Math.atan2(yc, xc)
            const quantized = Math.round(angle / step) * step
            const facetNoise = (angle - quantized) * tsf * 0.05 * amp
            const facetId = ((Math.round(angle / step) % nFacets) + nFacets) % nFacets
            sdf[idx] += facetNoise + offsets[facetId]
          }
        }
      }
      break
    }
    case 'wood': {
      const rowValsRaw = new Float64Array(ts)
      for (let i = 0; i < ts; i++) rowValsRaw[i] = normalRandom(rng) * tsf * 0.05
      const rowVals = convolve1DSame(rowValsRaw, [0.25, 0.5, 0.25])

      const size = ts * ts
      const splinterData = new Float64Array(size)
      for (let i = 0; i < size; i++) splinterData[i] = normalRandom(rng)
      const splinter = gaussianFilter2D(splinterData, ts, ts, tsf * 0.02, tsf * 0.20)
      const splinterFactor = tsf * 0.035

      for (let y = 0; y < ts; y++) {
        for (let x = 0; x < ts; x++) {
          const idx = y * ts + x
          if (Math.abs(sdf[idx]) < maskThresh) {
            sdf[idx] += (rowVals[y] + splinter[idx] * splinterFactor) * amp
          }
        }
      }
      break
    }
  }
}

/**
 * Generate the SDF for a single tile variant.
 * Ported from tilegen/src/engine/sdf.rs generate_tile_sdf()
 */
export function generateTileSdf(
  peering: Peering,
  tileSize: number,
  profile: EdgeProfile,
  seed: number,
): Float64Array {
  const ts = tileSize
  const tsf = ts
  const eo = profile.edgeOffset * tsf
  const cr = profile.cornerRadius * tsf
  const ir = eo + profile.innerDepth * tsf

  const t = peering[0] === 0
  const tr = peering[1] === 0
  const r = peering[2] === 0
  const br = peering[3] === 0
  const b = peering[4] === 0
  const bl = peering[5] === 0
  const l = peering[6] === 0
  const tl = peering[7] === 0

  const sdf = new Float64Array(ts * ts)
  sdf.fill(tsf * 2)

  for (let y = 0; y < ts; y++) {
    for (let x = 0; x < ts; x++) {
      const xf = x + 0.5
      const yf = y + 0.5
      let val = sdf[y * ts + x]

      if (!t) val = Math.min(val, yf - eo)
      if (!b) val = Math.min(val, (tsf - yf) - eo)
      if (!l) val = Math.min(val, xf - eo)
      if (!r) val = Math.min(val, (tsf - xf) - eo)

      // Outer corners
      const outerCorners: [boolean, number, number, number, number][] = [
        [!t && !l, eo + cr, eo + cr, -1, -1],
        [!t && !r, tsf - eo - cr, eo + cr, 1, -1],
        [!b && !l, eo + cr, tsf - eo - cr, -1, 1],
        [!b && !r, tsf - eo - cr, tsf - eo - cr, 1, 1],
      ]
      for (const [active, ccx, ccy, sx, sy] of outerCorners) {
        if (active && cr > 0.5) {
          const dx = Math.max((xf - ccx) * sx, 0)
          const dy = Math.max((yf - ccy) * sy, 0)
          if (dx > 0 && dy > 0) {
            val = Math.min(val, cr - Math.sqrt(dx * dx + dy * dy))
          }
        }
      }

      // Inner corners
      const innerCorners: [boolean, number, number][] = [
        [t && l && !tl, 0, 0],
        [t && r && !tr, tsf, 0],
        [b && l && !bl, 0, tsf],
        [b && r && !br, tsf, tsf],
      ]
      for (const [active, cx, cy] of innerCorners) {
        if (active && ir > 0.5) {
          const dist = Math.sqrt((xf - cx) ** 2 + (yf - cy) ** 2)
          const circleSdf = dist - ir
          const bdx = cx < tsf * 0.5 ? xf : tsf - xf
          const bdy = cy < tsf * 0.5 ? yf : tsf - yf
          const cornerMask = Math.max(bdx - eo, bdy - eo)
          val = Math.min(val, Math.max(circleSdf, cornerMask))
        }
      }

      sdf[y * ts + x] = val
    }
  }

  if (profile.noiseAmp > 0.01) {
    applyEdgeStyle(sdf, ts, profile.style, seed, profile.noiseAmp)
  }

  return sdf
}
