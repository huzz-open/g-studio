<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { EditorShell, definePanelConfig } from '../../../shared/components/editor-shell'
import type { TabItem, DropModifiers } from '../../../shared/components/editor-shell'
import { useSceneRegionStore } from '../store'
import RegionCanvas from './RegionCanvas.vue'
import RegionListPanel from './RegionListPanel.vue'
import RegionPropertyPanel from './RegionPropertyPanel.vue'

const { t } = useI18n()

const store = useSceneRegionStore()

const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

const leftPanelConfig = definePanelConfig('scene-region-left', 260)
const rightPanelConfig = definePanelConfig('scene-region-right', 280)

const tabs = computed<TabItem[]>(() => {
  if (!store.state.imageUrl) return []
  return [{ id: 'main', label: t('sceneEditor.title') }]
})

const activeTabId = ref<string | null>('main')

const showEmpty = computed(() => !store.state.imageUrl)

function onKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.history.undo() }
  else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); store.history.redo() }
  else if (e.key === 'y') { e.preventDefault(); store.history.redo() }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

function onViewportDrop(files: File[], _modifiers: DropModifiers) {
  const file = files[0]
  if (!file || !file.type.startsWith('image/')) return
  loadImageFile(file)
}

function onTabAddFile(file: File) {
  if (!file.type.startsWith('image/')) return
  loadImageFile(file)
}

function loadImageFile(file: File) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    store.loadImage(url, img.naturalWidth, img.naturalHeight)
  }
  img.src = url
}

function onExportTscn() {
  const content = store.exportTscn()
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'scene_regions.tscn'
  a.click()
  URL.revokeObjectURL(url)
}

function onExportJson() {
  const content = store.exportJson()
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
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      store.importJson(reader.result as string)
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
    :viewport="{
      accept: 'image/*',
      dropOverlayText: t('sceneEditor.empty.desc'),
      emptyState: { icon: 'layers', title: t('sceneEditor.empty.title'), desc: t('sceneEditor.empty.desc') },
    }"
    :managed-drop="false"
    @tab-add-file="onTabAddFile"
    @viewport-drop="onViewportDrop"
    @update:left-collapsed="leftCollapsed = $event"
    @update:right-collapsed="rightCollapsed = $event"
  >
    <template #left>
      <RegionListPanel
        :store="store"
        @export-tscn="onExportTscn"
        @export-json="onExportJson"
        @import-json="onImportJson"
      />
    </template>

    <template #viewport>
      <RegionCanvas v-if="store.state.imageUrl" :store="store" />
    </template>

    <template #right>
      <RegionPropertyPanel :store="store" />
    </template>
  </EditorShell>
</template>
