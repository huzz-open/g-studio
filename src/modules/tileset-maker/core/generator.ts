import type { CustomSplits, EdgeProfile, TilesetLayout } from './types'
import { generateTilesetSdf } from './sdf/render-sdf'
import { generateTilesetSubtile } from './subtile/generator-subtile'

export interface SdfGenerateInput {
  mode: 'sdf'
  texturePixels: Uint8ClampedArray
  tileSize: number
  profile: EdgeProfile
  layout: TilesetLayout
}

export interface SubtileGenerateInput {
  mode: 'subtile'
  sourcePixels: Uint8ClampedArray
  sourceWidth: number
  sourceHeight: number
  layout: TilesetLayout
  useMagenta: boolean
  magentaTolerance: number
  customSplits?: CustomSplits | null
}

export type GenerateInput = SdfGenerateInput | SubtileGenerateInput

export interface GenerateResult {
  pixels: Uint8ClampedArray
  width: number
  height: number
  tileW: number
  tileH: number
}

/**
 * Unified tileset generation entry point.
 * Dispatches to SDF or sub-tile engine based on mode.
 */
export function generateTileset(input: GenerateInput): GenerateResult {
  if (input.mode === 'sdf') {
    const { texturePixels, tileSize, profile, layout } = input
    const pixels = generateTilesetSdf(texturePixels, tileSize, profile, layout)
    return {
      pixels,
      width: layout.cols * tileSize,
      height: layout.rows * tileSize,
      tileW: tileSize,
      tileH: tileSize,
    }
  } else {
    const { sourcePixels, sourceWidth, sourceHeight, layout, useMagenta, magentaTolerance, customSplits } = input
    return generateTilesetSubtile(sourcePixels, sourceWidth, sourceHeight, layout, {
      useMagenta,
      magentaTolerance,
      customSplits,
    })
  }
}
