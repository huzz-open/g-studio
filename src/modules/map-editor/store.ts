import { reactive, computed, ref } from 'vue'
import type { WorldMapData, MapLocation } from './types'
import { getLocationStatus, REALM_ORDER } from './types'

export interface EditorSnapshot {
  mapData: WorldMapData
  icons: Array<[number, string]>
}

const MAX_HISTORY = 50
const undoStack = ref<EditorSnapshot[]>([])
const redoStack = ref<EditorSnapshot[]>([])
let isRestoring = false
let transactionDepth = 0
let transactionSnapshot: EditorSnapshot | null = null

export const canUndo = computed(() => undoStack.value.length > 0)
export const canRedo = computed(() => redoStack.value.length > 0)

interface EditorState {
  mapData: WorldMapData | null
  baseMapUrl: string | null
  selectedLocationId: number | null
  iconImages: Map<number, string>
  showLabels: boolean
  showNumbers: boolean
  showGrid: boolean
  showRoads: boolean
  showRegions: boolean
  showWater: boolean
  zoom: number
  panX: number
  panY: number
  realmFilter: string | null
  assetsLoaded: boolean
  iconLibrary: Map<string, string>
}

export const state = reactive<EditorState>({
  mapData: null,
  baseMapUrl: null,
  selectedLocationId: null,
  iconImages: new Map(),
  showLabels: true,
  showNumbers: true,
  showGrid: false,
  showRoads: true,
  showRegions: false,
  showWater: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  realmFilter: null,
  assetsLoaded: false,
  iconLibrary: new Map(),
})

export const selectedLocation = computed<MapLocation | null>(() => {
  if (!state.mapData || state.selectedLocationId === null) return null
  return state.mapData.locations.find(l => l.id === state.selectedLocationId) ?? null
})

export const filteredLocations = computed<MapLocation[]>(() => {
  if (!state.mapData) return []
  const locs = state.mapData.locations
  if (!state.realmFilter) return locs
  return locs.filter(l => l.realm === state.realmFilter)
})

export const groupedLocations = computed(() => {
  const groups: Record<string, MapLocation[]> = {}
  for (const realm of REALM_ORDER) groups[realm] = []
  for (const loc of filteredLocations.value) {
    if (!groups[loc.realm]) groups[loc.realm] = []
    groups[loc.realm].push(loc)
  }
  return groups
})

export const stats = computed(() => {
  if (!state.mapData) return { total: 0, placed: 0, positioned: 0, pending: 0 }
  const locs = state.mapData.locations
  let placed = 0, positioned = 0, pending = 0
  for (const loc of locs) {
    const s = getLocationStatus(loc)
    if (s === 'placed') placed++
    else if (s === 'positioned') positioned++
    else pending++
  }
  return { total: locs.length, placed, positioned, pending }
})

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

export function createSnapshot(mapData: WorldMapData, iconImages: Map<number, string>): EditorSnapshot {
  return { mapData: deepClone(mapData), icons: Array.from(iconImages.entries()) }
}

function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function pushUndo(snapshot: EditorSnapshot) {
  undoStack.value.push(snapshot)
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift()
}

export function getSnapshot(): EditorSnapshot | null {
  if (!state.mapData) return null
  return createSnapshot(state.mapData, state.iconImages)
}

function applySnapshot(snapshot: EditorSnapshot) {
  state.mapData = JSON.parse(JSON.stringify(snapshot.mapData)) as WorldMapData
  state.iconImages = new Map(snapshot.icons)
  state.assetsLoaded = true
}

export function beginEditTransaction() {
  if (isRestoring) return
  const snap = getSnapshot()
  if (transactionDepth === 0 && snap) transactionSnapshot = snap
  transactionDepth++
}

export function endEditTransaction() {
  if (transactionDepth <= 0) return
  transactionDepth--
  if (transactionDepth > 0) return
  const before = transactionSnapshot
  transactionSnapshot = null
  const current = getSnapshot()
  if (!before || !current || snapshotsEqual(before, current)) return
  pushUndo(before)
  redoStack.value = []
}

export function recordImmediate(before: EditorSnapshot, after: EditorSnapshot) {
  if (isRestoring || snapshotsEqual(before, after)) return
  pushUndo(before)
  redoStack.value = []
}

export function selectLocation(id: number | null) {
  state.selectedLocationId = id
}

