<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { useSlicerTabs, type SlicerInstance } from '../store'
import { splitPath, resolveDir, writeFile as fsWriteFile } from '../../../shared/workspace/fs'
import { getWorkspaceHandle } from '../../../shared/workspace'
import { GsType } from '../../../shared/gs-format/types'
import { createGsFile } from '../../../shared/gs-format/writer'
import { showToast } from '../../../shared/components/toast'
import { prompt } from '../../../shared/components/prompt'
import { EditorShell, definePanelConfig, useTabRouteSync } from '../../../shared/components/editor-shell'
import type { TabItem } from '../../../shared/components/editor-shell'
import type { OutputPayload } from './SlicerSidebar.vue'
import SlicerSidebar from './SlicerSidebar.vue'
import SlicerPreview from './SlicerPreview.vue'
import AnimationPreview from './AnimationPreview.vue'

const { t } = useI18n()
const tabsManager = useSlicerTabs()
const { instances, activeTabId, activeInstance, createTab, switchTab, closeTab } = tabsManager
useTabRouteSync({
  ...tabsManager,
  activeGsPath: computed(() => activeInstance.value?.state.gsPath ?? null),
  async loadPendingTabs() {
    for (const inst of instances.value) {
      if (inst.state.gsPath && !inst.state.sourceImage) {
        try { await inst.loadFromGsFile(inst.state.gsPath) } catch { /* workspace not ready */ }
      }
    }
  },
})

const showAnimPreview = ref(false)
const leftCollapsed = ref(false)

function onKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl || !activeInstance.value) return
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); activeInstance.value.history.undo() }
  else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); activeInstance.value.history.redo() }
  else if (e.key === 'y') { e.preventDefault(); activeInstance.value.history.redo() }
  else if (e.key === 's') { e.preventDefault(); void handleSaveGs() }
}
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

const leftPanelConfig = definePanelConfig('slicer-sidebar-width', 300)

const tabs = computed<TabItem[]>(() =>
  instances.value.map((inst: SlicerInstance) => ({
    id: inst.id,
    label: inst.state.gsPath
      ? splitPath(inst.state.gsPath).fileName.replace('.gs', '')
      : (inst.state.sourceFileName ? inst.state.sourceFileName.replace(/\.[^.]+$/, '') : t('common.newTab')),
    dirty: inst.state.dirty,
  }))
)

const showEmpty = computed(() => !activeInstance.value?.state.sourceImage)

async function handleSaveGs() {
  const inst = activeInstance.value
  if (!inst) return

  if (!inst.state.gsPath) {
    if (!getWorkspaceHandle()) {
      showToast(t('slicer.save.needWorkspace'), 'info')
      return
    }
    await handleSaveAsNewGs(inst)
    return
  }

  try {
    const result = await inst.saveToGsFile()
    if (result.status === 'ok') {
      tabsManager.saveSession()
      showToast(t('toast.save.success'), 'success')
    } else {
      showToast('文件已被外部修改，请重新加载后再保存', 'error')
    }
  } catch {
    showToast(t('toast.save.error'), 'error')
  }
}

async function handleSaveAsNewGs(inst: SlicerInstance) {
  const defaultName = inst.state.sourceFileName
    ? inst.state.sourceFileName.replace(/\.[^.]+$/, '')
    : 'sprites'
  const name = await prompt({
    title: '保存为 .gs 文件',
    placeholder: defaultName,
    defaultValue: defaultName,
  })
  if (!name) return

  const img = inst.state.sourceImage
  if (!img) {
    showToast('没有关联的图片', 'error')
    return
  }

  try {
    const dirHandle = await resolveDir('', true)
    const textureName = inst.state.sourceFileName || `${name}.png`
    const cv = document.createElement('canvas')
    cv.width = img.width
    cv.height = img.height
    cv.getContext('2d')!.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'))
    const buffer = new Uint8Array(await blob!.arrayBuffer())
    await fsWriteFile(dirHandle, textureName, buffer)

    const gsPath = `${name}.gs`
    const data = {
      texture: `./${textureName}`,
      size: [inst.state.imgSize.w, inst.state.imgSize.h] as [number, number],
      isComposite: false,
      sliceConfig: inst.getSliceConfig(),
      sprites: inst.getSpriteSnapshot(),
    }

    await createGsFile({ path: gsPath, type: GsType.Sprite, data })
    inst.state.gsPath = gsPath
    inst.state.gsLastKnownVersion = 1
    inst.state.gsTexturePath = `./${textureName}`
    inst.state.dirty = false
    tabsManager.saveSession()
    showToast(`已保存为 ${gsPath}`, 'success')
  } catch {
    showToast(t('toast.save.error'), 'error')
  }
}

function onFile(file: File) {
  if (!activeInstance.value) return
  activeInstance.value.loadFile(file)
}

function onTabAddFile(file: File) {
  if (showEmpty.value && activeInstance.value) {
    activeInstance.value.loadFile(file)
  } else {
    const inst = createTab()
    inst.loadFile(file)
  }
}

function onTabLoadFile(file: File) {
  if (!activeInstance.value) return
  activeInstance.value.loadFile(file)
}

function onTabSwitch(id: string) {
  switchTab(id)
}

function onTabClose(id: string) {
  closeTab(id)
}

function onSaveOutput(_payload: OutputPayload) {
  showToast('导出功能重构中', 'info')
}

</script>

<template>
  <EditorShell
    :tabs="tabs"
    :active-tab-id="activeTabId"
    tab-accept="image/png,image/jpeg,image/webp"
    :left-panel="leftPanelConfig"
    :left-collapsed="leftCollapsed"
    :show-empty="showEmpty"
    :viewport="{ accept: 'image/png,image/jpeg,image/webp' }"
    @tab-switch="onTabSwitch"
    @tab-close="onTabClose"
    @tab-add-empty="createTab()"
    @tab-add-file="onTabAddFile"
    @tab-load-file="onTabLoadFile"
    @update:left-collapsed="leftCollapsed = $event"
  >
    <!-- Left sidebar -->
    <template #left>
      <SlicerSidebar
        v-if="activeInstance"
        :store="activeInstance"
        :has-image="!!activeInstance.state.sourceImage"
        @file="onFile"
        @show-anim="showAnimPreview = true"
        @export-local="onSaveOutput"
        @save-workspace="onSaveOutput"
      />
    </template>

    <!-- Viewport -->
    <template #viewport>
      <SlicerPreview v-if="activeInstance?.state.sourceImage" :store="activeInstance" />
    </template>
  </EditorShell>

  <AnimationPreview
    v-if="showAnimPreview && activeInstance"
    :frames="activeInstance.selectedSprites.value"
    @close="showAnimPreview = false"
  />
</template>
