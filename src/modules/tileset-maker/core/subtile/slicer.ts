import type { SubTileGrid } from '../types'

/**
 * Slice a 3W x 3H source image into 6x6 sub-tiles.
 * Source must have dimensions divisible by 6.
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

  return {
    tiles,
    halfW,
    halfH,
    tileW: halfW * 2,
    tileH: halfH * 2,
  }
}
