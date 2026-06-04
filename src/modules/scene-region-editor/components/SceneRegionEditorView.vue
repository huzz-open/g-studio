<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { EditorShell, definePanelConfig } from '../../../shared/components/editor-shell'
import type { TabItem } from '../../../shared/components/editor-shell'
import { useSceneRegionTabs, type SceneRegionStore } from '../store'
import RegionCanvas from './RegionCanvas.vue'
import RegionListPanel from './RegionListPanel.vue'
import RegionPropertyPanel from './RegionPropertyPanel.vue'

const { t } = useI18n()

const { instances, activeTabId, activeInstance, createTab, switchTab: onTabSwitch, closeTab: onTabClose } = useSceneRegionTabs()

const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

const leftPanelConfig = definePanelConfig('scene-region-left', 300)
const rightPanelConfig = definePanelConfig('scene-region-right', 280)

const sidebarInstance = shallowRef<SceneRegionStore | null>(null)
watch(activeInstance, (inst) => {
  if (inst) sidebarInstance.value = inst
}, { immediate: true })

const tabs = computed<TabItem[]>(() =>
  instances.value.map((inst: SceneRegionStore) => ({
    id: inst.id,
    label: inst.state.imageUrl ? t('sceneEditor.title') : t('common.newTab'),
  }))
)

const showEmpty = computed(() =>
  !activeInstance.value?.state.imageUrl
)

function onKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl || !activeInstance.value) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); activeInstance.value.history.undo() }
  else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); activeInstance.value.history.redo() }
  else if (e.key === 'y') { e.preventDefault(); activeInstance.value.history.redo() }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

function onTabAddFile(file: File) {
  if (!file.type.startsWith('image/')) return
  const inst = createTab()
  loadImageToInstance(inst, file)
}

function onTabLoadFile(file: File) {
  if (!file.type.startsWith('image/') || !activeInstance.value) return
  loadImageToInstance(activeInstance.value, file)
}

function loadImageToInstance(inst: SceneRegionStore, file: File) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    inst.loadImage(url, img.naturalWidth, img.naturalHeight)
  }
  img.src = url
}

function onExportTscn() {
  if (!activeInstance.value) return
  const content = activeInstance.value.exportTscn()
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'scene_regions.tscn'
  a.click()
  URL.revokeObjectURL(url)
}

function onExportJson() {
  if (!activeInstance.value) return
  const content = activeInstance.value.exportJson()
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'scene_regions.json'
  a.click()
  URL.revokeObjectURL(url)
}

function onImportJson() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file || !activeInstance.value) return
    const reader = new FileReader()
    reader.onload = () => {
      activeInstance.value!.importJson(reader.result as string)
    }
    reader.readAsText(file)
  }
  input.click()
}
</script>

<template>
  <EditorShell
    :tabs="tabs"
    :active-tab-id="activeTabId"
    tab-accept="image/*"
    :left-panel="leftPanelConfig"
    :right-panel="rightPanelConfig"
    :left-collapsed="leftCollapsed"
    :right-collapsed="rightCollapsed"
    :show-empty="showEmpty"
    :auto-empty-tab="true"
    :viewport="{ accept: 'image/*' }"
    @tab-switch="onTabSwitch"
    @tab-close="onTabClose"
    @tab-add-empty="createTab()"
    @tab-add-file="onTabAddFile"
    @tab-load-file="onTabLoadFile"
    @update:left-collapsed="leftCollapsed = $event"
    @update:right-collapsed="rightCollapsed = $event"
  >
    <template #left>
      <RegionListPanel
        v-if="sidebarInstance"
        :store="sidebarInstance"
        @export-tscn="onExportTscn"
        @export-json="onExportJson"
        @import-json="onImportJson"
      />
    </template>

    <template #viewport>
      <RegionCanvas v-if="activeInstance?.state.imageUrl" :store="activeInstance" />
    </template>

    <template #right>
      <RegionPropertyPanel v-if="sidebarInstance" :store="sidebarInstance" />
    </template>
  </EditorShell>
</template>
