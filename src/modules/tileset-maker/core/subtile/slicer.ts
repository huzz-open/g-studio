import type { CustomSplits, SubTileGrid } from '../types'

function flip180(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4
      const dstIdx = ((h - 1 - y) * w + (w - 1 - x)) * 4
      out[dstIdx] = src[srcIdx]
      out[dstIdx + 1] = src[srcIdx + 1]
      out[dstIdx + 2] = src[srcIdx + 2]
      out[dstIdx + 3] = src[srcIdx + 3]
    }
  }
  return out
}

/**
 * Slice a 3W x 3H source image into 6x6 sub-tiles,
 * plus generate 4 inner-corner tiles via flip180 of the outer corners.
 *
 * @param pixels - RGBA pixel data of the source
 * @param width - Source image width (must be divisible by 6)
 * @param height - Source image height (must be divisible by 6)
 */
export function sliceSubTiles(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): SubTileGrid {
  if (width % 6 !== 0 || height % 6 !== 0) {
    throw new Error(
      `Source image ${width}×${height} not divisible by 6. ` +
      `Need 3W×3H where W and H are even.`
    )
  }

  const halfW = width / 6
  const halfH = height / 6
  const tiles: Uint8ClampedArray[] = []

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const tile = new Uint8ClampedArray(halfW * halfH * 4)
      const sx = col * halfW
      const sy = row * halfH
      for (let y = 0; y < halfH; y++) {
        const srcOffset = ((sy + y) * width + sx) * 4
        const dstOffset = y * halfW * 4
        tile.set(pixels.subarray(srcOffset, srcOffset + halfW * 4), dstOffset)
      }
      tiles.push(tile)
    }
  }

  const innerCornerTiles: Uint8ClampedArray[] = [
    flip180(tiles[0 * 6 + 0], halfW, halfH),  // TL: flip same corner (row0,col0) → notch at inner edge (BR of sub-tile)
    flip180(tiles[0 * 6 + 5], halfW, halfH),  // TR: flip same corner (row0,col5) → notch at inner edge (BL of sub-tile)
    flip180(tiles[5 * 6 + 0], halfW, halfH),  // BL: flip same corner (row5,col0) → notch at inner edge (TR of sub-tile)
    flip180(tiles[5 * 6 + 5], halfW, halfH),  // BR: flip same corner (row5,col5) → notch at inner edge (TL of sub-tile)
  ]

  return {
    tiles,
    innerCornerTiles,
    halfW,
    halfH,
    tileW: halfW * 2,
    tileH: halfH * 2,
  }
}

/**
 * Slice with non-uniform split positions.
 * Each sub-tile region may have different source dimensions,
 * but output is normalized to uniform halfW×halfH via nearest-neighbor sampling.
 */
export function sliceSubTilesCustom(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  splits: CustomSplits,
): SubTileGrid {
  const halfW = Math.round(width / 6)
  const halfH = Math.round(height / 6)
  const tiles: Uint8ClampedArray[] = []

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const sx = splits.x[col]
      const sy = splits.y[row]
      const sw = splits.x[col + 1] - sx
      const sh = splits.y[row + 1] - sy
      const tile = new Uint8ClampedArray(halfW * halfH * 4)

      for (let dy = 0; dy < halfH; dy++) {
        const srcY = Math.min(sy + Math.round(dy * sh / halfH), height - 1)
        for (let dx = 0; dx < halfW; dx++) {
          const srcX = Math.min(sx + Math.round(dx * sw / halfW), width - 1)
          const srcIdx = (srcY * width + srcX) * 4
          const dstIdx = (dy * halfW + dx) * 4
          tile[dstIdx] = pixels[srcIdx]
          tile[dstIdx + 1] = pixels[srcIdx + 1]
          tile[dstIdx + 2] = pixels[srcIdx + 2]
          tile[dstIdx + 3] = pixels[srcIdx + 3]
        }
      }
      tiles.push(tile)
    }
  }

  const innerCornerTiles: Uint8ClampedArray[] = [
    flip180(tiles[0 * 6 + 0], halfW, halfH),
    flip180(tiles[0 * 6 + 5], halfW, halfH),
    flip180(tiles[5 * 6 + 0], halfW, halfH),
    flip180(tiles[5 * 6 + 5], halfW, halfH),
  ]

  return {
    tiles,
    innerCornerTiles,
    halfW,
    halfH,
    tileW: halfW * 2,
    tileH: halfH * 2,
  }
}
