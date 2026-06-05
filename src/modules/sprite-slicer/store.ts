import { ref, computed, nextTick, type Ref } from 'vue'
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
import type { SlicerSliceConfig, SlicerSpriteEntry } from '../resource-manager'

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

export interface SlicerTabInfo {
  id: string
  fileName: string
  workspacePath?: string
  resourceUid?: string
}

interface TabSnapshot {
  sourceImage: HTMLImageElement | null
  imgSize: { w: number; h: number }
  loading: boolean
  sprites: DetectedSprite[]
  selected: Set<number>
  namePrefix: string
  cleanImageData: ImageData | null
  cleanImageUrl: string | null
  detectionMode: 'auto' | 'grid'
  mergeGap: number
  minArea: number
  cols: number
  rows: number
  gapH: number
  gapV: number
  marginH: number
  marginV: number
  arrangeMode: 'none' | 'standardize' | 'bin-pack'
  bgRemoverId: string
  bgColor: [number, number, number]
  bgTolerance: number
  bgSpillStrength: number
  origCleanImageUrl: string | null
  origImgSize: { w: number; h: number } | null
}

let tabIdCounter = 0

type SlicerStore = ReturnType<typeof createSlicerStore>
let _singleton: SlicerStore | null = null

export function useSlicerStore(): SlicerStore {
  if (!_singleton) _singleton = createSlicerStore()
  return _singleton
}

const SLICER_SESSION_KEY = 'gs-tabs:sprite-slicer'

