import type { TilesetLayout } from './types'
import { TILE_PEERINGS } from './peerings'

const BIT_NAMES = [
  'top_side',
  'top_right_corner',
  'right_side',
  'bottom_right_corner',
  'bottom_side',
  'bottom_left_corner',
  'left_side',
  'top_left_corner',
] as const

/**
 * Generate a Godot 4.x TileSet .tres resource file.
 * Compatible with Godot terrain peering bit format.
 */
export function generateTres(
  textureFilename: string,
  tileSize: number,
  terrainName: string,
  layout: TilesetLayout,
): string {
  const lines: string[] = []

  lines.push('[gd_resource type="TileSet" load_steps=3 format=3]')
  lines.push('')
  lines.push(`[ext_resource type="Texture2D" path="res://${textureFilename}" id="1_tex"]`)
  lines.push('')
  lines.push('[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]')
  lines.push('texture = ExtResource("1_tex")')
  lines.push(`texture_region_size = Vector2i(${tileSize}, ${tileSize})`)

  for (const { col, row, peeringIndex } of layout.tiles) {
    const peering = TILE_PEERINGS[peeringIndex]
    const prefix = `${col}:${row}/0`
    lines.push(`${prefix} = 0`)
    lines.push(`${prefix}/terrain_set = 0`)
    lines.push(`${prefix}/terrain = 0`)

    for (let i = 0; i < BIT_NAMES.length; i++) {
      lines.push(`${prefix}/terrains_peering_bit/${BIT_NAMES[i]} = ${peering[i]}`)
    }
  }

  lines.push('')
  lines.push('[resource]')
  lines.push('tile_shape = 0')
  lines.push(`tile_size = Vector2i(${tileSize}, ${tileSize})`)
  lines.push('terrain_set_0/mode = 0')
  lines.push(`terrain_set_0/terrain_0/name = "${terrainName}"`)
  lines.push('terrain_set_0/terrain_0/color = Color(0, 1, 0, 1)')
  lines.push('sources/0 = SubResource("TileSetAtlasSource_1")')

  return lines.join('\n')
}
