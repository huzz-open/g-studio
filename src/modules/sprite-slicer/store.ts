import { reactive, computed, watch, effectScope, type EffectScope } from 'vue'
import type { DetectedSprite } from './interfaces/sprite-detector'
import type { BgRemovalOptions } from './interfaces/background-remover'
import type { StandardizeOptions } from './interfaces/slice-mode'
import { AutoRemover } from './core/background/auto-remover'
import { NullRemover } from './core/background/null-remover'
import { CcaDetector } from './core/detection/cca-detector'
import { GridDetector } from './core/detection/grid-detector'
import { opencvDetect } from './core/detection/opencv-detector'
import { autoArrangeRects } from './core/layout/bin-packer'
import { splitSpriteByLines, type Point } from './core/split/line-splitter'
import { imageDataToDataUrl, createOffscreenCanvas } from './core/utils/canvas-utils'
import { useSettings } from '../../shared/settings'
import { createHistoryStack } from '../../shared/history'
import type { Rect } from '../../shared/types'
import { createInstanceRegistry } from '../../shared/components/editor-shell/createInstanceRegistry'
import { useEditorTabs, type UseEditorTabsReturn } from '../../shared/components/editor-shell'
import { GsType, type SpriteData, type SliceConfig, type SpriteEntry } from '../../shared/gs-format/types'
import { readSpriteGsFile } from '../../shared/gs-format/reader'
import { writeGsFile, type WriteGsResult } from '../../shared/gs-format/writer'
import { resolveDir, splitPath } from '../../shared/workspace/fs'

function sortByReadingOrder(arr: DetectedSprite[], threshold = 20) {
  arr.sort((a, b) => {
    const dy = a.rect.y - b.rect.y
    if (Math.abs(dy) > threshold) return dy
    return a.rect.x - b.rect.x
  })
}

function extractRegion(
  fullData: ImageData, fullW: number, fullH: number, rect: { x: number; y: number; w: number; h: number },
): ImageData {
  const { ctx } = createOffscreenCanvas(fullW, fullH)
  ctx.putImageData(fullData, 0, 0)
  return ctx.getImageData(rect.x, rect.y, rect.w, rect.h)
}

const bgRemovers = [new AutoRemover(), new NullRemover()]
const ccaDetector = new CcaDetector()
const gridDetector = new GridDetector()

export interface SlicerState {
  gsPath: string | null
  gsLastKnownVersion: number
  gsTexturePath: string
  dirty: boolean
  loaded: boolean
  bgRemoverId: string
  bgColor: [number, number, number]
  bgTolerance: number
  bgSpillStrength: number
  sourceImage: HTMLImageElement | null
  sourceFileName: string
  imgSize: { w: number; h: number }
  loading: boolean
  detectionMode: 'auto' | 'grid'
  mergeGap: number
  minArea: number
  cols: number
  rows: number
  gapH: number
  gapV: number
  marginH: number
  marginV: number
  sprites: DetectedSprite[]
  selected: Set<number>
  namePrefix: string
  cleanImageUrl: string | null
  arrangeMode: 'none' | 'standardize' | 'bin-pack'
}

