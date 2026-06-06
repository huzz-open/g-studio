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

const { handleSave } = useSaveFlow({
  type: GsType.Sprite,
  tabsManager,
  getInstance: () => activeInstance.value,
  getSaveAsParams: (inst: SlicerInstance) => {
    if (!inst.state.sourceImage) return null
    return {
      defaultName: inst.state.sourceFileName?.replace(/\.[^.]+$/, '') || 'sprites',
      imageFileName: inst.state.sourceFileName || 'texture.png',
      imageBuffer: () => imageToPngBuffer(inst.state.sourceImage!),
      buildData: (texPath: string) => ({
        texture: texPath,
        size: [inst.state.imgSize.w, inst.state.imgSize.h] as [number, number],
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
  save: handleSave,
  history: activeInstance.value.history,
} : null)

const leftPanelConfig = definePanelConfig('slicer-sidebar-width', 300)

const tabs = computed<TabItem[]>(() =>
  instances.value.map((inst: SlicerInstance) => ({
    id: inst.id,
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

function onSaveOutput(_payload: OutputPayload) {
  void handleSave()
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
        v-if="sidebarInstance"
        :store="sidebarInstance"
        :has-image="!!sidebarInstance.state.sourceImage"
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
