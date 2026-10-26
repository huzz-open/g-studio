<script setup lang="ts">
import { ref, computed, shallowRef, watch } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { useSlicerTabs, type SlicerInstance } from '../store'
import { GsType } from '../../../shared/gs-format/types'
import { useSaveFlow } from '../../../shared/gs-format/save-flow'
import { imageToPngBuffer } from '../../../shared/utils/image-buffer'
import { EditorShell, definePanelConfig, useTabRouteSync, useEditorKeyboard } from '../../../shared/components/editor-shell'
import type { TabItem } from '../../../shared/components/editor-shell'
import type { OutputPayload } from './SlicerSidebar.vue'
import SlicerSidebar from './SlicerSidebar.vue'
import SlicerPreview from './SlicerPreview.vue'
import AnimationPreview from './AnimationPreview.vue'
import { buildOutput } from '../core/export/output'
import { resolveDir, writeFile, fileExists, splitPath, joinPath } from '../../../shared/workspace/fs'
import { confirm } from '../../../shared/components/confirm'
import { useSettings } from '../../../shared/settings'
import { downloadBlob } from '../../../shared/utils/download'
import { showToast } from '../../../shared/components/toast'

const { t } = useI18n()
const tabsManager = useSlicerTabs()
const { instances, activeTabId, activeInstance, createTab, switchTab, closeTab } = tabsManager

const sidebarInstance = shallowRef<SlicerInstance | null>(null)
watch(activeInstance, (inst) => {
  if (inst) sidebarInstance.value = inst
}, { immediate: true })

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
const outputBusy = ref(false)
const outputProgress = ref('')
const { settings } = useSettings()

const { handleSave, saveWithResult } = useSaveFlow({
  type: GsType.Sprite,
  tabsManager,
  getInstance: () => activeInstance.value,
  getSaveAsParams: (inst: SlicerInstance) => {
    if (!inst.state.sourceImage) return null
    return {
      defaultName: inst.state.sourceFileName?.replace(/\.[^.]+$/, '') || 'sprites',
      imageFileName: `${inst.getLabel() || 'texture'}_source.png`,
      imageBuffer: () => imageToPngBuffer(inst.state.sourceImage!),
      buildData: (texPath: string) => ({
        texture: texPath,
        size: [inst.state.sourceImage!.width, inst.state.sourceImage!.height] as [number, number],
        isComposite: false,
        sliceConfig: inst.getSliceConfig(),
        sprites: inst.getSpriteSnapshot(),
      }),
    }
  },
  onSaved: (inst: SlicerInstance, r) => {
    inst.state.gsPath = r.gsPath
    inst.state.gsLastKnownVersion = r.version
    inst.state.gsTexturePath = r.texturePath
    inst.state.dirty = false
  },
})

useEditorKeyboard(() => activeInstance.value ? {
  save: async () => { await activeInstance.value?.waitForProcessing(); await handleSave() },
} : null)

const leftPanelConfig = definePanelConfig('slicer-sidebar-width', 300)

const tabs = computed<TabItem[]>(() =>
  instances.value.map((inst: SlicerInstance) => ({
    id: inst.id,
    pinned: tabsManager.pinnedIds.value.has(inst.id),
    label: inst.getLabel() || t('common.newTab'),
    dirty: inst.state.dirty,
  }))
)

const showEmpty = computed(() => !activeInstance.value?.state.sourceImage)

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

async function output(payload: OutputPayload, workspace: boolean) {
  const inst = activeInstance.value
  if (!inst || outputBusy.value) return
  outputBusy.value = true
  outputProgress.value = t('normal.exporting')
  const name = inst.getLabel() || 'sprites'
  try {
    const files = await buildOutput(inst.selectedSprites.value, { ...inst.state.imgSize }, name, payload,
      (done, total) => { outputProgress.value = t('normal.exportProgress', { done, total }) })
    if (workspace) {
      const dir = await resolveDir(payload.dir, true)
      if (inst.state.gsPath) {
        const sourcePath = joinPath(splitPath(inst.state.gsPath).dir, inst.state.gsTexturePath.replace(/^\.\//, ''))
        if (files.some(file => joinPath(payload.dir, file.name).toLowerCase() === sourcePath.toLowerCase())) {
          throw new Error(t('normal.sourceConflict'))
        }
      }
      const existing: string[] = []
      for (const file of files) if (await fileExists(dir, file.name)) existing.push(file.name)
      if (existing.length) {
        const strategy = settings.workspace.imageConflictStrategy
        if (strategy === 'skip') { showToast(t('normal.skipped'), 'info'); return }
        if (strategy === 'ask' && !await confirm({ title: t('save.conflictTitle'), message: existing.join('\n'), confirmText: t('save.overwrite') })) return
      }
      // The project save also persists per-sprite settings. A cancelled save cancels output.
      if (activeInstance.value !== inst || !await saveWithResult()) return
      for (const file of files) await writeFile(dir, file.name, file.blob)
      settings.spriteSlicer.lastSaveDir = payload.dir
      settings.spriteSlicer.lastTags = payload.tags
    } else {
      for (const file of files) downloadBlob(file.blob, file.name)
    }
    showToast(t('toast.save.success'), 'success')
  } catch (error) {
    showToast(`${t('toast.save.error')}: ${(error as Error).message}`, 'error')
  } finally {
    outputBusy.value = false
    outputProgress.value = ''
  }
}
function onSaveOutput(payload: OutputPayload) { void output(payload, true) }
function onExportLocal(payload: OutputPayload) { void output(payload, false) }

</script>

<template>
  <EditorShell
    :history="activeInstance?.history"
    :tabs="tabs"
    :active-tab-id="activeTabId"
    tab-accept="image/png,image/jpeg,image/webp"
    :left-panel="leftPanelConfig"
    :left-collapsed="leftCollapsed"
    :show-empty="showEmpty"
    :viewport="{ accept: 'image/png,image/jpeg,image/webp' }"
    @tab-switch="onTabSwitch"
    @tab-close="onTabClose"
    @tab-pin="tabsManager.setPinned"
    @tab-add-empty="createTab()"
    @tab-add-file="onTabAddFile"
    @tab-load-file="onTabLoadFile"
    @update:left-collapsed="leftCollapsed = $event"
  >
    <!-- Left sidebar -->
    <template #left>
      <SlicerSidebar
        v-if="sidebarInstance"
        :store="sidebarInstance"
        :has-image="!!sidebarInstance.state.sourceImage"
        :output-busy="outputBusy"
        :output-progress="outputProgress"
        @file="onFile"
        @show-anim="showAnimPreview = true"
        @export-local="onExportLocal"
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
