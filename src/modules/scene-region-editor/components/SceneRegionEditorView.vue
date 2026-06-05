<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { EditorShell, definePanelConfig, useTabRouteSync } from '../../../shared/components/editor-shell'
import type { TabItem } from '../../../shared/components/editor-shell'
import { useSceneRegionTabs, type SceneRegionStore } from '../store'
import { showToast } from '../../../shared/components/toast'
import { prompt } from '../../../shared/components/prompt'
import { getWorkspaceHandle } from '../../../shared/workspace'
import { resolveDir, writeFile as fsWriteFile, splitPath } from '../../../shared/workspace/fs'
import { GsType } from '../../../shared/gs-format/types'
import { createGsFile } from '../../../shared/gs-format/writer'
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

const tabs = computed<TabItem[]>(() =>
  instances.value.map((inst: SceneRegionStore) => ({
    id: inst.id,
    label: tabLabel(inst),
    dirty: inst.state.dirty,
  }))
)

function tabLabel(inst: SceneRegionStore): string {
  if (inst.state.gsSceneName) return inst.state.gsSceneName
  if (inst.state.gsPath) return splitPath(inst.state.gsPath).fileName.replace('.gs', '')
  if (inst.state.sourceFile) return inst.state.sourceFile.name.replace(/\.[^.]+$/, '')
  if (inst.state.imageUrl) return t('sceneEditor.title')
  return t('common.newTab')
}

const showEmpty = computed(() =>
  !activeInstance.value?.state.imageUrl
)

async function onKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl || !activeInstance.value) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); activeInstance.value.history.undo() }
  else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); activeInstance.value.history.redo() }
  else if (e.key === 'y') { e.preventDefault(); activeInstance.value.history.redo() }
  else if (e.key === 's') { e.preventDefault(); await handleSaveGs() }
}

async function handleSaveGs() {
  const inst = activeInstance.value
  if (!inst) return

  if (!inst.state.gsPath) {
    if (!getWorkspaceHandle()) {
      showToast('请先打开工作区以启用保存功能', 'info')
      return
    }
    await handleSaveAsNewGs(inst)
    return
  }

  try {
    const result = await inst.saveToGsFile()
    if (result.status === 'ok') {
      tabsManager.saveSession()
      showToast('已保存', 'success')
    } else {
      showToast('文件已被外部修改，请重新加载后再保存', 'error')
    }
  } catch (e) {
    showToast(`保存失败: ${(e as Error).message}`, 'error')
  }
}

async function handleSaveAsNewGs(inst: SceneRegionStore) {
  const sourceFile = inst.state.sourceFile
  const defaultName = sourceFile
    ? sourceFile.name.replace(/\.[^.]+$/, '')
    : 'scene_region'

  const name = await prompt({
    title: '保存为 .gs 文件',
    placeholder: defaultName,
    defaultValue: defaultName,
  })
  if (!name) return

  try {
    const dirHandle = await resolveDir('', true)
    let textureName: string

    if (sourceFile) {
      textureName = sourceFile.name
      const buffer = await sourceFile.arrayBuffer()
      await fsWriteFile(dirHandle, textureName, new Uint8Array(buffer))
    } else if (inst.state.gsTexturePath) {
      textureName = inst.state.gsTexturePath.replace(/^\.\//, '')
    } else {
      showToast('没有关联的图片文件', 'error')
      return
    }

    const gsPath = `${name}.gs`
    const data = buildGsSceneRegionData(
      inst.state.regions,
      inst.state.imageSize,
      name,
      `./${textureName}`,
    )

    await createGsFile({ path: gsPath, type: GsType.SceneRegion, data })
    inst.state.gsPath = gsPath
    inst.state.gsLastKnownVersion = 1
    inst.state.gsSceneName = name
    inst.state.gsTexturePath = `./${textureName}`
    inst.state.sourceFile = null
    inst.state.dirty = false
    tabsManager.saveSession()
    showToast(`已保存为 ${gsPath}`, 'success')
  } catch (e) {
    showToast(`保存失败: ${(e as Error).message}`, 'error')
  }
}

async function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  const inst = activeInstance.value
  if (!inst || !inst.state.gsPath) return
  try {
    const changed = await inst.checkExternalChange()
    if (changed) {
      if (inst.state.dirty) {
        showToast('文件已被外部修改，建议重新加载', 'info')
      } else {
        await inst.reloadFromDisk()
        showToast('已加载外部更新', 'info')
      }
    }
  } catch { /* ignore read failures on focus */ }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

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