export function updateLocationPosition(id: number, x: number, y: number) {
  if (!state.mapData) return
  const loc = state.mapData.locations.find(l => l.id === id)
  if (loc) { loc.position.x = Math.round(x); loc.position.y = Math.round(y) }
}

export function updateLocationIcon(id: number, dataUrl: string) {
  const before = getSnapshot()
  state.iconImages.set(id, dataUrl)
  if (!state.mapData) return
  const loc = state.mapData.locations.find(l => l.id === id)
  if (loc) {
    loc.iconPath = `icons/${loc.name}.png`
    const after = getSnapshot()
    if (before && after) recordImmediate(before, after)
  }
}

export function assignLibraryIcon(locationId: number, iconName: string) {
  const dataUrl = state.iconLibrary.get(iconName)
  if (!dataUrl || !state.mapData) return
  const before = getSnapshot()
  state.iconImages.set(locationId, dataUrl)
  const loc = state.mapData.locations.find(l => l.id === locationId)
  if (loc) {
    loc.iconPath = `icons/${iconName}.png`
    const after = getSnapshot()
    if (before && after) recordImmediate(before, after)
  }
}

export function placePendingLocation(id: number, x: number, y: number) {
  const before = getSnapshot()
  updateLocationPosition(id, x, y)
  const after = getSnapshot()
  if (before && after) recordImmediate(before, after)
}

export function undo() {
  const current = getSnapshot()
  if (!current) return
  const prev = undoStack.value.pop()
  if (!prev) return
  redoStack.value.push(current)
  isRestoring = true
  transactionDepth = 0
  transactionSnapshot = null
  applySnapshot(prev)
  isRestoring = false
}

export function redo() {
  const current = getSnapshot()
  if (!current) return
  const next = redoStack.value.pop()
  if (!next) return
  undoStack.value.push(current)
  isRestoring = true
  transactionDepth = 0
  transactionSnapshot = null
  applySnapshot(next)
  isRestoring = false
}

export async function loadMapData(data: WorldMapData) {
  state.mapData = data
  state.selectedLocationId = null
  state.iconImages.clear()
  state.assetsLoaded = false
  undoStack.value = []
  redoStack.value = []
  transactionSnapshot = null
  transactionDepth = 0
  await loadIconsFromResourceService()
}

async function loadIconsFromResourceService() {
  try {
    const { isWorkspaceConnected } = await import('../resource-manager')
    if (!isWorkspaceConnected()) {
      state.assetsLoaded = true
      return
    }
    const { getWorkspaceHandle } = await import('../../shared/workspace')
    const root = getWorkspaceHandle()
    if (!root) { state.assetsLoaded = true; return }

    let iconsDir: FileSystemDirectoryHandle
    try {
      iconsDir = await root.getDirectoryHandle('icons')
    } catch {
      state.assetsLoaded = true
      return
    }

    for await (const entry of iconsDir.values()) {
      if (entry.kind !== 'file' || entry.name.startsWith('.')) continue
      if (!entry.name.endsWith('.png') && !entry.name.endsWith('.jpg') && !entry.name.endsWith('.webp')) continue
      try {
        const file = await entry.getFile()
        const url = URL.createObjectURL(file)
        const iconName = entry.name.replace(/\.[^.]+$/, '')
        state.iconLibrary.set(iconName, url)
      } catch { /* skip */ }
    }

    if (state.mapData) {
      for (const loc of state.mapData.locations) {
        if (loc.iconPath) {
          const iconName = loc.iconPath.replace(/^icons\//, '').replace(/\.png$/, '')
          const libUrl = state.iconLibrary.get(iconName)
          if (libUrl) state.iconImages.set(loc.id, libUrl)
        }
      }
    }
    state.assetsLoaded = true
  } catch {
    state.assetsLoaded = true
  }
}

export async function addToIconLibrary(name: string, dataUrl: string) {
  state.iconLibrary.set(name, dataUrl)
  try {
    const { isWorkspaceConnected, saveFileToWorkspace } = await import('../resource-manager')
    if (!isWorkspaceConnected()) return
    const resp = await fetch(dataUrl)
    const blob = await resp.blob()
    const data = new Uint8Array(await blob.arrayBuffer())
    await saveFileToWorkspace({
      fileName: `${name}.png`,
      data,
      type: 'icon',
      dir: 'icons',
      origin: { source: 'uploaded', createdBy: 'g-studio', importedAt: Date.now() },
    })
  } catch { /* noop */ }
}
