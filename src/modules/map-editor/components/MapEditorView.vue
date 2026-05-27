<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { EditorShell } from '../../../shared/components/editor-shell'
import type { TabItem, PanelConfig, DropModifiers } from '../../../shared/components/editor-shell'
import { getMapEditorInstance, removeMapEditorInstance, type MapEditorInstance } from '../store'
import type { WorldMapData } from '../types'
import MapToolbar from './MapToolbar.vue'
import MapLocationList from './MapLocationList.vue'
import MapCanvas from './MapCanvas.vue'
import MapPropertyPanel from './MapPropertyPanel.vue'

const { t } = useI18n()

const tabInstances = ref<MapEditorInstance[]>([])
const activeTabId = ref<string | null>(null)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

let tabCounter = 0

const leftPanelConfig: PanelConfig = {
  width: { default: 240, min: 180, max: 480 },
  persistKey: 'map-editor-left',
}

const rightPanelConfig: PanelConfig = {
  width: { default: 260, min: 180, max: 480 },
  persistKey: 'map-editor-right',
}

const tabs = computed<TabItem[]>(() =>
  tabInstances.value.map(inst => ({
    id: inst.id,
    label: inst.state.mapData?.name || t('mapEditor.newMap'),
    dirty: inst.canUndo.value,
  }))
)

const activeInstance = computed<MapEditorInstance | null>(() => {
  if (!activeTabId.value) return null
  return tabInstances.value.find(i => i.id === activeTabId.value) ?? null
})

function createTab(name?: string): MapEditorInstance {
  const id = `map-${++tabCounter}-${Date.now()}`
  const inst = getMapEditorInstance(id)
  tabInstances.value.push(inst)
  activeTabId.value = id
  return inst
}

function onTabSwitch(id: string) {
  activeTabId.value = id
}

function onTabClose(id: string) {
  const idx = tabInstances.value.findIndex(i => i.id === id)
  if (idx === -1) return
  tabInstances.value.splice(idx, 1)
  removeMapEditorInstance(id)
  if (activeTabId.value === id) {
    activeTabId.value = tabInstances.value[Math.min(idx, tabInstances.value.length - 1)]?.id ?? null
  }
}

function onTabAddFile(file: File) {
  if (!file.name.endsWith('.json')) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as WorldMapData
      const inst = createTab(data.name)
      inst.loadMapData(data)
    } catch { /* parse error */ }
  }
  reader.readAsText(file)
}

function onViewportDrop(files: File[], _modifiers: DropModifiers) {
  const file = files[0]
  if (!file) return
  if (file.name.endsWith('.json')) {
    onTabAddFile(file)
  } else if (file.type.startsWith('image/') && activeInstance.value) {
    activeInstance.value.state.baseMapUrl = URL.createObjectURL(file)
  }
}

const showEmpty = computed(() => !activeInstance.value || !activeInstance.value.state.mapData)

// Create an initial tab
createTab()
</script>

<template>
  <EditorShell
    :tabs="tabs"
    :active-tab-id="activeTabId"
    tab-accept=".json,image/*"
    :left-panel="leftPanelConfig"
    :right-panel="rightPanelConfig"
    :left-collapsed="leftCollapsed"
    :right-collapsed="rightCollapsed"
    :show-empty="showEmpty"
    :viewport="{ accept: '.json,image/*', dropOverlayText: t('mapEditor.dropJson'), emptyState: { icon: 'map', titleKey: t('mapEditor.empty.title'), descKey: t('mapEditor.empty.desc') } }"
    @tab-switch="onTabSwitch"
    @tab-close="onTabClose"
    @tab-add-file="onTabAddFile"
    @viewport-drop="onViewportDrop"
    @update:left-collapsed="leftCollapsed = $event"
    @update:right-collapsed="rightCollapsed = $event"
  >
    <template #left>
      <template v-if="activeInstance">
        <MapLocationList :store="activeInstance" />
      </template>
    </template>

    <template #viewport>
      <template v-if="activeInstance">
        <MapToolbar :store="activeInstance" />
        <MapCanvas :store="activeInstance" />
      </template>
    </template>

    <template #right>
      <template v-if="activeInstance">
        <MapPropertyPanel :store="activeInstance" />
      </template>
    </template>
  </EditorShell>
</template>
