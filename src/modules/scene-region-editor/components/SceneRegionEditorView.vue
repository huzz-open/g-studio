<script setup lang="ts">
import { ref, shallowRef, computed, watch } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { EditorShell, definePanelConfig, useTabRouteSync, useEditorKeyboard, useExternalChangeWatch } from '../../../shared/components/editor-shell'
import type { TabItem } from '../../../shared/components/editor-shell'
import { useSceneRegionTabs, type SceneRegionStore } from '../store'
import { GsType } from '../../../shared/gs-format/types'
import { useSaveFlow } from '../../../shared/gs-format/save-flow'
import { buildGsSceneRegionData } from '../core/gs-convert'
import RegionCanvas from './RegionCanvas.vue'
import RegionListPanel from './RegionListPanel.vue'
import RegionPropertyPanel from './RegionPropertyPanel.vue'

const { t } = useI18n()

const tabsManager = useSceneRegionTabs()
const { instances, activeTabId, activeInstance, createTab, switchTab: onTabSwitch, closeTab: onTabClose } = tabsManager
useTabRouteSync({
  ...tabsManager,
  activeGsPath: computed(() => activeInstance.value?.state.gsPath ?? null),
  async loadPendingTabs() {
    for (const inst of instances.value) {
      if (inst.state.gsPath && !inst.state.imageUrl) {
        try { await inst.loadFromGsFile(inst.state.gsPath) } catch { /* workspace not ready */ }
      }
    }
  },
})

const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

const leftPanelConfig = definePanelConfig('scene-region-left', 300)
const rightPanelConfig = definePanelConfig('scene-region-right', 280)

const sidebarInstance = shallowRef<SceneRegionStore | null>(null)
watch(activeInstance, (inst) => {
  if (inst) sidebarInstance.value = inst
}, { immediate: true })

const { handleSave } = useSaveFlow({
  type: GsType.SceneRegion,
  tabsManager,
  getInstance: () => activeInstance.value,
  getSaveAsParams: (inst: SceneRegionStore) => {
    const sourceFile = inst.state.sourceFile
    if (!sourceFile && !inst.state.gsTexturePath) return null
    const imageName = sourceFile ? sourceFile.name : inst.state.gsTexturePath!.replace(/^\.\//, '')
    const defaultName = sourceFile
      ? sourceFile.name.replace(/\.[^.]+$/, '')
      : 'scene_region'
    return {
      defaultName,
      imageFileName: imageName,
      imageBuffer: async () => {
        if (sourceFile) return new Uint8Array(await sourceFile.arrayBuffer())
        const { resolveDir, readFile, splitPath } = await import('../../../shared/workspace/fs')
        const { dir } = splitPath(inst.state.gsPath!)
        const dirHandle = await resolveDir(dir)
        const texFileName = inst.state.gsTexturePath!.replace(/^\.\//, '')
        return readFile(dirHandle, texFileName)
      },
      buildData: (texPath: string) => buildGsSceneRegionData(
        inst.state.regions,
        inst.state.imageSize,
        defaultName,
        texPath,
      ),
    }
  },
  onSaved: (inst: SceneRegionStore, r) => {
    inst.state.gsPath = r.gsPath
    inst.state.gsLastKnownVersion = r.version
    inst.state.gsSceneName = r.gsPath.replace(/\.gs$/, '').split('/').pop()!
    inst.state.gsTexturePath = r.texturePath
    inst.state.sourceFile = null
    inst.state.dirty = false
  },
})

useEditorKeyboard(() => activeInstance.value ? {
  save: handleSave,
  history: activeInstance.value.history,
} : null)

useExternalChangeWatch({
  getInstance: () => activeInstance.value,
})

const tabs = computed<TabItem[]>(() =>
  instances.value.map((inst: SceneRegionStore) => ({
    id: inst.id,
    label: inst.getLabel() || t('common.newTab'),
    dirty: inst.state.dirty,
  }))
)

const showEmpty = computed(() =>
  !activeInstance.value?.state.imageUrl
)

function onTabAddFile(file: File) {
  if (!file.type.startsWith('image/')) return
  if (showEmpty.value && activeInstance.value) {
    loadImageToInstance(activeInstance.value, file)
  } else {
    const inst = createTab()
    loadImageToInstance(inst, file)
  }
}

function onTabLoadFile(file: File) {
  if (!file.type.startsWith('image/') || !activeInstance.value) return
  loadImageToInstance(activeInstance.value, file)
}

function loadImageToInstance(inst: SceneRegionStore, file: File) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    inst.loadImage(url, img.naturalWidth, img.naturalHeight, file)
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
