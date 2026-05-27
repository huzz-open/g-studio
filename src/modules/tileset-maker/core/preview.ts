import type { Peering } from './types'
import { TILE_PEERINGS, peeringToBitmask } from './peerings'
import type { TilesetLayout } from './types'

/**
 * Compute 8-neighbor peering for a cell in the terrain grid.
 * Corner bits only matter when both adjacent sides are connected (Godot rule).
 */
export function computePeering(
  grid: boolean[][],
  x: number,
  y: number,
  rows: number,
  cols: number,
): Peering {
  const at = (dx: number, dy: number) =>
    x + dx >= 0 && x + dx < cols &&
    y + dy >= 0 && y + dy < rows &&
    grid[y + dy]?.[x + dx] === true

  const t = at(0, -1)
  const r = at(1, 0)
  const b = at(0, 1)
  const l = at(-1, 0)

  return [
    t ? 0 : -1,
    (t && r && at(1, -1)) ? 0 : -1,
    r ? 0 : -1,
    (b && r && at(1, 1)) ? 0 : -1,
    b ? 0 : -1,
    (b && l && at(-1, 1)) ? 0 : -1,
    l ? 0 : -1,
    (t && l && at(-1, -1)) ? 0 : -1,
  ]
}

/**
 * Find the atlas position for a given peering using the lookup map.
 * Falls back to Hamming distance match if exact match not found.
 */
export function findTilePosition(
  peering: Peering,
  layout: TilesetLayout,
): { col: number; row: number } | null {
  const targetMask = peeringToBitmask(peering)

  for (const tile of layout.tiles) {
    const tileMask = peeringToBitmask(TILE_PEERINGS[tile.peeringIndex])
    if (tileMask === targetMask) {
      return { col: tile.col, row: tile.row }
    }
  }

  // Hamming distance fallback
  let best: { col: number; row: number } | null = null
  let bestDist = 999
  for (const tile of layout.tiles) {
    const p2 = TILE_PEERINGS[tile.peeringIndex]
    let dist = 0
    for (let i = 0; i < 8; i++) {
      if (peering[i] !== p2[i]) dist++
    }
    if (dist < bestDist) {
      bestDist = dist
      best = { col: tile.col, row: tile.row }
    }
  }
  return best
}

/** Create an empty terrain grid */
export function createTerrainGrid(cols: number, rows: number): boolean[][] {
  return Array.from({ length: rows }, () => Array(cols).fill(false))
}

/** Deep clone a terrain grid */
export function cloneGrid(grid: boolean[][]): boolean[][] {
  return grid.map(row => [...row])
}

/** Terrain preview undo/redo manager */
export class TerrainHistory {
  private undoStack: boolean[][][] = []
  private redoStack: boolean[][][] = []
  private maxSize: number

  constructor(maxSize = 50) {
    this.maxSize = maxSize
  }

  push(grid: boolean[][]): void {
    this.undoStack.push(cloneGrid(grid))
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift()
    }
    this.redoStack = []
  }

  undo(current: boolean[][]): boolean[][] | null {
    if (this.undoStack.length === 0) return null
    this.redoStack.push(cloneGrid(current))
    return this.undoStack.pop()!
  }

  redo(current: boolean[][]): boolean[][] | null {
    if (this.redoStack.length === 0) return null
    this.undoStack.push(cloneGrid(current))
    return this.redoStack.pop()!
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
}
