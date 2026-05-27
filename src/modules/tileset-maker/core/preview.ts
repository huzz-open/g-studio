import type { Peering } from './types'
import { TILE_PEERINGS, peeringToBitmask } from './peerings'
import type { TilesetLayout } from './types'

export type TerrainCell = string | null
export type TerrainGrid = TerrainCell[][]

/**
 * Compute 8-neighbor peering for a cell in the terrain grid.
 * Only cells with the same tilesetId are considered neighbors (Godot terrain rule).
 * Corner bits only matter when both adjacent sides are connected.
 */
export function computePeering(
  grid: TerrainGrid,
  x: number,
  y: number,
  rows: number,
  cols: number,
  tilesetId: string,
): Peering {
  const at = (dx: number, dy: number) =>
    x + dx >= 0 && x + dx < cols &&
    y + dy >= 0 && y + dy < rows &&
    grid[y + dy]?.[x + dx] === tilesetId

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

export function createTerrainGrid(cols: number, rows: number): TerrainGrid {
  return Array.from({ length: rows }, () => Array<TerrainCell>(cols).fill(null))
}

function cloneGrid(grid: TerrainGrid): TerrainGrid {
  return grid.map(row => [...row])
}

export interface TerrainSnapshot {
  grid: TerrainGrid
  originX: number
  originY: number
}

function cloneSnapshot(s: TerrainSnapshot): TerrainSnapshot {
  return { grid: cloneGrid(s.grid), originX: s.originX, originY: s.originY }
}

export class TerrainHistory {
  private undoStack: TerrainSnapshot[] = []
  private redoStack: TerrainSnapshot[] = []
  private maxSize: number

  constructor(maxSize = 50) {
    this.maxSize = maxSize
  }

  push(snapshot: TerrainSnapshot): void {
    this.undoStack.push(cloneSnapshot(snapshot))
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift()
    }
    this.redoStack = []
  }

  undo(current: TerrainSnapshot): TerrainSnapshot | null {
    if (this.undoStack.length === 0) return null
    this.redoStack.push(cloneSnapshot(current))
    return this.undoStack.pop()!
  }

  redo(current: TerrainSnapshot): TerrainSnapshot | null {
    if (this.redoStack.length === 0) return null
    this.undoStack.push(cloneSnapshot(current))
    return this.redoStack.pop()!
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
}
