import { reactive, computed, type Ref } from 'vue'
import type { LayoutName } from './core/types'
import type { TilesetInstance } from './store'
import type { TerrainGrid, TerrainSnapshot } from './core/preview'
import { createTerrainGrid, cloneTerrainSnapshot } from './core/preview'
import { createHistoryStack } from '../../shared/history'
import type { Transaction } from '../../shared/history'
import { useSettings } from '../../shared/settings'

export interface TilesetRef {
  id: string
  label: string
  atlasPixels: Uint8ClampedArray
  atlasWidth: number
  atlasHeight: number
  atlasTileW: number
  atlasTileH: number
  layout: LayoutName
}

interface TerrainState {
  terrainGrid: TerrainGrid
  terrainName: string
  activeTilesetId: string | null
  originX: number
  originY: number
}

export function createSharedTerrainState(instancesRef: Ref<TilesetInstance[]>) {
  const { settings } = useSettings()
  const defaultCols = settings.tilesetMaker.defaults.terrainCols
  const defaultRows = settings.tilesetMaker.defaults.terrainRows

  const state = reactive<TerrainState>({
    terrainGrid: createTerrainGrid(defaultCols, defaultRows),
    terrainName: 'Terrain',
    activeTilesetId: null,
    originX: 0,
    originY: 0,
  })

  const history = createHistoryStack<TerrainSnapshot>({
    capture(): TerrainSnapshot {
      return cloneTerrainSnapshot({ grid: state.terrainGrid, originX: state.originX, originY: state.originY })
    },
    restore(snap: TerrainSnapshot) {
      state.terrainGrid = snap.grid
      state.originX = snap.originX
      state.originY = snap.originY
    },
  })

  const availableTilesets = computed<TilesetRef[]>(() => {
    const result: TilesetRef[] = []
    for (const inst of instancesRef.value) {
      const s = inst.state
      if (!s.atlasPixels) continue
      result.push({
        id: inst.id,
        label: s.textureFileName || s.nineGridFileName || inst.id,
        atlasPixels: s.atlasPixels,
        atlasWidth: s.atlasWidth,
        atlasHeight: s.atlasHeight,
        atlasTileW: s.atlasTileW,
        atlasTileH: s.atlasTileH,
        layout: s.layout,
      })
    }
    return result
  })

  const activeTileset = computed<TilesetRef | null>(() => {
    if (!state.activeTilesetId) return availableTilesets.value[0] ?? null
    return availableTilesets.value.find(t => t.id === state.activeTilesetId) ?? availableTilesets.value[0] ?? null
  })

  const gridCols = computed(() => state.terrainGrid[0]?.length ?? 0)
  const gridRows = computed(() => state.terrainGrid.length)
  const originX = computed(() => state.originX)
  const originY = computed(() => state.originY)
  const canUndo = history.canUndo
  const canRedo = history.canRedo

  function setActiveTileset(id: string) {
    state.activeTilesetId = id
  }

  function beginStroke(): Transaction {
    return history.transaction()
  }

  function terrainDraw(x: number, y: number, tilesetId: string | null) {
    let gridX = x - state.originX
    let gridY = y - state.originY
    const curRows = state.terrainGrid.length
    const curCols = state.terrainGrid[0]?.length ?? 0

    const shiftX = gridX < 0 ? -gridX : 0
    const shiftY = gridY < 0 ? -gridY : 0
    const needRight = Math.max(0, gridX + 1 - curCols)
    const needBottom = Math.max(0, gridY + 1 - curRows)

    if (shiftX > 0 || shiftY > 0 || needRight > 0 || needBottom > 0) {
      const newCols = curCols + shiftX + needRight
      const newRows = curRows + shiftY + needBottom
      const expanded = createTerrainGrid(newCols, newRows)
      for (let r = 0; r < curRows; r++) {
        for (let c = 0; c < curCols; c++) {
          expanded[r + shiftY][c + shiftX] = state.terrainGrid[r][c]
        }
      }
      state.terrainGrid = expanded
      state.originX -= shiftX
      state.originY -= shiftY
      gridX = x - state.originX
      gridY = y - state.originY
    }

    if (state.terrainGrid[gridY][gridX] === tilesetId) return
    state.terrainGrid[gridY][gridX] = tilesetId
  }

  function terrainUndo() {
    history.undo()
  }

  function terrainRedo() {
    history.redo()
  }

  function resizeTerrain(newCols: number, newRows: number) {
    history.record()
    const oldGrid = state.terrainGrid
    const oldRows = oldGrid.length
    const oldCols = oldGrid[0]?.length ?? 0
    const grid = createTerrainGrid(newCols, newRows)
    const copyRows = Math.min(oldRows, newRows)
    const copyCols = Math.min(oldCols, newCols)
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        grid[r][c] = oldGrid[r][c]
      }
    }
    state.terrainGrid = grid
  }

  function clearTerrain() {
    history.record()
    state.terrainGrid = createTerrainGrid(
      settings.tilesetMaker.defaults.terrainCols,
      settings.tilesetMaker.defaults.terrainRows,
    )
    state.originX = 0
    state.originY = 0
  }

  return {
    state,
    history,
    availableTilesets,
    activeTileset,
    gridCols,
    gridRows,
    originX,
    originY,
    canUndo,
    canRedo,
    setActiveTileset,
    beginStroke,
    terrainDraw,
    resizeTerrain,
    terrainUndo,
    terrainRedo,
    clearTerrain,
  }
}

export type SharedTerrainState = ReturnType<typeof createSharedTerrainState>
