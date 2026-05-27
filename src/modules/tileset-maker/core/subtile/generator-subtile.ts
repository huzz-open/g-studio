import type { TilesetLayout } from '../types'
import { TILE_PEERINGS } from '../peerings'
import { sliceSubTiles } from './slicer'
import { getSubTileForQuadrant } from './mapper'
import { replaceMagentaWithTransparent } from './magenta'

export interface SubtileOptions {
  useMagenta: boolean
  magentaTolerance: number
}

/**
 * Generate a full tileset atlas using sub-tile reassembly.
 * @param sourcePixels - RGBA of 3W×3H nine-grid source
 * @param sourceWidth - Source width (must be divisible by 6)
 * @param sourceHeight - Source height (must be divisible by 6)
 * @param layout - Atlas layout
 * @param options - Preprocessing options
 * @returns { pixels, width, height, tileW, tileH }
 */
export function generateTilesetSubtile(
  sourcePixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  layout: TilesetLayout,
  options: SubtileOptions,
): { pixels: Uint8ClampedArray; width: number; height: number; tileW: number; tileH: number } {
  let processed = sourcePixels
  if (options.useMagenta) {
    processed = replaceMagentaWithTransparent(sourcePixels, options.magentaTolerance)
  }

  const grid = sliceSubTiles(processed, sourceWidth, sourceHeight)

  const outW = layout.cols * grid.tileW
  const outH = layout.rows * grid.tileH
  const output = new Uint8ClampedArray(outW * outH * 4)

  for (const { col, row, peeringIndex } of layout.tiles) {
    const peering = TILE_PEERINGS[peeringIndex]

    const tl = getSubTileForQuadrant('tl', peering)
    const tr = getSubTileForQuadrant('tr', peering)
    const bl = getSubTileForQuadrant('bl', peering)
    const br = getSubTileForQuadrant('br', peering)

    const dx = col * grid.tileW
    const dy = row * grid.tileH

    const getSub = (coord: { row: number; col: number }) => grid.tiles[coord.row * 6 + coord.col]

    // Top-left quadrant
    copySubTile(getSub(tl), grid.halfW, grid.halfH, output, outW, dx, dy)
    // Top-right quadrant
    copySubTile(getSub(tr), grid.halfW, grid.halfH, output, outW, dx + grid.halfW, dy)
    // Bottom-left quadrant
    copySubTile(getSub(bl), grid.halfW, grid.halfH, output, outW, dx, dy + grid.halfH)
    // Bottom-right quadrant
    copySubTile(getSub(br), grid.halfW, grid.halfH, output, outW, dx + grid.halfW, dy + grid.halfH)
  }

  return { pixels: output, width: outW, height: outH, tileW: grid.tileW, tileH: grid.tileH }
}

function copySubTile(
  src: Uint8ClampedArray,
  halfW: number,
  halfH: number,
  dst: Uint8ClampedArray,
  dstStride: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < halfH; y++) {
    const srcOff = y * halfW * 4
    const dstOff = ((dy + y) * dstStride + dx) * 4
    dst.set(src.subarray(srcOff, srcOff + halfW * 4), dstOff)
  }
}
