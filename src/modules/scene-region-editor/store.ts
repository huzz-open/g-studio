import { reactive, computed, watch } from 'vue'
import type { SceneRegion, RegionType, RegionPreset, SceneRegionData } from './core/types'
import type { DrawPoint } from '../../shared/components/draw-tools/types'
import { generateTscn } from './core/tscn-export'
import { createHistoryStack } from '../../shared/history'

let _counter = 0
function nextId(): string {
  return `region-${Date.now().toString(36)}-${(++_counter).toString(36)}`
}

const OCCLUDE_COLOR_PALETTE = [
  '#4ade80', '#38bdf8', '#a78bfa', '#facc15',
  '#2dd4bf', '#e879f9', '#84cc16', '#06b6d4',
  '#60a5fa', '#c084fc', '#34d399', '#fbbf24',
]

const COLLISION_COLOR = '#dc2626'

function configFingerprint(type: RegionType, groups: string[]): string {
  const sorted = [...groups]
    .filter(g => g.startsWith('occlude_') && !g.startsWith('occlude_opacity_'))
    .sort()
  return `${type}:${sorted.join(',')}`
}

function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function colorForConfig(type: RegionType, groups: string[]): string {
  if (type === 'collision') return COLLISION_COLOR
  const fp = configFingerprint(type, groups)
  return OCCLUDE_COLOR_PALETTE[hashString(fp) % OCCLUDE_COLOR_PALETTE.length]
}

let _singleton: SceneRegionStore | null = null

export function useSceneRegionStore(): SceneRegionStore {
  if (!_singleton) _singleton = _createStore()
  return _singleton
}

export function createSceneRegionStore() {
  return _createStore()
}