function createSlicerStore() {
  const tabs = ref<SlicerTabInfo[]>([])
  const activeTabId = ref<string | null>(null)
  const tabSnapshots = new Map<string, TabSnapshot>()
  let _restoring = false
  const restoring = ref(false)

  const saving = ref(false)
  const bgRemoverId = ref<string>('auto')
  const bgColor: Ref<[number, number, number]> = ref([255, 0, 255])
  const bgTolerance = ref(50)
  const bgSpillStrength = ref(70)

  const sourceImage = ref<HTMLImageElement | null>(null)
  const imgSize = ref({ w: 0, h: 0 })
  const loading = ref(false)
  const detectionMode = ref<'auto' | 'grid'>('auto')
  const mergeGap = ref(3)
  const minArea = ref(50)
  const cols = ref(6)
  const rows = ref(6)
  const gapH = ref(0)
  const gapV = ref(0)
  const marginH = ref(0)
  const marginV = ref(0)
  const sprites = ref<DetectedSprite[]>([])
  const selected = ref<Set<number>>(new Set())
  const namePrefix = ref('sprite')
  let cleanImageData: ImageData | null = null
  const cleanImageUrl = ref<string | null>(null)
  const arrangeMode = ref<'none' | 'standardize' | 'bin-pack'>('none')

  // --- Pixel cache: stores imageData+dataUrl by sprite id, survives undo/redo ---
  const _pixelCache = new Map<number, { imageData: ImageData; dataUrl: string }>()

  function cacheSprite(sprite: DetectedSprite) {
    _pixelCache.set(sprite.id, { imageData: sprite.imageData, dataUrl: sprite.dataUrl })
  }

  function cacheAllSprites() {
    for (const s of sprites.value) cacheSprite(s)
  }

  // --- History (undo/redo for structural sprite operations) ---
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
        sprites: sprites.value.map(s => ({
          id: s.id,
          rect: { ...s.rect },
          name: s.name,
          mergedFrom: s.mergedFrom ? [...s.mergedFrom] : undefined,
          mergedFromRects: s.mergedFromRects ? s.mergedFromRects.map(r => ({ ...r })) : undefined,
          splitFrom: s.splitFrom,
        })),
        selected: [...selected.value],
      }
    },
    restore(snap) {
      sprites.value = snap.sprites.map(entry => {
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
      selected.value = new Set(snap.selected)
      if (arrangeMode.value !== 'none') applyArrange()
    },
  })

  const currentBgRemover = computed(() =>
    bgRemovers.find(r => r.id === bgRemoverId.value)!,
  )

  const selectedSprites = computed(() =>
    sprites.value.filter(s => selected.value.has(s.id)),
  )

  const bgOptions = computed<BgRemovalOptions>(() => ({
    bgColor: bgColor.value,
    tolerance: bgTolerance.value,
    spillStrength: bgSpillStrength.value,
  }))

  const stdOptions = computed<StandardizeOptions>(() => {
    const all = sprites.value
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
      enabled: arrangeMode.value === 'standardize',
      targetWidth: maxW || 32,
      targetHeight: maxH || 32,
      cols: autoCols,
      rows: Math.ceil(count / autoCols),
    }
  })

  let _origCleanImageUrl: string | null = null
  let _origImgSize: { w: number; h: number } | null = null

  let _pendingMetaRestore: { sprites: SlicerSpriteEntry[] } | null = null

  function setPendingMetaRestore(data: { sprites: SlicerSpriteEntry[] } | null) {
    _pendingMetaRestore = data
  }

  function restoreArrange() {
    let changed = false
    for (const sprite of sprites.value) {
      if (sprite._origDataUrl) {
        sprite.dataUrl = sprite._origDataUrl
        sprite.rect = sprite._origRect!
        delete sprite._origDataUrl
        delete sprite._origRect
        changed = true
      }
    }
    if (_origCleanImageUrl) {
      cleanImageUrl.value = _origCleanImageUrl
      imgSize.value = _origImgSize!
      _origCleanImageUrl = null
      _origImgSize = null
    }
    if (changed) sprites.value = [...sprites.value]
  }

  function backupSprites() {
    for (const sprite of sprites.value) {
      if (!sprite._origRect) {
        sprite._origRect = { ...sprite.rect }
        sprite._origDataUrl = sprite.dataUrl
      }
    }
    if (!_origCleanImageUrl) {
      _origCleanImageUrl = cleanImageUrl.value
      _origImgSize = { ...imgSize.value }
    }
  }

  function commitSheet(sheetCtx: CanvasRenderingContext2D, w: number, h: number) {
    cleanImageUrl.value = sheetCtx.canvas.toDataURL('image/png')
    imgSize.value = { w, h }
    sprites.value = [...sprites.value]
  }

  function applyArrange() {
    restoreArrange()

    const mode = arrangeMode.value
    if (mode === 'none' || sprites.value.length === 0) return

    backupSprites()

    if (mode === 'standardize') {
      const opts = stdOptions.value
      const tw = opts.targetWidth
      const th = opts.targetHeight
      const numCols = opts.cols
      const totalW = numCols * tw
      const totalH = Math.ceil(sprites.value.length / numCols) * th

      const { ctx: sheetCtx, canvas: _sheetCv } = createOffscreenCanvas(totalW, totalH)
      const { ctx: cellCtx, canvas: cellCv } = createOffscreenCanvas(tw, th)

      for (let i = 0; i < sprites.value.length; i++) {
        const sprite = sprites.value[i]
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
      const rects = sprites.value.map(s => s.rect)
      const { arranged, canvasW, canvasH } = autoArrangeRects(rects, 1)

      const { ctx: sheetCtx } = createOffscreenCanvas(canvasW, canvasH)

      for (let i = 0; i < sprites.value.length; i++) {
        const sprite = sprites.value[i]
        sprite.rect = arranged[i]
        sheetCtx.putImageData(sprite.imageData, arranged[i].x, arranged[i].y)
      }

      commitSheet(sheetCtx, canvasW, canvasH)
    }
  }

  const hasActiveTab = computed(() => activeTabId.value !== null)

  function snapshotActive(): TabSnapshot | null {
    if (!activeTabId.value) return null
    return {
      sourceImage: sourceImage.value,
      imgSize: { ...imgSize.value },
      loading: loading.value,
      sprites: sprites.value,
      selected: selected.value,
      namePrefix: namePrefix.value,
      cleanImageData,
      cleanImageUrl: cleanImageUrl.value,
      detectionMode: detectionMode.value,
      mergeGap: mergeGap.value,
      minArea: minArea.value,
      cols: cols.value,
      rows: rows.value,
      gapH: gapH.value,
      gapV: gapV.value,
      marginH: marginH.value,
      marginV: marginV.value,
      arrangeMode: arrangeMode.value,
      bgRemoverId: bgRemoverId.value,
      bgColor: [...bgColor.value] as [number, number, number],
      bgTolerance: bgTolerance.value,
      bgSpillStrength: bgSpillStrength.value,
      origCleanImageUrl: _origCleanImageUrl,
      origImgSize: _origImgSize ? { ..._origImgSize } : null,
    }
  }

  function restoreSnapshot(snap: TabSnapshot) {
    sourceImage.value = snap.sourceImage
    imgSize.value = snap.imgSize
    loading.value = snap.loading
    sprites.value = snap.sprites
    selected.value = snap.selected
    namePrefix.value = snap.namePrefix
    cleanImageData = snap.cleanImageData
    cleanImageUrl.value = snap.cleanImageUrl
    detectionMode.value = snap.detectionMode
    mergeGap.value = snap.mergeGap
    minArea.value = snap.minArea
    cols.value = snap.cols
    rows.value = snap.rows
    gapH.value = snap.gapH
    gapV.value = snap.gapV
    marginH.value = snap.marginH
    marginV.value = snap.marginV
    arrangeMode.value = snap.arrangeMode
    bgRemoverId.value = snap.bgRemoverId
    bgColor.value = snap.bgColor
    bgTolerance.value = snap.bgTolerance
    bgSpillStrength.value = snap.bgSpillStrength
    _origCleanImageUrl = snap.origCleanImageUrl
    _origImgSize = snap.origImgSize
  }

  function resetWorkingState() {
    const { settings } = useSettings()
    const d = settings.spriteSlicer.defaults
    sourceImage.value = null
    imgSize.value = { w: 0, h: 0 }
    loading.value = false
    sprites.value = []
    selected.value = new Set()
    namePrefix.value = d.namePrefix
    cleanImageData = null
    cleanImageUrl.value = null
    detectionMode.value = d.detectionMode
    mergeGap.value = d.mergeGap
    minArea.value = d.minArea
    bgRemoverId.value = d.bgRemoval === 'none' ? 'none' : 'auto'
    cols.value = 6
    rows.value = 6
    gapH.value = 0
    gapV.value = 0
    marginH.value = 0
    marginV.value = 0
    arrangeMode.value = d.arrangeMode
    _origCleanImageUrl = null
    _origImgSize = null
    _pixelCache.clear()
    history.clear()
  }

  function addEmptyTab(): string {
    const id = `tab-${++tabIdCounter}`
    const info: SlicerTabInfo = { id, fileName: '' }

    if (activeTabId.value) {
      const snap = snapshotActive()
      if (snap) tabSnapshots.set(activeTabId.value, snap)
    }

    _restoring = true
    resetWorkingState()
    tabs.value = [...tabs.value, info]
    activeTabId.value = id
    nextTick(() => { _restoring = false })
    saveSession()

    return id
  }

  function addTab(file: File, workspacePath?: string, resourceUid?: string): string {
    const id = `tab-${++tabIdCounter}`
    const info: SlicerTabInfo = { id, fileName: file.name, workspacePath, resourceUid }

    if (activeTabId.value) {
      const snap = snapshotActive()
      if (snap) tabSnapshots.set(activeTabId.value, snap)
    }

    _restoring = true
    resetWorkingState()
    tabs.value = [...tabs.value, info]
    activeTabId.value = id
    nextTick(() => { _restoring = false })

    loadFile(file)
    saveSession()
    return id
  }

  function removeTab(id: string) {
    const idx = tabs.value.findIndex(t => t.id === id)
    if (idx === -1) return

    const wasActive = activeTabId.value === id
    tabs.value = tabs.value.filter(t => t.id !== id)

    if (wasActive) {
      if (tabs.value.length > 0) {
        const newIdx = Math.min(idx, tabs.value.length - 1)
        const newId = tabs.value[newIdx].id
        _restoring = true
        activeTabId.value = newId
        const snap = tabSnapshots.get(newId)
        if (snap) {
          restoreSnapshot(snap)
          tabSnapshots.delete(newId)
        } else {
          resetWorkingState()
        }
        nextTick(() => { _restoring = false })
      } else {
        activeTabId.value = null
        resetWorkingState()
      }
    } else {
      tabSnapshots.delete(id)
    }
    saveSession()
  }

  function switchTab(id: string) {
    if (id === activeTabId.value) return
    if (!tabs.value.find(t => t.id === id)) return

    if (activeTabId.value) {
      const snap = snapshotActive()
      if (snap) tabSnapshots.set(activeTabId.value, snap)
    }

    _restoring = true
    activeTabId.value = id
    const snap = tabSnapshots.get(id)
    if (snap) {
      restoreSnapshot(snap)
      tabSnapshots.delete(id)
    } else {
      resetWorkingState()
    }

    nextTick(() => { _restoring = false })
    saveSession()
  }

  function isRestoring(): boolean {
    return _restoring
  }

  async function processBackground() {
    const img = sourceImage.value
    if (!img) return

    const { canvas: cv, ctx } = createOffscreenCanvas(img.width, img.height)
    ctx.drawImage(img, 0, 0)
    const imgData = ctx.getImageData(0, 0, img.width, img.height)

    const pending = _pendingMetaRestore
    _pendingMetaRestore = null

    if (!pending) {
      const remover = currentBgRemover.value
      remover.remove(imgData, bgOptions.value)
      ctx.putImageData(imgData, 0, 0)
    }

    cleanImageData = imgData
    cleanImageUrl.value = cv.toDataURL('image/png')

    if (pending) {
      const all: DetectedSprite[] = pending.sprites.map((s, i) => {
        const rw = Math.min(s.rect.w, imgData.width - s.rect.x)
        const rh = Math.min(s.rect.h, imgData.height - s.rect.y)
        const cellData = ctx.getImageData(s.rect.x, s.rect.y, rw, rh)
        const sprite: DetectedSprite = {
          id: i + 1,
          rect: { ...s.rect },
          imageData: cellData,
          dataUrl: imageDataToDataUrl(cellData, rw, rh),
          name: s.name,
        }
        if (s.originalRect) {
          sprite._origRect = { ...s.originalRect }
          sprite._origDataUrl = sprite.dataUrl
        }
        return sprite
      })
      sprites.value = all
      selected.value = new Set(all.map(s => s.id))
      cacheAllSprites()
      history.clear()
    } else {
      await runDetection()
    }
  }

  async function runDetection() {
    if (!cleanImageData) return
    const w = imgSize.value.w
    const h = imgSize.value.h

    let detected: DetectedSprite[]

    if (detectionMode.value === 'auto') {
      try {
        detected = await opencvDetect(cleanImageData, w, h, {
          mode: 'auto',
          mergeGap: mergeGap.value,
          minArea: minArea.value,
        })
      } catch (e) {
        console.warn('[slicer] OpenCV failed, using JS CCA fallback:', e)
        detected = ccaDetector.detect(cleanImageData, w, h, {
          mode: 'auto',
          mergeGap: mergeGap.value,
          minArea: minArea.value,
        })
      }
    } else {
      detected = gridDetector.detect(cleanImageData, w, h, {
        mode: 'grid',
        cols: cols.value,
        rows: rows.value,
        gapH: gapH.value,
        gapV: gapV.value,
        marginH: marginH.value,
        marginV: marginV.value,
      })
    }

    const prefix = namePrefix.value || 'sprite'
    detected.forEach((s, i) => {
      s.name = `${prefix}-${String(i + 1).padStart(2, '0')}`
    })

    sprites.value = detected
    selected.value = new Set(detected.map(s => s.id))
    cacheAllSprites()
    history.clear()

    if (detectionMode.value === 'auto' && detected.length > 0) {
      const autoCols = Math.ceil(Math.sqrt(detected.length))
      cols.value = autoCols
      rows.value = Math.ceil(detected.length / autoCols)
    }

    if (arrangeMode.value !== 'none') {
      applyArrange()
    }
  }

  function mergeSprites(ids: number[]) {
    if (ids.length < 2) return
    if (!cleanImageData) { console.error('[slicer] mergeSprites: cleanImageData missing'); return }

    const toMerge = sprites.value.filter(s => ids.includes(s.id))
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
    const cellData = extractRegion(cleanImageData, imgSize.value.w, imgSize.value.h, newRect)

    const allFromSameSplit = toMerge.every(s => s.splitFrom != null)
      && new Set(toMerge.map(s => s.splitFrom)).size === 1

    const maxId = Math.max(...sprites.value.map(s => s.id)) + 1
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
    const remaining = sprites.value.filter(s => !mergeSet.has(s.id))
    remaining.push(mergedSprite)
    cacheSprite(mergedSprite)

    sortByReadingOrder(remaining)

    sprites.value = remaining
    const newSelected = new Set(selected.value)
    for (const id of ids) newSelected.delete(id)
    newSelected.add(maxId)
    selected.value = newSelected

    if (arrangeMode.value !== 'none') applyArrange()
  }

  function unmergeSprite(spriteId: number) {
    if (!cleanImageData) { console.error('[slicer] unmergeSprite: cleanImageData missing'); return false }
    const sprite = sprites.value.find(s => s.id === spriteId)
    if (!sprite?.mergedFromRects || sprite.mergedFromRects.length < 2) return false

    history.record()
    const fullW = imgSize.value.w, fullH = imgSize.value.h
    let nextId = Math.max(...sprites.value.map(s => s.id)) + 1
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

    const remaining = sprites.value.filter(s => s.id !== spriteId)
    remaining.push(...restored)
    for (const s of restored) cacheSprite(s)
    sortByReadingOrder(remaining)

    sprites.value = remaining
    const newSelected = new Set(selected.value)
    newSelected.delete(spriteId)
    for (const s of restored) newSelected.add(s.id)
    selected.value = newSelected

    if (arrangeMode.value !== 'none') applyArrange()
    return true
  }

  function splitSprite(spriteId: number, lines: Point[][]) {
    if (lines.length === 0) return

    const sprite = sprites.value.find(s => s.id === spriteId)
    if (!sprite) { console.error('[slicer] splitSprite: sprite not found:', spriteId); return }

    const maxId = Math.max(...sprites.value.map(s => s.id)) + 1
    const newSprites = splitSpriteByLines(sprite, lines, maxId)
    if (newSprites.length < 2) return

    history.record()
    for (const s of newSprites) {
      s.splitFrom = spriteId
      cacheSprite(s)
    }

    const remaining = sprites.value.filter(s => s.id !== spriteId)
    remaining.push(...newSprites)
    sortByReadingOrder(remaining)

    sprites.value = remaining
    const newSelected = new Set(selected.value)
    newSelected.delete(spriteId)
    for (const s of newSprites) newSelected.add(s.id)
    selected.value = newSelected

    if (arrangeMode.value !== 'none') applyArrange()
  }

  function loadFile(file: File) {
    const tabId = activeTabId.value
    loading.value = true
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        if (activeTabId.value === tabId) {
          sourceImage.value = img
          imgSize.value = { w: img.width, h: img.height }
          loading.value = false
          processBackground()
        } else {
          const snap = tabSnapshots.get(tabId!)
          if (snap) {
            snap.sourceImage = img
            snap.imgSize = { w: img.width, h: img.height }
            snap.loading = false
          }
        }
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  function getCleanImageData(): ImageData | null {
    return cleanImageData
  }

  function getSliceConfig(): SlicerSliceConfig {
    return {
      detectionMode: detectionMode.value,
      bgRemoverId: bgRemoverId.value,
      bgColor: [...bgColor.value],
      bgTolerance: bgTolerance.value,
      bgSpillStrength: bgSpillStrength.value,
      mergeGap: mergeGap.value,
      minArea: minArea.value,
      cols: cols.value,
      rows: rows.value,
      gapH: gapH.value,
      gapV: gapV.value,
      marginH: marginH.value,
      marginV: marginV.value,
      arrangeMode: arrangeMode.value,
      namePrefix: namePrefix.value,
    }
  }

  function applySliceConfig(sc: SlicerSliceConfig) {
    if (sc.detectionMode) detectionMode.value = sc.detectionMode as 'auto' | 'grid'
    if (sc.bgRemoverId) {
      if (bgRemovers.some(r => r.id === sc.bgRemoverId)) {
        bgRemoverId.value = sc.bgRemoverId
      } else {
        console.warn('[slicer] invalid bgRemoverId from config, resetting:', sc.bgRemoverId)
        bgRemoverId.value = bgRemovers[0].id
      }
    }
    if (sc.bgColor) bgColor.value = sc.bgColor as [number, number, number]
    if (sc.bgTolerance !== undefined) bgTolerance.value = sc.bgTolerance
    if (sc.bgSpillStrength !== undefined) bgSpillStrength.value = sc.bgSpillStrength
    if (sc.mergeGap !== undefined) mergeGap.value = sc.mergeGap
    if (sc.minArea !== undefined) minArea.value = sc.minArea
    if (sc.cols !== undefined) cols.value = sc.cols
    if (sc.rows !== undefined) rows.value = sc.rows
    if (sc.gapH !== undefined) gapH.value = sc.gapH
    if (sc.gapV !== undefined) gapV.value = sc.gapV
    if (sc.marginH !== undefined) marginH.value = sc.marginH
    if (sc.marginV !== undefined) marginV.value = sc.marginV
    if (sc.namePrefix !== undefined) namePrefix.value = sc.namePrefix
    if (sc.arrangeMode !== undefined) {
      arrangeMode.value = sc.arrangeMode
    }
  }

  function getSpriteSnapshot(): SlicerSpriteEntry[] {
    return sprites.value.map(s => ({
      name: s.name,
      rect: { ...s.rect },
      originalRect: s._origRect ? { ...s._origRect } : undefined,
    }))
  }

  function renameSprite(id: number, newName: string): boolean {
    const trimmed = newName.trim()
    if (!trimmed) return false
    const duplicate = sprites.value.some(s => s.id !== id && s.name === trimmed)
    if (duplicate) return false
    const sprite = sprites.value.find(s => s.id === id)
    if (!sprite) return false
    history.record()
    sprite.name = trimmed
    sprites.value = [...sprites.value]
    return true
  }

  function isSpriteNameTaken(name: string, excludeId?: number): boolean {
    const trimmed = name.trim()
    return sprites.value.some(s => s.id !== excludeId && s.name === trimmed)
  }

  function getTabSnapshot(id: string): TabSnapshot | null {
    return tabSnapshots.get(id) ?? null
  }

  function isTabModified(tabId: string): boolean {
    if (tabId === activeTabId.value) {
      return sprites.value.length > 0
    }
    const snap = tabSnapshots.get(tabId)
    return snap ? snap.sprites.length > 0 : false
  }

  function saveSession() {
    const descriptors = tabs.value
      .filter(t => t.workspacePath || t.resourceUid)
      .map(t => ({ fileName: t.fileName, workspacePath: t.workspacePath, resourceUid: t.resourceUid }))
    const activeTab = tabs.value.find(t => t.id === activeTabId.value)
    const activeId = activeTab?.resourceUid ?? activeTab?.workspacePath ?? null
    sessionStorage.setItem(SLICER_SESSION_KEY, JSON.stringify({ tabs: descriptors, activeId }))
  }

  async function handleRouteIntent(_gsPath: string): Promise<void> {
    // sprite-slicer doesn't use .gs files yet; this is a no-op stub for useTabRouteSync
  }

  function _initFromSession() {
    if (tabs.value.length > 0) return
    const raw = sessionStorage.getItem(SLICER_SESSION_KEY)
    if (!raw) {
      addEmptyTab()
      return
    }
    try {
      const data = JSON.parse(raw) as { tabs: Array<{ fileName: string; workspacePath?: string; resourceUid?: string }>; activeId: string | null }
      if (!data.tabs || data.tabs.length === 0) {
        addEmptyTab()
        return
      }
      for (const desc of data.tabs) {
        const id = `tab-${++tabIdCounter}`
        const info: SlicerTabInfo = { id, fileName: desc.fileName, workspacePath: desc.workspacePath, resourceUid: desc.resourceUid }
        tabs.value = [...tabs.value, info]
        if (!activeTabId.value) activeTabId.value = id
      }
    } catch {
      sessionStorage.removeItem(SLICER_SESSION_KEY)
      addEmptyTab()
    }
  }

  _initFromSession()

  return {
    tabs, activeTabId, hasActiveTab, restoring,
    addEmptyTab, addTab, removeTab, switchTab, isRestoring,
    saveSession, handleRouteIntent,

    sourceImage, imgSize, loading, saving,
    bgRemoverId, bgColor, bgTolerance, bgSpillStrength,
    bgRemovers,
    detectionMode, mergeGap, minArea,
    cols, rows, gapH, gapV, marginH, marginV,
    sprites, selected, namePrefix,
    cleanImageUrl, arrangeMode, stdOptions,
    currentBgRemover, selectedSprites, bgOptions,
    history,
    processBackground, runDetection, loadFile, getCleanImageData,
    getSliceConfig, applySliceConfig, getSpriteSnapshot,
    renameSprite, isSpriteNameTaken,
    mergeSprites, unmergeSprite, splitSprite,
    applyArrange, restoreArrange,
    setPendingMetaRestore,
    getTabSnapshot,
    isTabModified,
  }
}
