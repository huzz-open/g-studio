import { reactive, computed, type Ref } from 'vue'
import type { LayoutName } from './core/types'
import type { TilesetInstance } from './store'
import type { TerrainGrid, TerrainSnapshot } from './core/preview'
import { createTerrainGrid, TerrainHistory } from './core/preview'

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
  const state = reactive<TerrainState>({
    terrainGrid: createTerrainGrid(11, 14),
    terrainName: 'Terrain',
    activeTilesetId: null,
    originX: 0,
    originY: 0,
  })

  const history = new TerrainHistory(50)

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
  const canUndo = computed(() => history.canUndo)
  const canRedo = computed(() => history.canRedo)

  function setActiveTileset(id: string) {
    state.activeTilesetId = id
  }

  function snapshot(): TerrainSnapshot {
    return { grid: state.terrainGrid, originX: state.originX, originY: state.originY }
  }

  function beginStroke() {
    history.push(snapshot())
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
    const prev = history.undo(snapshot())
    if (prev) {
      state.terrainGrid = prev.grid
      state.originX = prev.originX
      state.originY = prev.originY
    }
  }

  function terrainRedo() {
    const next = history.redo(snapshot())
    if (next) {
      state.terrainGrid = next.grid
      state.originX = next.originX
      state.originY = next.originY
    }
  }

  function clearTerrain() {
    history.push(snapshot())
    state.terrainGrid = createTerrainGrid(11, 14)
    state.originX = 0
    state.originY = 0
  }

  return {
    state,
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
    terrainUndo,
    terrainRedo,
    clearTerrain,
  }
}

export type SharedTerrainState = ReturnType<typeof createSharedTerrainState>
