import { reactive, computed } from 'vue'
import type { WorldMapData, MapLocation } from './types'
import { getLocationStatus, REALM_ORDER } from './types'
import { createHistoryStack } from '../../shared/history'
import type { HistoryStack, Transaction } from '../../shared/history'

export interface MapSnapshot {
  mapData: WorldMapData
  icons: Array<[number, string]>
}

export interface MapEditorState {
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
  realmFilter: string | null
  assetsLoaded: boolean
  iconLibrary: Map<string, string>
}

export function createMapEditorInstance(id: string) {
  const state = reactive<MapEditorState>({
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
    realmFilter: null,
    assetsLoaded: false,
    iconLibrary: new Map(),
  })

  const history: HistoryStack<MapSnapshot> = createHistoryStack<MapSnapshot>({
    capture() {
      return {
        mapData: JSON.parse(JSON.stringify(state.mapData)) as WorldMapData,
        icons: Array.from(state.iconImages.entries()),
      }
    },
    restore(snap) {
      state.mapData = JSON.parse(JSON.stringify(snap.mapData)) as WorldMapData
      state.iconImages = new Map(snap.icons)
      state.assetsLoaded = true
    },
  })

  const canUndo = computed(() => history.canUndo.value && state.mapData !== null)
  const canRedo = computed(() => history.canRedo.value && state.mapData !== null)

  const selectedLocation = computed<MapLocation | null>(() => {
    if (!state.mapData || state.selectedLocationId === null) return null
    return state.mapData.locations.find(l => l.id === state.selectedLocationId) ?? null
  })

  const filteredLocations = computed<MapLocation[]>(() => {
    if (!state.mapData) return []
    const locs = state.mapData.locations
    if (!state.realmFilter) return locs
    return locs.filter(l => l.realm === state.realmFilter)
  })

  const groupedLocations = computed(() => {
    const groups: Record<string, MapLocation[]> = {}
    for (const realm of REALM_ORDER) groups[realm] = []
    for (const loc of filteredLocations.value) {
      if (!groups[loc.realm]) groups[loc.realm] = []
      groups[loc.realm].push(loc)
    }
    return groups
  })

  const stats = computed(() => {
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

  function selectLocation(locId: number | null) {
    state.selectedLocationId = locId
  }

  function updateLocationPosition(locId: number, x: number, y: number) {
    if (!state.mapData) return
    const loc = state.mapData.locations.find(l => l.id === locId)
    if (loc) { loc.position.x = Math.round(x); loc.position.y = Math.round(y) }
  }

  function updateLocationIcon(locId: number, dataUrl: string) {
    if (!state.mapData) return
    history.record()
    state.iconImages.set(locId, dataUrl)
    const loc = state.mapData.locations.find(l => l.id === locId)
    if (loc) {
      loc.iconPath = `icons/${loc.name}.png`
    }
  }

  function assignLibraryIcon(locationId: number, iconName: string) {
    const dataUrl = state.iconLibrary.get(iconName)
    if (!dataUrl || !state.mapData) return
    history.record()
    state.iconImages.set(locationId, dataUrl)
    const loc = state.mapData.locations.find(l => l.id === locationId)
    if (loc) {
      loc.iconPath = `icons/${iconName}.png`
    }
  }

  function placePendingLocation(locId: number, x: number, y: number) {
    history.record()
    updateLocationPosition(locId, x, y)
  }

  function beginDragTransaction(): Transaction {
    return history.transaction()
  }

  function undo() { history.undo() }
  function redo() { history.redo() }

  async function loadMapData(data: WorldMapData) {
    state.mapData = data
    state.selectedLocationId = null
    state.iconImages.clear()
    state.assetsLoaded = false
    history.clear()
    await loadIconsFromResourceService()
  }

  async function loadIconsFromResourceService() {
    try {
      const { isWorkspaceConnected } = await import('../resource-manager')
      if (!isWorkspaceConnected()) {
        state.assetsLoaded = true
        return
      }
      const { resolveDir } = await import('../../shared/workspace/fs')
      let iconsDir: FileSystemDirectoryHandle
      try {
        iconsDir = await resolveDir('icons')
      } catch (e) {
        console.error('[map] icons directory not accessible:', e)
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
    } catch (e) {
      console.error('[map] icon loading failed:', e)
      state.assetsLoaded = true
    }
  }

  async function addToIconLibrary(name: string, dataUrl: string) {
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
    } catch (e) { console.error('[map] icon persist failed:', e) }
  }

  return {
    id,
    state,
    history,
    canUndo,
    canRedo,
    selectedLocation,
    filteredLocations,
    groupedLocations,
    stats,
    selectLocation,
    updateLocationPosition,
    updateLocationIcon,
    assignLibraryIcon,
    placePendingLocation,
    beginDragTransaction,
    undo,
    redo,
    loadMapData,
    addToIconLibrary,
  }
}

export type MapEditorInstance = ReturnType<typeof createMapEditorInstance>

import { createInstanceRegistry } from '../../shared/components/editor-shell/createInstanceRegistry'
import { useEditorTabs, type UseEditorTabsReturn } from '../../shared/components/editor-shell'

const registry = createInstanceRegistry(createMapEditorInstance)
export const getMapEditorInstance = registry.get
export const removeMapEditorInstance = registry.remove

let _tabs: UseEditorTabsReturn<MapEditorInstance> | null = null

export function useMapEditorTabs(): UseEditorTabsReturn<MapEditorInstance> {
  if (!_tabs) {
    _tabs = useEditorTabs<MapEditorInstance>({
      prefix: 'map',
      factory: getMapEditorInstance,
      destroy: removeMapEditorInstance,
      autoEmptyTab: true,
      persist: {
        key: 'gs-tabs:map-editor',
        serialize: () => null,
        restore: async () => { throw new Error('map-editor does not support session restore yet') },
        getIdentifier: () => null,
        descriptorFromGsPath: (path) => ({ path }),
      },
    })
  }
  return _tabs
}

export function useMapEditorStore(): MapEditorInstance {
  return getMapEditorInstance('__default__')
}
