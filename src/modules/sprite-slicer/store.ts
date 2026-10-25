import { reactive, computed, watch, nextTick, effectScope, type EffectScope } from 'vue'
import type { DetectedSprite } from './interfaces/sprite-detector'
import type { BgRemovalOptions } from './interfaces/background-remover'
import type { StandardizeOptions } from './interfaces/slice-mode'
import { AutoRemover } from './core/background/auto-remover'
import { NullRemover } from './core/background/null-remover'
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
import { normalSettings, type NormalSettings } from '../../shared/types/normal-settings'
import { SLICER_PARAMETER_DEFAULTS } from './defaults'
import { createLatestTask } from '../../shared/utils/latest-task'
import { createWorkerClient } from '../../shared/utils/worker-client'
import type { SliceTask, SliceResult } from './core/processing/types'

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
  processing: boolean
  processingError: string
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
    bgColor: [...SLICER_PARAMETER_DEFAULTS.bgColor],
    bgTolerance: SLICER_PARAMETER_DEFAULTS.bgTolerance,
    bgSpillStrength: SLICER_PARAMETER_DEFAULTS.bgSpillStrength,
    sourceImage: null,
    sourceFileName: '',
    imgSize: { w: 0, h: 0 },
    loading: false,
    processing: false,
    processingError: '',
    detectionMode: d.detectionMode as 'auto' | 'grid',
    mergeGap: d.mergeGap,
    minArea: d.minArea,
    cols: SLICER_PARAMETER_DEFAULTS.cols,
    rows: SLICER_PARAMETER_DEFAULTS.rows,
    gapH: SLICER_PARAMETER_DEFAULTS.gapH,
    gapV: SLICER_PARAMETER_DEFAULTS.gapV,
    marginH: SLICER_PARAMETER_DEFAULTS.marginH,
    marginV: SLICER_PARAMETER_DEFAULTS.marginV,
    sprites: [],
    selected: new Set(),
    namePrefix: d.namePrefix,
    cleanImageUrl: null,
    arrangeMode: d.arrangeMode as 'none' | 'standardize' | 'bin-pack',
  })

  let cleanImageData: ImageData | null = null

  const _pixelCache = new Map<number, { imageData: ImageData; dataUrl: string }>()

  function cacheSprite(sprite: DetectedSprite) {
    _pixelCache.set(sprite.id, {
      imageData: sprite._origImageData ?? sprite.imageData,
      dataUrl: sprite._origDataUrl ?? sprite.dataUrl,
    })
  }

  function cacheAllSprites() {
    _pixelCache.clear()
    for (const s of state.sprites) cacheSprite(s)
  }

  function nextSpriteId(): number {
    // Undo may leave newer pixel snapshots in the cache; never overwrite them.
    return Math.max(-1, ..._pixelCache.keys()) + 1
  }

  interface SpriteSnapshotEntry {
    id: number
    rect: Rect
    name: string
    normalSettings?: NormalSettings
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
          rect: { ...(s._origRect ?? s.rect) },
          name: s.name,
          normalSettings: s.normalSettings ? { ...s.normalSettings } : undefined,
          mergedFrom: s.mergedFrom ? [...s.mergedFrom] : undefined,
          mergedFromRects: s.mergedFromRects ? s.mergedFromRects.map(r => ({ ...r })) : undefined,
          splitFrom: s.splitFrom,
        })),
        selected: [...state.selected],
      }
    },
    restore(snap) {
      restoreArrange()
      state.sprites = snap.sprites.map(entry => {
        const cached = _pixelCache.get(entry.id)!
        return {
          id: entry.id,
          rect: { ...entry.rect },
          name: entry.name,
          normalSettings: entry.normalSettings ? { ...entry.normalSettings } : undefined,
          imageData: cached.imageData,
          dataUrl: cached.dataUrl,
          mergedFrom: entry.mergedFrom,
          mergedFromRects: entry.mergedFromRects,
          splitFrom: entry.splitFrom,
        }
      })
      state.selected = new Set(snap.selected)
      if (state.arrangeMode !== 'none') applyArrange()
      state.dirty = true
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

  let sourceImage: HTMLImageElement | null = null
  let sourcePixels: ImageData | null = null
  let sourceId = 0
  const worker = createWorkerClient<SliceTask, SliceResult>(() => new Worker(new URL('./core/processing/slice.worker.ts', import.meta.url), { type: 'module' }))
  const processing = createLatestTask<SliceTask, SliceResult>({
    interval: 100, adaptive: { min: 80, max: 350 }, acceptIntermediate: true,
    run: (input, signal) => worker.run(input, signal),
    onBusy: busy => { state.processing = busy },
    onError: error => { state.processingError = error instanceof Error ? error.message : String(error) },
    apply(result, input) {
      if (input.sourceId !== sourceId || input.detection.mode !== state.detectionMode || input.arrange !== state.arrangeMode) return
      cleanImageData = result.clean
      state.cleanImageUrl = result.displayUrl
      state.imgSize = { w: result.width, h: result.height }
      _origCleanImageUrl = input.arrange === 'none' ? null : result.cleanUrl
      _origImgSize = input.arrange === 'none' ? null : { w: result.clean.width, h: result.clean.height }
      const prefix = state.namePrefix || 'sprite'
      result.sprites.forEach((sprite, i) => { sprite.name = prefix + '-' + String(i + 1).padStart(2, '0') })
      state.sprites = result.sprites
      state.selected = new Set(result.sprites.map(sprite => sprite.id))
      cacheAllSprites(); history.clear()
      if (state.detectionMode === 'auto' && result.sprites.length) {
        state.cols = Math.ceil(Math.sqrt(result.sprites.length))
        state.rows = Math.ceil(result.sprites.length / state.cols)
      }
      if (!_loadingFromGs) state.dirty = true
    },
  })
  function requestProcessing(immediate = false) {
    const image = state.sourceImage
    if (!image) return
    if (image !== sourceImage || !sourcePixels) {
      processing.cancel()
      sourceImage = image; sourceId++
      const { ctx } = createOffscreenCanvas(image.width, image.height)
      ctx.drawImage(image, 0, 0)
      sourcePixels = ctx.getImageData(0, 0, image.width, image.height)
    }
    state.processingError = ''
    processing.request({
      sourceId, image: sourcePixels,
      background: { id: state.bgRemoverId, options: { bgColor: [...state.bgColor], tolerance: state.bgTolerance, spillStrength: state.bgSpillStrength } },
      detection: state.detectionMode === 'auto'
        ? { mode: 'auto', mergeGap: state.mergeGap, minArea: state.minArea }
        : { mode: 'grid', cols: state.cols, rows: state.rows, gapH: state.gapH, gapV: state.gapV, marginH: state.marginH, marginV: state.marginV },
      arrange: state.arrangeMode,
    }, immediate)
  }
  async function flushProcessing() { await nextTick(); processing.flush() }
  function waitForProcessing() { processing.flush(); return processing.whenIdle() }

  function setPendingRestore(sprites: SpriteEntry[] | null) {
    _pendingRestore = sprites
  }

  function restoreArrange() {
    let changed = false
    for (const sprite of state.sprites) {
      if (sprite._origDataUrl) {
        sprite.dataUrl = sprite._origDataUrl
        sprite.rect = sprite._origRect!
        sprite.imageData = sprite._origImageData ?? sprite.imageData
        delete sprite._origDataUrl
        delete sprite._origRect
        delete sprite._origImageData
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
        sprite._origImageData = sprite.imageData
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
        sprite.imageData = cellCtx.getImageData(0, 0, tw, th)
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
    if (!_pendingRestore) { requestProcessing(true); await processing.whenIdle(); return }
    processing.cancel()
    const img = state.sourceImage
    if (!img) return
    restoreArrange()
    state.imgSize = { w: img.width, h: img.height }

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
          normalSettings: s.normalSettings ? normalSettings(s.normalSettings) : undefined,
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
      if (state.arrangeMode !== 'none' && !pending.some(s => s.originalRect)) applyArrange()
    } else {
      await runDetection()
    }
  }

  async function runDetection() {
    requestProcessing(true)
    await processing.whenIdle()
  }

  function mergeSprites(ids: number[]) {
    if (state.processing) return
    if (ids.length < 2) return
    if (!cleanImageData) { console.error('[slicer] mergeSprites: cleanImageData missing'); return }
    restoreArrange()

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
    const { ctx: mergedCtx } = createOffscreenCanvas(newRect.w, newRect.h)
    for (const s of toMerge) {
      const { canvas, ctx } = createOffscreenCanvas(s.rect.w, s.rect.h)
      ctx.putImageData(s.imageData, 0, 0)
      // Source-over preserves other sprites under transparent parts of this rect.
      mergedCtx.drawImage(canvas, s.rect.x - mx, s.rect.y - my)
    }
    const cellData = mergedCtx.getImageData(0, 0, newRect.w, newRect.h)

    const allFromSameSplit = toMerge.every(s => s.splitFrom != null)
      && new Set(toMerge.map(s => s.splitFrom)).size === 1

    const maxId = nextSpriteId()
    const mergedSprite: DetectedSprite = {
      id: maxId,
      rect: newRect,
      imageData: cellData,
      dataUrl: imageDataToDataUrl(cellData, newRect.w, newRect.h),
      name: toMerge[0].name,
      mergedFrom: toMerge.map(s => s.id),
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
    if (state.processing) return false
    if (!cleanImageData) { console.error('[slicer] unmergeSprite: cleanImageData missing'); return false }
    const sprite = state.sprites.find(s => s.id === spriteId)
    if (!sprite?.mergedFromRects || sprite.mergedFromRects.length < 2) return false
    restoreArrange()

    history.record()
    let nextId = nextSpriteId()
    const restored: DetectedSprite[] = sprite.mergedFromRects.map((rect, i) => {
      const original = sprite.mergedFrom?.[i]
      const cached = original === undefined ? undefined : _pixelCache.get(original)
      const cellData = cached?.imageData ?? extractRegion(sprite.imageData, sprite.rect.w, sprite.rect.h, {
        ...rect, x: rect.x - sprite.rect.x, y: rect.y - sprite.rect.y,
      })
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
    if (state.processing) return
    if (lines.length === 0) return

    const sprite = state.sprites.find(s => s.id === spriteId)
    if (!sprite) { console.error('[slicer] splitSprite: sprite not found:', spriteId); return }

    // The editor uses displayed coordinates; convert back before editing source pixels.
    const sourceRect = sprite._origRect ?? sprite.rect
    const offsetX = Math.round((sprite.rect.w - sourceRect.w) / 2)
    const offsetY = Math.round((sprite.rect.h - sourceRect.h) / 2)
    const sourceLines = lines.map(line => line.map(p => ({
      x: p.x - sprite.rect.x - offsetX + sourceRect.x,
      y: p.y - sprite.rect.y - offsetY + sourceRect.y,
    })))
    restoreArrange()

    const maxId = nextSpriteId()
    const newSprites = splitSpriteByLines(sprite, sourceLines, maxId)
    if (newSprites.length < 2) { applyArrange(); return }

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
    processing.cancel()
    state.processingError = ''
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
    processing.cancel()
    state.processingError = ''
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
    await waitForProcessing()
    if (state.processingError) throw new Error(state.processingError)
    if (!state.gsPath) throw new Error('No .gs file path bound')

    const data: SpriteData = {
      texture: state.gsTexturePath,
      size: [state.sourceImage!.width, state.sourceImage!.height],
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
      normalSettings: s.normalSettings ? { ...s.normalSettings } : undefined,
      rect: [
        (s._origRect ?? s.rect).x, (s._origRect ?? s.rect).y,
        (s._origRect ?? s.rect).w, (s._origRect ?? s.rect).h,
      ] as [number, number, number, number],
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

  function setNormalSettings(id: number, settings?: NormalSettings) {
    const sprite = state.sprites.find(s => s.id === id)
    if (!sprite) return
    const next = settings ? normalSettings(settings) : undefined
    if (JSON.stringify(sprite.normalSettings) === JSON.stringify(next)) return
    history.record()
    sprite.normalSettings = next
    state.dirty = true
  }

  function isSpriteNameTaken(name: string, excludeId?: number): boolean {
    const trimmed = name.trim()
    return state.sprites.some(s => s.id !== excludeId && s.name === trimmed)
  }

  // --- Internal reactivity: state changes drive side effects ---
  const _scope: EffectScope = effectScope()

  _scope.run(() => {
    watch(() => state.bgRemoverId, () => {
      if (_loadingFromGs || !state.sourceImage) return
      requestProcessing()
    })

    watch(() => state.bgColor, () => {
      if (_loadingFromGs || !state.sourceImage) return
      requestProcessing()
    }, { deep: true })

    watch([() => state.bgTolerance, () => state.bgSpillStrength], () => {
      if (_loadingFromGs || !state.sourceImage) return
      requestProcessing()
    })

    watch([() => state.mergeGap, () => state.minArea], () => {
      if (_loadingFromGs || !state.sourceImage) return
      if (state.detectionMode === 'auto') requestProcessing()
    })

    watch([() => state.cols, () => state.rows, () => state.gapH, () => state.gapV, () => state.marginH, () => state.marginV], () => {
      if (_loadingFromGs || !state.sourceImage) return
      if (state.detectionMode === 'grid') requestProcessing()
    })

    watch(() => state.arrangeMode, () => {
      if (_loadingFromGs || !state.sourceImage) return
      if (state.processing) requestProcessing(true)
      else applyArrange()
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
    processing.dispose()
    worker.dispose()
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
    flushProcessing,
    waitForProcessing,
    mergeSprites,
    unmergeSprite,
    splitSprite,
    applyArrange,
    restoreArrange,
    renameSprite,
    setNormalSettings,
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
