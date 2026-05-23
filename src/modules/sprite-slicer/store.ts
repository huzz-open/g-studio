import { ref, computed, nextTick, type Ref } from 'vue'
import type { DetectedSprite } from './interfaces/sprite-detector'
import type { BgRemovalOptions } from './interfaces/background-remover'
import type { StandardizeOptions } from './interfaces/slice-mode'
import { AutoRemover } from './core/background/auto-remover'
import { NullRemover } from './core/background/null-remover'
import { CcaDetector } from './core/detection/cca-detector'
import { GridDetector } from './core/detection/grid-detector'

const bgRemovers = [new AutoRemover(), new NullRemover()]
const ccaDetector = new CcaDetector()
const gridDetector = new GridDetector()

export interface SlicerTabInfo {
  id: string
  fileName: string
  /** Workspace-relative path if opened from resource manager */
  workspacePath?: string
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
  stdEnabled: boolean
  bgDirty: boolean
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

function createSlicerStore() {
  const tabs = ref<SlicerTabInfo[]>([])
  const activeTabId = ref<string | null>(null)
  const tabSnapshots = new Map<string, TabSnapshot>()
  let _restoring = false

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
  const stdEnabled = ref(false)

  const currentBgRemover = computed(() =>
    bgRemovers.find(r => r.id === bgRemoverId.value) ?? bgRemovers[0],
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
      enabled: stdEnabled.value,
      targetWidth: maxW || 32,
      targetHeight: maxH || 32,
      cols: autoCols,
      rows: Math.ceil(count / autoCols),
    }
  })

  let _origCleanImageUrl: string | null = null
  let _origImgSize: { w: number; h: number } | null = null

  function applyStandardize() {
    if (!stdEnabled.value) {
      restoreFromStandardize()
      return
    }
    const all = sprites.value
    if (all.length === 0) return

    const opts = stdOptions.value
    const tw = opts.targetWidth
    const th = opts.targetHeight
    const numCols = opts.cols
    const numRows = opts.rows
    const totalW = numCols * tw
    const totalH = numRows * th

    const sheetCv = document.createElement('canvas')
    sheetCv.width = totalW
    sheetCv.height = totalH
    const sheetCtx = sheetCv.getContext('2d')!

    const cellCv = document.createElement('canvas')
    cellCv.width = tw
    cellCv.height = th
    const cellCtx = cellCv.getContext('2d')!

    for (let i = 0; i < all.length; i++) {
      const sprite = all[i]
      if (!sprite._origDataUrl) {
        sprite._origDataUrl = sprite.dataUrl
        sprite._origRect = { ...sprite.rect }
      }
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

    if (!_origCleanImageUrl) {
      _origCleanImageUrl = cleanImageUrl.value
      _origImgSize = { ...imgSize.value }
    }
    cleanImageUrl.value = sheetCv.toDataURL('image/png')
    imgSize.value = { w: totalW, h: totalH }
    sprites.value = [...sprites.value]
  }

  function restoreFromStandardize() {
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
      stdEnabled: stdEnabled.value,
      bgDirty: false,
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
    stdEnabled.value = snap.stdEnabled
    _origCleanImageUrl = snap.origCleanImageUrl
    _origImgSize = snap.origImgSize
  }

  function resetWorkingState() {
    sourceImage.value = null
    imgSize.value = { w: 0, h: 0 }
    loading.value = false
    sprites.value = []
    selected.value = new Set()
    namePrefix.value = 'sprite'
    cleanImageData = null
    cleanImageUrl.value = null
    detectionMode.value = 'auto'
    mergeGap.value = 3
    minArea.value = 50
    cols.value = 6
    rows.value = 6
    gapH.value = 0
    gapV.value = 0
    marginH.value = 0
    marginV.value = 0
    stdEnabled.value = false
    _origCleanImageUrl = null
    _origImgSize = null
  }

  function addTab(file: File, workspacePath?: string): string {
    const id = `tab-${++tabIdCounter}`
    const info: SlicerTabInfo = { id, fileName: file.name, workspacePath }

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
          const wasDirty = snap.bgDirty
          tabSnapshots.delete(newId)
          nextTick(() => {
            _restoring = false
            if (wasDirty && sourceImage.value) processBackground()
          })
        } else {
          resetWorkingState()
          nextTick(() => { _restoring = false })
        }
      } else {
        activeTabId.value = null
        resetWorkingState()
      }
    } else {
      tabSnapshots.delete(id)
    }
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
    let needsProcessing = false
    if (snap) {
      restoreSnapshot(snap)
      needsProcessing = snap.bgDirty && snap.sourceImage !== null
      tabSnapshots.delete(id)
    } else {
      resetWorkingState()
    }

    nextTick(() => {
      _restoring = false
      if (needsProcessing) processBackground()
    })
  }

  function isRestoring(): boolean {
    return _restoring
  }

  function processBackground() {
    const img = sourceImage.value
    if (!img) return

    const cv = document.createElement('canvas')
    cv.width = img.width; cv.height = img.height
    const ctx = cv.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const imgData = ctx.getImageData(0, 0, img.width, img.height)

    const remover = currentBgRemover.value
    remover.remove(imgData, bgOptions.value)

    ctx.putImageData(imgData, 0, 0)
    cleanImageData = imgData
    cleanImageUrl.value = cv.toDataURL('image/png')

    runDetection()

    for (const [, snap] of tabSnapshots.entries()) {
      snap.bgDirty = true
    }
  }

  function runDetection() {
    if (!cleanImageData) return
    const w = imgSize.value.w
    const h = imgSize.value.h

    let detected: DetectedSprite[]

    if (detectionMode.value === 'auto') {
      detected = ccaDetector.detect(cleanImageData, w, h, {
        mode: 'auto',
        mergeGap: mergeGap.value,
        minArea: minArea.value,
      })
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

    if (detectionMode.value === 'auto' && detected.length > 0) {
      const autoCols = Math.ceil(Math.sqrt(detected.length))
      cols.value = autoCols
      rows.value = Math.ceil(detected.length / autoCols)
    }
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
            snap.bgDirty = true
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

  function renameSprite(id: number, newName: string): boolean {
    const trimmed = newName.trim()
    if (!trimmed) return false
    const duplicate = sprites.value.some(s => s.id !== id && s.name === trimmed)
    if (duplicate) return false
    const sprite = sprites.value.find(s => s.id === id)
    if (!sprite) return false
    sprite.name = trimmed
    sprites.value = [...sprites.value]
    return true
  }

  function isSpriteNameTaken(name: string, excludeId?: number): boolean {
    const trimmed = name.trim()
    return sprites.value.some(s => s.id !== excludeId && s.name === trimmed)
  }

  return {
    tabs, activeTabId, hasActiveTab,
    addTab, removeTab, switchTab, isRestoring,

    sourceImage, imgSize, loading, saving,
    bgRemoverId, bgColor, bgTolerance, bgSpillStrength,
    bgRemovers,
    detectionMode, mergeGap, minArea,
    cols, rows, gapH, gapV, marginH, marginV,
    sprites, selected, namePrefix,
    cleanImageUrl, stdEnabled,
    currentBgRemover, selectedSprites, bgOptions,
    processBackground, runDetection, loadFile, getCleanImageData,
    renameSprite, isSpriteNameTaken, applyStandardize,
  }
}