function _createStore() {
  const state = reactive({
    imageUrl: '' as string,
    imageSize: { w: 0, h: 0 },
    regions: [] as SceneRegion[],
    selectedRegionId: null as string | null,
    activeTool: 'rect' as 'rect' | 'polygon',
    listFilter: 'all' as 'all' | 'occlude' | 'collision',
    searchQuery: '' as string,
    creationConfig: {
      type: 'occlude' as RegionType,
      groups: ['occlude_top_layer'] as string[],
      color: '#4ade80',
      colorManuallySet: false,
    },
    savedPresets: [] as RegionPreset[],
  })

  watch(
    () => configFingerprint(state.creationConfig.type, state.creationConfig.groups),
    () => {
      if (!state.creationConfig.colorManuallySet) {
        state.creationConfig.color = colorForConfig(state.creationConfig.type, state.creationConfig.groups)
      }
    },
    { immediate: true },
  )

  const selectedRegion = computed(() =>
    state.selectedRegionId
      ? state.regions.find(r => r.id === state.selectedRegionId) ?? null
      : null
  )

  const filteredRegions = computed(() => {
    let list = state.regions
    if (state.listFilter !== 'all') {
      list = list.filter(r => r.type === state.listFilter)
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q))
    }
    return list
  })

  const visibleRegions = computed(() =>
    state.regions.filter(r => r.visible)
  )

  const regionColorMap = computed(() => {
    const map: Record<string, string> = {}
    for (const r of state.regions) {
      map[r.id] = r.color
    }
    return map
  })

  interface RegionSnapshot { regions: SceneRegion[] }

  const history = createHistoryStack<RegionSnapshot>({
    capture: () => ({ regions: JSON.parse(JSON.stringify(state.regions)) }),
    restore: (snap) => { state.regions = snap.regions },
  })

  function loadImage(url: string, w: number, h: number) {
    state.imageUrl = url
    state.imageSize = { w, h }
  }

  function addRegion(vertices: DrawPoint[]) {
    history.record()
    const idx = state.regions.length
    const region: SceneRegion = {
      id: nextId(),
      name: `Region_${idx + 1}`,
      type: state.creationConfig.type,
      vertices: vertices.map(v => [v.x, v.y]),
      groups: [...state.creationConfig.groups],
      color: state.creationConfig.color,
      colorManuallySet: state.creationConfig.colorManuallySet,
      visible: true,
    }
    state.regions.push(region)
    state.selectedRegionId = region.id
    return region
  }

  function removeRegion(id: string) {
    const idx = state.regions.findIndex(r => r.id === id)
    if (idx < 0) return
    history.record()
    state.regions.splice(idx, 1)
    if (state.selectedRegionId === id) {
      state.selectedRegionId = null
    }
  }

  function updateRegionVertices(id: string, vertices: DrawPoint[]) {
    const region = state.regions.find(r => r.id === id)
    if (!region) return
    region.vertices = vertices.map(v => [v.x, v.y])
  }

  function updateRegionProps(id: string, props: Partial<Pick<SceneRegion, 'name' | 'type' | 'groups' | 'color' | 'colorManuallySet'>>) {
    const region = state.regions.find(r => r.id === id)
    if (!region) return
    history.record()
    if (props.name !== undefined) region.name = props.name
    if (props.type !== undefined) region.type = props.type
    if (props.groups !== undefined) region.groups = props.groups
    if (props.colorManuallySet !== undefined) region.colorManuallySet = props.colorManuallySet
    if (props.color !== undefined) {
      region.color = props.color
    } else if ((props.groups !== undefined || props.type !== undefined) && !region.colorManuallySet) {
      region.color = colorForConfig(region.type, region.groups)
    }
  }

  function selectRegion(id: string | null) {
    state.selectedRegionId = id
  }

  function toggleRegionVisibility(id: string) {
    const region = state.regions.find(r => r.id === id)
    if (!region) return
    history.record()
    region.visible = !region.visible
  }

  function setConfigColorManual(color: string) {
    state.creationConfig.color = color
    state.creationConfig.colorManuallySet = true
  }

  function applyPreset(preset: RegionPreset) {
    state.creationConfig.type = preset.type
    state.creationConfig.groups = [...preset.groups]
    state.creationConfig.color = preset.color
    state.creationConfig.colorManuallySet = false
  }

  function savePreset(name: string): RegionPreset {
    const preset: RegionPreset = {
      id: `preset-${Date.now().toString(36)}`,
      name,
      type: state.creationConfig.type,
      groups: [...state.creationConfig.groups],
      color: state.creationConfig.color,
    }
    state.savedPresets.push(preset)
    return preset
  }

  function deletePreset(id: string) {
    const idx = state.savedPresets.findIndex(p => p.id === id)
    if (idx >= 0) state.savedPresets.splice(idx, 1)
  }

  function exportTscn(): string {
    const data: SceneRegionData = {
      version: '1.0',
      imageSize: { ...state.imageSize },
      regions: state.regions.map(r => ({ ...r, vertices: r.vertices.map(v => [...v] as [number, number]) })),
    }
    return generateTscn(data)
  }

  function exportJson(): string {
    const data: SceneRegionData = {
      version: '1.0',
      imageSize: { ...state.imageSize },
      regions: state.regions.map(r => ({ ...r, vertices: r.vertices.map(v => [...v] as [number, number]) })),
    }
    return JSON.stringify(data, null, 2)
  }

  function importJson(json: string) {
    const data = JSON.parse(json) as SceneRegionData
    state.imageSize = data.imageSize
    state.regions = data.regions.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      vertices: r.vertices,
      groups: r.groups,
      color: r.color,
      colorManuallySet: r.colorManuallySet ?? false,
      visible: r.visible,
    }))
    state.selectedRegionId = null
    history.clear()
  }

  return {
    state,
    history,
    selectedRegion,
    filteredRegions,
    visibleRegions,
    regionColorMap,
    loadImage,
    addRegion,
    removeRegion,
    updateRegionVertices,
    updateRegionProps,
    selectRegion,
    toggleRegionVisibility,
    setConfigColorManual,
    applyPreset,
    savePreset,
    deletePreset,
    exportTscn,
    exportJson,
    importJson,
  }
}

export type SceneRegionStore = ReturnType<typeof _createStore>
