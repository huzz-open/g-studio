import { reactive, computed } from 'vue'
import type { EdgeProfile, GenerationMode, LayoutName, TileSize, TilesetLayout } from './core/types'
import { getProfile } from './core/sdf/profiles'
import { getLayout } from './core/layouts'
import { generateTileset } from './core/generator'
import { createTerrainGrid, TerrainHistory } from './core/preview'
import { translate } from '../../shared/i18n'

export interface TilesetMakerState {
  mode: GenerationMode
  texture: ImageBitmap | null
  texturePixels: Uint8ClampedArray | null
  textureFileName: string
  textureUid: string | null
  tileSize: TileSize
  profile: EdgeProfile
  nineGridImage: ImageBitmap | null
  nineGridPixels: Uint8ClampedArray | null
  nineGridWidth: number
  nineGridHeight: number
  nineGridFileName: string
  useMagenta: boolean
  magentaTolerance: number
  layout: LayoutName
  atlasPixels: Uint8ClampedArray | null
  atlasWidth: number
  atlasHeight: number
  atlasTileW: number
  atlasTileH: number
  isGenerating: boolean
  generateError: string | null
  terrainName: string
  terrainGrid: boolean[][]
  isDirty: boolean
  resourceUid: string | null
  showPainter: boolean
}

