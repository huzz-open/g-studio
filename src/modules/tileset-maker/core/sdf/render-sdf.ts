import type { EdgeProfile, TilesetLayout } from '../types'
import { TILE_PEERINGS } from '../peerings'
import { generateTileSdf } from './sdf'

/**
 * Render a single tile from texture + SDF.
 * Returns RGBA pixel array (tileSize * tileSize * 4 bytes).
 */
export function renderTile(
  texPixels: Uint8ClampedArray,
  sdf: Float64Array,
  tileSize: number,
  profile: EdgeProfile,
): Uint8ClampedArray {
  const ts = tileSize
  const hw = profile.haloWidth * ts
  const bw = profile.borderWidth * ts
  const bd = profile.borderDarken
  const out = new Uint8ClampedArray(ts * ts * 4)

  for (let y = 0; y < ts; y++) {
    for (let x = 0; x < ts; x++) {
      const i = y * ts + x
      const s = sdf[i]
      const pi = i * 4
      const sr = texPixels[pi]
      const sg = texPixels[pi + 1]
      const sb = texPixels[pi + 2]

      if (s > 0) {
        const darken = s < bw
          ? bd * (1 - Math.min(Math.max(s / Math.max(bw, 0.1), 0), 1))
          : 0
        const factor = 1 - darken
        out[pi] = Math.min(Math.max(sr * factor, 0), 255)
        out[pi + 1] = Math.min(Math.max(sg * factor, 0), 255)
        out[pi + 2] = Math.min(Math.max(sb * factor, 0), 255)
        out[pi + 3] = 255
      } else if (s > -hw && hw > 0) {
        const haloT = Math.min(Math.max(1 + s / Math.max(hw, 0.1), 0), 1)
        out[pi] = 210
        out[pi + 1] = 210
        out[pi + 2] = 210
        out[pi + 3] = Math.min(Math.max(80 * haloT, 0), 255)
      } else {
        out[pi] = 0
        out[pi + 1] = 0
        out[pi + 2] = 0
        out[pi + 3] = 0
      }

      // Anti-aliasing
      const aa = 0.7
      if (s >= -aa && s <= aa && s <= 0) {
        const aaAlpha = ((s + aa) / (2 * aa)) * 255
        const factor = 1 - bd * 0.5
        const r = Math.min(Math.max(sr * factor, 0), 255)
        const g = Math.min(Math.max(sg * factor, 0), 255)
        const b = Math.min(Math.max(sb * factor, 0), 255)
        const newAlpha = Math.max(Math.round(aaAlpha), out[pi + 3])
        out[pi] = r
        out[pi + 1] = g
        out[pi + 2] = b
        out[pi + 3] = newAlpha
      }
    }
  }

  return out
}

/**
 * Generate a full tileset atlas using SDF mode.
 * @param texturePixels - Source texture RGBA (tileSize x tileSize)
 * @param tileSize - Tile width/height in pixels
 * @param profile - Edge profile parameters
 * @param layout - Atlas layout (8x6 or 11x5)
 * @returns Atlas RGBA buffer (layout.cols * tileSize) x (layout.rows * tileSize) x 4
 */
export function generateTilesetSdf(
  texturePixels: Uint8ClampedArray,
  tileSize: number,
  profile: EdgeProfile,
  layout: TilesetLayout,
): Uint8ClampedArray {
  const ts = tileSize
  const outW = layout.cols * ts
  const outH = layout.rows * ts
  const output = new Uint8ClampedArray(outW * outH * 4)

  for (const { col, row, peeringIndex } of layout.tiles) {
    const peering = TILE_PEERINGS[peeringIndex]
    const seed = peeringIndex * 7 + 1
    const sdf = generateTileSdf(peering, ts, profile, seed)
    const tileRgba = renderTile(texturePixels, sdf, ts, profile)

    const x0 = col * ts
    const y0 = row * ts
    for (let ty = 0; ty < ts; ty++) {
      for (let tx = 0; tx < ts; tx++) {
        const srcIdx = (ty * ts + tx) * 4
        const dstIdx = ((y0 + ty) * outW + (x0 + tx)) * 4
        const srcA = tileRgba[srcIdx + 3]
        if (srcA === 0) continue
        output[dstIdx] = tileRgba[srcIdx]
        output[dstIdx + 1] = tileRgba[srcIdx + 1]
        output[dstIdx + 2] = tileRgba[srcIdx + 2]
        output[dstIdx + 3] = srcA
      }
    }
  }

  return output
}
