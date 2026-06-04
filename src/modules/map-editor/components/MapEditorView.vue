<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { EditorShell, useEditorTabs, definePanelConfig } from '../../../shared/components/editor-shell'
import type { TabItem, DropModifiers } from '../../../shared/components/editor-shell'
import { getMapEditorInstance, removeMapEditorInstance, type MapEditorInstance } from '../store'
import type { WorldMapData } from '../types'
import MapToolbar from './MapToolbar.vue'
import MapLocationList from './MapLocationList.vue'
import MapCanvas from './MapCanvas.vue'
import MapPropertyPanel from './MapPropertyPanel.vue'

const { t } = useI18n()

const { instances: tabInstances, activeTabId, activeInstance, createTab: createTabRaw, switchTab: onTabSwitch, closeTab: onTabClose } = useEditorTabs<MapEditorInstance>({
  prefix: 'map',
  factory: getMapEditorInstance,
  destroy: removeMapEditorInstance,
})
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

const leftPanelConfig = definePanelConfig('map-editor-left', 300)
const rightPanelConfig = definePanelConfig('map-editor-right')

const tabs = computed<TabItem[]>(() =>
  tabInstances.value.map(inst => ({
    id: inst.id,
    label: inst.state.mapData?.meta.description || t('common.newTab'),
    dirty: inst.canUndo.value,
  }))
)

function createTab(): MapEditorInstance {
  return createTabRaw()
}

function onTabAddFile(file: File) {
  if (!file.name.endsWith('.json')) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as WorldMapData
      const inst = createTab()
      inst.loadMapData(data)
    } catch { /* parse error */ }
  }
  reader.readAsText(file)
}

function onViewportDrop(files: File[], modifiers: DropModifiers) {
  const file = files[0]
  if (!file) return
  if (file.name.endsWith('.json')) {
    if (modifiers.alt && activeInstance.value) {
      onTabLoadFile(file)
    } else if (showEmpty.value && activeInstance.value) {
      onTabLoadFile(file)
    } else {
      onTabAddFile(file)
    }
  } else if (file.type.startsWith('image/') && activeInstance.value) {
    activeInstance.value.state.baseMapUrl = URL.createObjectURL(file)
  }
}

function onTabLoadFile(file: File) {
  if (!file.name.endsWith('.json') || !activeInstance.value) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string) as WorldMapData
      activeInstance.value!.loadMapData(data)
    } catch { /* parse error */ }
  }
  reader.readAsText(file)
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
    :viewport="{ accept: '.json,image/*' }"
    :managed-drop="false"
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