export function createTilesetInstance(id: string) {
  const state = reactive<TilesetMakerState>({
    mode: 'sdf',
    texture: null,
    texturePixels: null,
    textureFileName: '',
    textureUid: null,
    tileSize: 32,
    profile: getProfile('stone'),
    nineGridImage: null,
    nineGridPixels: null,
    nineGridWidth: 0,
    nineGridHeight: 0,
    nineGridFileName: '',
    useMagenta: false,
    magentaTolerance: 30,
    layout: '8x6',
    atlasPixels: null,
    atlasWidth: 0,
    atlasHeight: 0,
    atlasTileW: 0,
    atlasTileH: 0,
    isGenerating: false,
    generateError: null,
    terrainName: 'Terrain',
    terrainGrid: createTerrainGrid(11, 14),
    isDirty: false,
    resourceUid: null,
    showPainter: false,
  })

  const history = new TerrainHistory(50)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const currentLayout = computed<TilesetLayout>(() => getLayout(state.layout))
  const hasSource = computed(() => {
    if (state.mode === 'sdf') return state.texturePixels !== null
    return state.nineGridPixels !== null
  })
  const canUndo = computed(() => history.canUndo)
  const canRedo = computed(() => history.canRedo)

  function regenerate() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(doGenerate, 150)
  }

  function doGenerate() {
    if (!hasSource.value) return
    state.isGenerating = true
    state.generateError = null

    try {
      if (state.mode === 'sdf' && state.texturePixels) {
        const result = generateTileset({
          mode: 'sdf',
          texturePixels: state.texturePixels,
          tileSize: state.tileSize,
          profile: { ...state.profile },
          layout: currentLayout.value,
        })
        state.atlasPixels = result.pixels
        state.atlasWidth = result.width
        state.atlasHeight = result.height
        state.atlasTileW = result.tileW
        state.atlasTileH = result.tileH
      } else if (state.mode === 'subtile' && state.nineGridPixels) {
        const result = generateTileset({
          mode: 'subtile',
          sourcePixels: state.nineGridPixels,
          sourceWidth: state.nineGridWidth,
          sourceHeight: state.nineGridHeight,
          layout: currentLayout.value,
          useMagenta: state.useMagenta,
          magentaTolerance: state.magentaTolerance,
        })
        state.atlasPixels = result.pixels
        state.atlasWidth = result.width
        state.atlasHeight = result.height
        state.atlasTileW = result.tileW
        state.atlasTileH = result.tileH
      }
      state.isDirty = true
    } catch (e: any) {
      state.generateError = e?.message || String(e)
    } finally {
      state.isGenerating = false
    }
  }

  async function loadTexture(file: File) {
    const bitmap = await createImageBitmap(file)
    state.texture = bitmap
    state.textureFileName = file.name

    const canvas = new OffscreenCanvas(state.tileSize, state.tileSize)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0, state.tileSize, state.tileSize)
    state.texturePixels = ctx.getImageData(0, 0, state.tileSize, state.tileSize).data
    regenerate()
  }

  function setTextureFromPixels(pixels: Uint8ClampedArray, size: number, name: string, uid?: string) {
    state.texturePixels = pixels
    state.tileSize = size as TileSize
    state.textureFileName = name
    state.textureUid = uid || null
    regenerate()
  }

  async function loadNineGrid(file: File) {
    const bitmap = await createImageBitmap(file)
    const w = bitmap.width
    const h = bitmap.height
    if (w % 6 !== 0 || h % 6 !== 0) {
      state.generateError = translate('tileset.ninegrid.sizeError', { w, h })
      return
    }
    state.nineGridImage = bitmap
    state.nineGridFileName = file.name
    state.nineGridWidth = w
    state.nineGridHeight = h

    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0)
    state.nineGridPixels = ctx.getImageData(0, 0, w, h).data
    state.generateError = null
    regenerate()
  }

  function setMode(mode: GenerationMode) {
    state.mode = mode
    if (hasSource.value) regenerate()
  }

  function setLayout(layout: LayoutName) {
    state.layout = layout
    regenerate()
  }

  function setProfile(profile: EdgeProfile) {
    state.profile = { ...profile }
    regenerate()
  }

  function setProfileParam(key: keyof EdgeProfile, value: number) {
    ;(state.profile as any)[key] = value
    regenerate()
  }

  function setTileSize(size: TileSize) {
    state.tileSize = size
    if (state.texture) {
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(state.texture, 0, 0, size, size)
      state.texturePixels = ctx.getImageData(0, 0, size, size).data
    }
    regenerate()
  }

  function setMagenta(enabled: boolean) {
    state.useMagenta = enabled
    regenerate()
  }

  function setMagentaTolerance(val: number) {
    state.magentaTolerance = val
    regenerate()
  }

  function terrainDraw(x: number, y: number, value: boolean) {
    if (y < 0 || y >= state.terrainGrid.length) return
    if (x < 0 || x >= state.terrainGrid[0].length) return
    if (state.terrainGrid[y][x] === value) return
    history.push(state.terrainGrid)
    state.terrainGrid[y][x] = value
  }

  function terrainUndo() {
    const prev = history.undo(state.terrainGrid)
    if (prev) state.terrainGrid = prev
  }

  function terrainRedo() {
    const next = history.redo(state.terrainGrid)
    if (next) state.terrainGrid = next
  }

  function resizeTerrain(cols: number, rows: number) {
    const oldGrid = state.terrainGrid
    const newGrid = createTerrainGrid(cols, rows)
    const copyRows = Math.min(rows, oldGrid.length)
    const copyCols = Math.min(cols, oldGrid[0].length)
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        newGrid[r][c] = oldGrid[r][c]
      }
    }
    history.push(oldGrid)
    state.terrainGrid = newGrid
  }

  return {
    id,
    state,
    currentLayout,
    hasSource,
    canUndo,
    canRedo,
    regenerate,
    loadTexture,
    setTextureFromPixels,
    loadNineGrid,
    setMode,
    setLayout,
    setProfile,
    setProfileParam,
    setTileSize,
    setMagenta,
    setMagentaTolerance,
    terrainDraw,
    terrainUndo,
    terrainRedo,
    resizeTerrain,
  }
}

export type TilesetInstance = ReturnType<typeof createTilesetInstance>

const instances = new Map<string, TilesetInstance>()

export function getTilesetInstance(id: string): TilesetInstance {
  let inst = instances.get(id)
  if (!inst) {
    inst = createTilesetInstance(id)
    instances.set(id, inst)
  }
  return inst
}

export function removeTilesetInstance(id: string) {
  instances.delete(id)
}

export function useTilesetStore(): TilesetInstance {
  return getTilesetInstance('__default__')
}