function createSlicerInstance(id: string) {
  const { settings } = useSettings()
  const d = settings.spriteSlicer.defaults

  const state = reactive<SlicerState>({
    gsPath: null,
    gsLastKnownVersion: 0,
    gsTexturePath: '',
    dirty: false,
    loaded: false,
    bgRemoverId: d.bgRemoval === 'none' ? 'none' : 'auto',
    bgColor: [255, 0, 255],
    bgTolerance: 50,
    bgSpillStrength: 70,
    sourceImage: null,
    sourceFileName: '',
    imgSize: { w: 0, h: 0 },
    loading: false,
    detectionMode: d.detectionMode as 'auto' | 'grid',
    mergeGap: d.mergeGap,
    minArea: d.minArea,
    cols: 6,
    rows: 6,
    gapH: 0,
    gapV: 0,
    marginH: 0,
    marginV: 0,
    sprites: [],
    selected: new Set(),
    namePrefix: d.namePrefix,
    cleanImageUrl: null,
    arrangeMode: d.arrangeMode as 'none' | 'standardize' | 'bin-pack',
  })

  let cleanImageData: ImageData | null = null

  const _pixelCache = new Map<number, { imageData: ImageData; dataUrl: string }>()

  function cacheSprite(sprite: DetectedSprite) {
    _pixelCache.set(sprite.id, { imageData: sprite.imageData, dataUrl: sprite.dataUrl })
  }

  function cacheAllSprites() {
    for (const s of state.sprites) cacheSprite(s)
  }

  interface SpriteSnapshotEntry {
    id: number
    rect: Rect
    name: string
    mergedFrom?: number[]
    mergedFromRects?: Rect[]
    splitFrom?: number
  }
  interface SlicerHistorySnapshot {
    sprites: SpriteSnapshotEntry[]
    selected: number[]
  }

  const history = createHistoryStack<SlicerHistorySnapshot>({
    capture() {
      return {
        sprites: state.sprites.map(s => ({
          id: s.id,
          rect: { ...s.rect },
          name: s.name,
          mergedFrom: s.mergedFrom ? [...s.mergedFrom] : undefined,
          mergedFromRects: s.mergedFromRects ? s.mergedFromRects.map(r => ({ ...r })) : undefined,
          splitFrom: s.splitFrom,
        })),
        selected: [...state.selected],
      }
    },
    restore(snap) {
      state.sprites = snap.sprites.map(entry => {
        const cached = _pixelCache.get(entry.id)!
        return {
          id: entry.id,
          rect: { ...entry.rect },
          name: entry.name,
          imageData: cached.imageData,
          dataUrl: cached.dataUrl,
          mergedFrom: entry.mergedFrom,
          mergedFromRects: entry.mergedFromRects,
          splitFrom: entry.splitFrom,
        }
      })
      state.selected = new Set(snap.selected)
      if (state.arrangeMode !== 'none') applyArrange()
    },
  })

  const currentBgRemover = computed(() =>
    bgRemovers.find(r => r.id === state.bgRemoverId)!,
  )

  const selectedSprites = computed(() =>
    state.sprites.filter(s => state.selected.has(s.id)),
  )

  const bgOptions = computed<BgRemovalOptions>(() => ({
    bgColor: state.bgColor,
    tolerance: state.bgTolerance,
    spillStrength: state.bgSpillStrength,
  }))

  const stdOptions = computed<StandardizeOptions>(() => {
    const all = state.sprites
    let maxW = 0, maxH = 0
    for (const s of all) {
      const w = s._origRect ? s._origRect.w : s.rect.w
      const h = s._origRect ? s._origRect.h : s.rect.h
      if (w > maxW) maxW = w
      if (h > maxH) maxH = h
    }
    const count = all.length || 1
    const autoCols = Math.ceil(Math.sqrt(count))
    return {
      enabled: state.arrangeMode === 'standardize',
      targetWidth: maxW || 32,
      targetHeight: maxH || 32,
      cols: autoCols,
      rows: Math.ceil(count / autoCols),
    }
  })

  const hasSource = computed(() => state.sourceImage !== null)

  let _origCleanImageUrl: string | null = null
  let _origImgSize: { w: number; h: number } | null = null

  let _pendingRestore: SpriteEntry[] | null = null
  let _loadingFromGs = false

  function setPendingRestore(sprites: SpriteEntry[] | null) {
    _pendingRestore = sprites
  }

  function restoreArrange() {
    let changed = false
    for (const sprite of state.sprites) {
      if (sprite._origDataUrl) {
        sprite.dataUrl = sprite._origDataUrl
        sprite.rect = sprite._origRect!
        delete sprite._origDataUrl
        delete sprite._origRect
        changed = true
      }
    }
    if (_origCleanImageUrl) {
      state.cleanImageUrl = _origCleanImageUrl
      state.imgSize = _origImgSize!
      _origCleanImageUrl = null
      _origImgSize = null
    }
    if (changed) state.sprites = [...state.sprites]
  }

  function backupSprites() {
    for (const sprite of state.sprites) {
      if (!sprite._origRect) {
        sprite._origRect = { ...sprite.rect }
        sprite._origDataUrl = sprite.dataUrl
      }
    }
    if (!_origCleanImageUrl) {
      _origCleanImageUrl = state.cleanImageUrl
      _origImgSize = { ...state.imgSize }
    }
  }

  function commitSheet(sheetCtx: CanvasRenderingContext2D, w: number, h: number) {
    state.cleanImageUrl = sheetCtx.canvas.toDataURL('image/png')
    state.imgSize = { w, h }
    state.sprites = [...state.sprites]
  }

  function applyArrange() {
    restoreArrange()

    const mode = state.arrangeMode
    if (mode === 'none' || state.sprites.length === 0) return

    backupSprites()

    if (mode === 'standardize') {
      const opts = stdOptions.value
      const tw = opts.targetWidth
      const th = opts.targetHeight
      const numCols = opts.cols
      const totalW = numCols * tw
      const totalH = Math.ceil(state.sprites.length / numCols) * th

      const { ctx: sheetCtx, canvas: _sheetCv } = createOffscreenCanvas(totalW, totalH)
      const { ctx: cellCtx, canvas: cellCv } = createOffscreenCanvas(tw, th)

      for (let i = 0; i < state.sprites.length; i++) {
        const sprite = state.sprites[i]
        const origW = sprite._origRect!.w
        const origH = sprite._origRect!.h
        const col = i % numCols
        const row = Math.floor(i / numCols)

        cellCtx.clearRect(0, 0, tw, th)
        const ox = Math.round((tw - origW) / 2)
        const oy = Math.round((th - origH) / 2)
        cellCtx.putImageData(sprite.imageData, ox, oy)

        sprite.dataUrl = cellCv.toDataURL('image/png')
        sprite.rect = { x: col * tw, y: row * th, w: tw, h: th }

        sheetCtx.drawImage(cellCv, col * tw, row * th)
      }

      commitSheet(sheetCtx, totalW, totalH)
    } else if (mode === 'bin-pack') {
      const rects = state.sprites.map(s => s.rect)
      const { arranged, canvasW, canvasH } = autoArrangeRects(rects, 1)

      const { ctx: sheetCtx } = createOffscreenCanvas(canvasW, canvasH)

      for (let i = 0; i < state.sprites.length; i++) {
        const sprite = state.sprites[i]
        sprite.rect = arranged[i]
        sheetCtx.putImageData(sprite.imageData, arranged[i].x, arranged[i].y)
      }

      commitSheet(sheetCtx, canvasW, canvasH)
    }

    state.dirty = true
  }

  async function processBackground() {
    const img = state.sourceImage
    if (!img) return

    const { canvas: cv, ctx } = createOffscreenCanvas(img.width, img.height)
    ctx.drawImage(img, 0, 0)
    const imgData = ctx.getImageData(0, 0, img.width, img.height)

    const pending = _pendingRestore
    _pendingRestore = null

    if (!pending) {
      const remover = currentBgRemover.value
      remover.remove(imgData, bgOptions.value)
      ctx.putImageData(imgData, 0, 0)
    }

    cleanImageData = imgData
    state.cleanImageUrl = cv.toDataURL('image/png')

    if (pending) {
      const all: DetectedSprite[] = pending.map((s, i) => {
        const [x, y, w, h] = s.rect
        const rw = Math.min(w, imgData.width - x)
        const rh = Math.min(h, imgData.height - y)
        const cellData = ctx.getImageData(x, y, rw, rh)
        const sprite: DetectedSprite = {
          id: i + 1,
          rect: { x, y, w, h },
          imageData: cellData,
          dataUrl: imageDataToDataUrl(cellData, rw, rh),
          name: s.name,
        }
        if (s.originalRect) {
          const [ox, oy, ow, oh] = s.originalRect
          sprite._origRect = { x: ox, y: oy, w: ow, h: oh }
          sprite._origDataUrl = sprite.dataUrl
        }
        return sprite
      })
      state.sprites = all
      state.selected = new Set(all.map(s => s.id))
      cacheAllSprites()
      history.clear()
    } else {
      await runDetection()
    }
  }

  async function runDetection() {
    if (!cleanImageData) return
    const w = state.imgSize.w
    const h = state.imgSize.h

    let detected: DetectedSprite[]

    if (state.detectionMode === 'auto') {
      try {
        detected = await opencvDetect(cleanImageData, w, h, {
          mode: 'auto',
          mergeGap: state.mergeGap,
          minArea: state.minArea,
        })
      } catch (e) {
        console.warn('[slicer] OpenCV failed, using JS CCA fallback:', e)
        detected = ccaDetector.detect(cleanImageData, w, h, {
          mode: 'auto',
          mergeGap: state.mergeGap,
          minArea: state.minArea,
        })
      }
    } else {
      detected = gridDetector.detect(cleanImageData, w, h, {
        mode: 'grid',
        cols: state.cols,
        rows: state.rows,
        gapH: state.gapH,
        gapV: state.gapV,
        marginH: state.marginH,
        marginV: state.marginV,
      })
    }

    const prefix = state.namePrefix || 'sprite'
    detected.forEach((s, i) => {
      s.name = `${prefix}-${String(i + 1).padStart(2, '0')}`
    })

    state.sprites = detected
    state.selected = new Set(detected.map(s => s.id))
    cacheAllSprites()
    history.clear()

    if (state.detectionMode === 'auto' && detected.length > 0) {
      const autoCols = Math.ceil(Math.sqrt(detected.length))
      state.cols = autoCols
      state.rows = Math.ceil(detected.length / autoCols)
    }

    if (state.arrangeMode !== 'none') {
      applyArrange()
    }

    if (!_loadingFromGs) {
      state.dirty = true
    }
  }

  function mergeSprites(ids: number[]) {
    if (ids.length < 2) return
    if (!cleanImageData) { console.error('[slicer] mergeSprites: cleanImageData missing'); return }

    const toMerge = state.sprites.filter(s => ids.includes(s.id))
    if (toMerge.length < 2) return

    history.record()

    let mx = Infinity, my = Infinity, mx2 = 0, my2 = 0
    for (const s of toMerge) {
      mx = Math.min(mx, s.rect.x)
      my = Math.min(my, s.rect.y)
      mx2 = Math.max(mx2, s.rect.x + s.rect.w)
      my2 = Math.max(my2, s.rect.y + s.rect.h)
    }

    const newRect = { x: mx, y: my, w: mx2 - mx, h: my2 - my }
    const cellData = extractRegion(cleanImageData, state.imgSize.w, state.imgSize.h, newRect)

    const allFromSameSplit = toMerge.every(s => s.splitFrom != null)
      && new Set(toMerge.map(s => s.splitFrom)).size === 1

    const maxId = Math.max(...state.sprites.map(s => s.id)) + 1
    const mergedSprite: DetectedSprite = {
      id: maxId,
      rect: newRect,
      imageData: cellData,
      dataUrl: imageDataToDataUrl(cellData, newRect.w, newRect.h),
      name: toMerge[0].name,
      mergedFrom: ids,
      mergedFromRects: allFromSameSplit ? undefined : toMerge.map(s => ({ ...s.rect })),
    }

    const mergeSet = new Set(ids)
    const remaining = state.sprites.filter(s => !mergeSet.has(s.id))
    remaining.push(mergedSprite)
    cacheSprite(mergedSprite)

    sortByReadingOrder(remaining)

    state.sprites = remaining
    const newSelected = new Set(state.selected)
    for (const id of ids) newSelected.delete(id)
    newSelected.add(maxId)
    state.selected = newSelected

    if (state.arrangeMode !== 'none') applyArrange()
    state.dirty = true
  }

  function unmergeSprite(spriteId: number) {
    if (!cleanImageData) { console.error('[slicer] unmergeSprite: cleanImageData missing'); return false }
    const sprite = state.sprites.find(s => s.id === spriteId)
    if (!sprite?.mergedFromRects || sprite.mergedFromRects.length < 2) return false

    history.record()
    const fullW = state.imgSize.w, fullH = state.imgSize.h
    let nextId = Math.max(...state.sprites.map(s => s.id)) + 1
    const restored: DetectedSprite[] = sprite.mergedFromRects.map((rect, i) => {
      const cellData = extractRegion(cleanImageData!, fullW, fullH, rect)
      return {
        id: nextId++,
        rect: { ...rect },
        imageData: cellData,
        dataUrl: imageDataToDataUrl(cellData, rect.w, rect.h),
        name: `${sprite.name}-${String(i + 1).padStart(2, '0')}`,
      }
    })

    const remaining = state.sprites.filter(s => s.id !== spriteId)
    remaining.push(...restored)
    for (const s of restored) cacheSprite(s)
    sortByReadingOrder(remaining)

    state.sprites = remaining
    const newSelected = new Set(state.selected)
    newSelected.delete(spriteId)
    for (const s of restored) newSelected.add(s.id)
    state.selected = newSelected

    if (state.arrangeMode !== 'none') applyArrange()
    state.dirty = true
    return true
  }

  function splitSprite(spriteId: number, lines: Point[][]) {
    if (lines.length === 0) return

    const sprite = state.sprites.find(s => s.id === spriteId)
    if (!sprite) { console.error('[slicer] splitSprite: sprite not found:', spriteId); return }

    const maxId = Math.max(...state.sprites.map(s => s.id)) + 1
    const newSprites = splitSpriteByLines(sprite, lines, maxId)
    if (newSprites.length < 2) return

    history.record()
    for (const s of newSprites) {
      s.splitFrom = spriteId
      cacheSprite(s)
    }

    const remaining = state.sprites.filter(s => s.id !== spriteId)
    remaining.push(...newSprites)
    sortByReadingOrder(remaining)

    state.sprites = remaining
    const newSelected = new Set(state.selected)
    newSelected.delete(spriteId)
    for (const s of newSprites) newSelected.add(s.id)
    state.selected = newSelected

    if (state.arrangeMode !== 'none') applyArrange()
    state.dirty = true
  }

  function loadFile(file: File): Promise<void> {
    return new Promise((resolve) => {
      state.loading = true
      state.dirty = true
      state.sourceFileName = file.name
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          state.sourceImage = img
          state.imgSize = { w: img.width, h: img.height }
          state.loading = false
          processBackground().then(resolve)
        }
        img.src = reader.result as string
      }
      reader.readAsDataURL(file)
    })
  }

  async function loadFromGsFile(path: string): Promise<void> {
    _loadingFromGs = true

    const result = await readSpriteGsFile(path)
    const data = result.file.data

    state.gsPath = path
    state.gsLastKnownVersion = result.file.version
    state.gsTexturePath = data.texture
    state.loaded = true

    applySliceConfig(data.sliceConfig)

    if (data.sprites.length > 0) {
      _pendingRestore = data.sprites
    }

    const { dir } = splitPath(path)
    const texRelative = data.texture.replace(/^\.\//, '')
    const dirHandle = await resolveDir(dir)
    const fh = await dirHandle.getFileHandle(texRelative)
    const file = await fh.getFile()

    state.sourceFileName = file.name
    await new Promise<void>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          state.sourceImage = img
          state.imgSize = { w: img.width, h: img.height }
          processBackground().then(resolve)
        }
        img.src = reader.result as string
      }
      reader.readAsDataURL(file)
    })

    state.dirty = false
    setTimeout(() => { _loadingFromGs = false }, 0)
  }

  async function saveToGsFile(): Promise<WriteGsResult> {
    if (!state.gsPath) throw new Error('No .gs file path bound')

    const data: SpriteData = {
      texture: state.gsTexturePath,
      size: [state.imgSize.w, state.imgSize.h],
      isComposite: false,
      sliceConfig: getSliceConfig(),
      sprites: getSpriteSnapshot(),
    }

    const result = await writeGsFile({
      path: state.gsPath,
      type: GsType.Sprite,
      data,
      lastKnownVersion: state.gsLastKnownVersion,
    })

    if (result.status === 'ok') {
      state.gsLastKnownVersion = result.newVersion
      state.dirty = false
    }

    return result
  }

  function getCleanImageData(): ImageData | null {
    return cleanImageData
  }

  function getSliceConfig(): SliceConfig {
    return {
      detectionMode: state.detectionMode,
      bgRemoverId: state.bgRemoverId,
      bgColor: [...state.bgColor] as [number, number, number],
      bgTolerance: state.bgTolerance,
      bgSpillStrength: state.bgSpillStrength,
      mergeGap: state.mergeGap,
      minArea: state.minArea,
      cols: state.cols,
      rows: state.rows,
      gapH: state.gapH,
      gapV: state.gapV,
      marginH: state.marginH,
      marginV: state.marginV,
      arrangeMode: state.arrangeMode,
      namePrefix: state.namePrefix,
    }
  }

  function applySliceConfig(sc: SliceConfig) {
    state.detectionMode = sc.detectionMode as 'auto' | 'grid'
    if (sc.bgRemoverId) state.bgRemoverId = sc.bgRemoverId
    if (sc.bgColor) state.bgColor = sc.bgColor
    if (sc.bgTolerance !== undefined) state.bgTolerance = sc.bgTolerance
    if (sc.bgSpillStrength !== undefined) state.bgSpillStrength = sc.bgSpillStrength
    if (sc.mergeGap !== undefined) state.mergeGap = sc.mergeGap
    if (sc.minArea !== undefined) state.minArea = sc.minArea
    if (sc.cols !== undefined) state.cols = sc.cols
    if (sc.rows !== undefined) state.rows = sc.rows
    if (sc.gapH !== undefined) state.gapH = sc.gapH
    if (sc.gapV !== undefined) state.gapV = sc.gapV
    if (sc.marginH !== undefined) state.marginH = sc.marginH
    if (sc.marginV !== undefined) state.marginV = sc.marginV
    if (sc.namePrefix !== undefined) state.namePrefix = sc.namePrefix
    if (sc.arrangeMode !== undefined) state.arrangeMode = sc.arrangeMode
  }

  function getSpriteSnapshot(): SpriteEntry[] {
    return state.sprites.map(s => ({
      name: s.name,
      rect: [s.rect.x, s.rect.y, s.rect.w, s.rect.h] as [number, number, number, number],
      originalRect: s._origRect
        ? [s._origRect.x, s._origRect.y, s._origRect.w, s._origRect.h] as [number, number, number, number]
        : undefined,
    }))
  }

  function renameSprite(id: number, newName: string): boolean {
    const trimmed = newName.trim()
    if (!trimmed) return false
    const duplicate = state.sprites.some(s => s.id !== id && s.name === trimmed)
    if (duplicate) return false
    const sprite = state.sprites.find(s => s.id === id)
    if (!sprite) return false
    history.record()
    sprite.name = trimmed
    state.sprites = [...state.sprites]
    state.dirty = true
    return true
  }

  function isSpriteNameTaken(name: string, excludeId?: number): boolean {
    const trimmed = name.trim()
    return state.sprites.some(s => s.id !== excludeId && s.name === trimmed)
  }

  // --- Internal reactivity: state changes drive side effects ---
  let _bgDebounce = 0
  const _scope: EffectScope = effectScope()

  _scope.run(() => {
    watch(() => state.bgRemoverId, () => {
      if (_loadingFromGs || !state.sourceImage) return
      processBackground()
    })

    watch(() => state.bgColor, () => {
      if (_loadingFromGs || !state.sourceImage) return
      processBackground()
    }, { deep: true })

    watch([() => state.bgTolerance, () => state.bgSpillStrength], () => {
      if (_loadingFromGs || !state.sourceImage) return
      clearTimeout(_bgDebounce)
      _bgDebounce = window.setTimeout(() => processBackground(), 50)
    })

    watch([() => state.mergeGap, () => state.minArea], () => {
      if (_loadingFromGs || !state.sourceImage) return
      if (state.detectionMode === 'auto') runDetection()
    })

    watch([() => state.cols, () => state.rows, () => state.gapH, () => state.gapV, () => state.marginH, () => state.marginV], () => {
      if (_loadingFromGs || !state.sourceImage) return
      if (state.detectionMode === 'grid') runDetection()
    })

    watch(() => state.arrangeMode, () => {
      if (_loadingFromGs || !state.sourceImage) return
      applyArrange()
    })

    watch(() => state.namePrefix, () => {
      if (_loadingFromGs || !state.sourceImage) return
      const prefix = state.namePrefix || 'sprite'
      state.sprites.forEach((s, i) => {
        s.name = `${prefix}-${String(i + 1).padStart(2, '0')}`
      })
    })
  })

  function getLabel(): string {
    if (state.gsPath) return splitPath(state.gsPath).fileName.replace('.gs', '')
    if (state.sourceFileName) return state.sourceFileName.replace(/\.[^.]+$/, '')
    return ''
  }

  function dispose() {
    clearTimeout(_bgDebounce)
    _scope.stop()
  }

  return {
    id,
    state,
    currentBgRemover,
    selectedSprites,
    bgOptions,
    stdOptions,
    hasSource,
    history,
    loadFromGsFile,
    saveToGsFile,
    loadFile,
    processBackground,
    runDetection,
    mergeSprites,
    unmergeSprite,
    splitSprite,
    applyArrange,
    restoreArrange,
    renameSprite,
    isSpriteNameTaken,
    getSliceConfig,
    applySliceConfig,
    getSpriteSnapshot,
    setPendingRestore,
    getCleanImageData,
    getLabel,
    dispose,
  }
}

export type SlicerInstance = ReturnType<typeof createSlicerInstance>

const registry = createInstanceRegistry(createSlicerInstance)
export const getSlicerInstance = registry.get
export const removeSlicerInstance = registry.remove

let _tabs: UseEditorTabsReturn<SlicerInstance> | null = null

export function useSlicerTabs(): UseEditorTabsReturn<SlicerInstance> {
  if (!_tabs) {
    _tabs = useEditorTabs<SlicerInstance>({
      prefix: 'slicer',
      factory: getSlicerInstance,
      destroy: removeSlicerInstance,
      autoEmptyTab: true,
      persist: {
        key: 'gs-tabs:sprite-slicer',
        serialize: (inst) => inst.state.gsPath ? { gsPath: inst.state.gsPath } : null,
        restore: async (desc) => {
          const id = `slicer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          const inst = getSlicerInstance(id)
          inst.state.gsPath = desc.gsPath
          return inst
        },
        getIdentifier: (inst) => inst.state.gsPath,
      },
    })
  }
  return _tabs
}

export { bgRemovers }
