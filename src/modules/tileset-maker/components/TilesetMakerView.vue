<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../../../shared/i18n'
import { EditorShell, SidebarSection, useEditorTabs, definePanelConfig, useRouteResource } from '../../../shared/components/editor-shell'
import type { TabItem } from '../../../shared/components/editor-shell'
import { getTilesetInstance, removeTilesetInstance, type TilesetInstance } from '../store'
import TextureSourcePanel from './TextureSourcePanel.vue'
import NineGridSourcePanel from './NineGridSourcePanel.vue'
import TexturePainter from './TexturePainter.vue'
import AtlasPreview from './AtlasPreview.vue'
import TerrainPreview from './TerrainPreview.vue'
import ExportPanel from './ExportPanel.vue'

const { t } = useI18n()
const route = useRoute()

const { instances: tabInstances, activeTabId, activeInstance, createTab: createTabRaw, switchTab: onTabSwitch, closeTab: onTabClose } = useEditorTabs<TilesetInstance>({
  prefix: 'tileset',
  factory: getTilesetInstance,
  destroy: removeTilesetInstance,
})
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

const tabs = computed<TabItem[]>(() =>
  tabInstances.value.map(inst => ({
    id: inst.id,
    label: inst.state.textureFileName || inst.state.nineGridFileName || t('common.newTab'),
    dirty: inst.state.isDirty,
  }))
)

const leftPanelConfig = definePanelConfig('tileset-panel-left', 300)
const rightPanelConfig = definePanelConfig('tileset-panel-right', 320)

function createTab(fileName?: string): TilesetInstance {
  const inst = createTabRaw()
  if (fileName) inst.state.textureFileName = fileName
  return inst
}

function onTabAddFile(file: File) {
  const inst = createTab(file.name)
  loadFileToInstance(inst, file)
}

function onTabLoadFile(file: File) {
  if (!activeInstance.value) return
  activeInstance.value.state.textureFileName = file.name
  loadFileToInstance(activeInstance.value, file)
}

function loadFileToInstance(inst: TilesetInstance, file: File) {
  if (inst.state.mode === 'sdf') {
    inst.loadTexture(file)
  } else {
    inst.loadNineGrid(file)
  }
}

async function loadFromResource(resourceUid: string) {
  const filePath = route.query.path as string | undefined
  if (!filePath) return
  try {
    const response = await fetch(filePath)
    if (!response.ok) return
    const blob = await response.blob()
    const file = new File([blob], filePath.split('/').pop() || 'texture.png', { type: blob.type })
    const inst = createTab(file.name)
    inst.state.resourceUid = resourceUid
    await inst.loadTexture(file)
  } catch { /* best-effort */ }
}

const { hasRouteResource } = useRouteResource(loadFromResource)

const showEmpty = computed(() => !activeInstance.value || !activeInstance.value.hasSource.value)
</script>

<template>
  <EditorShell
    :tabs="tabs"
    :active-tab-id="activeTabId"
    tab-accept="image/png,image/jpeg,image/webp"
    :left-panel="leftPanelConfig"
    :right-panel="rightPanelConfig"
    :left-collapsed="leftCollapsed"
    :right-collapsed="rightCollapsed"
    :show-empty="showEmpty"
    :loading="activeInstance?.state.isGenerating ?? false"
    :auto-empty-tab="!hasRouteResource"
    :viewport="{ accept: 'image/png,image/jpeg,image/webp', dropOverlayText: t('common.dropToOpen'), emptyState: { icon: 'upload', title: t('tileset.empty.title'), desc: activeInstance?.state.mode === 'sdf' ? t('tileset.empty.sdfHint') : t('tileset.empty.subtileHint') } }"
    @tab-switch="onTabSwitch"
    @tab-close="onTabClose"
    @tab-add-empty="createTab()"
    @tab-add-file="onTabAddFile"
    @tab-load-file="onTabLoadFile"
    @update:left-collapsed="leftCollapsed = $event"
    @update:right-collapsed="rightCollapsed = $event"
  >
    <!-- Left sidebar -->
    <template #left>
      <template v-if="activeInstance">
        <SidebarSection :title="t('tileset.mode.title')" icon="layers" :default-open="true">
          <div class="mode-tabs">
            <button
              :class="{ active: activeInstance.state.mode === 'sdf' }"
              @click="activeInstance.setMode('sdf')"
            >{{ t('tileset.mode.sdf') }}</button>
            <button
              :class="{ active: activeInstance.state.mode === 'subtile' }"
              @click="activeInstance.setMode('subtile')"
            >{{ t('tileset.mode.subtile') }}</button>
          </div>
        </SidebarSection>
        <TextureSourcePanel v-if="activeInstance.state.mode === 'sdf'" :store="activeInstance" />
        <NineGridSourcePanel v-else :store="activeInstance" />
      </template>
    </template>

    <!-- Viewport -->
    <template #viewport>
      <AtlasPreview v-if="activeInstance && activeInstance.hasSource.value" :store="activeInstance" />
    </template>

    <!-- Right sidebar -->
    <template #right>
      <template v-if="activeInstance">
        <TerrainPreview :store="activeInstance" />
        <ExportPanel :store="activeInstance" />
      </template>
    </template>
  </EditorShell>

  <!-- Texture Painter Dialog -->
  <TexturePainter
    v-if="activeInstance?.state.showPainter"
    @close="activeInstance!.state.showPainter = false"
  />
</template>

<style scoped>
.mode-tabs {
  display: flex;
  gap: 0;
}
.mode-tabs button {
  flex: 1;
  padding: 6px 12px;
  font-size: 11px;
  border: 1px solid #444;
  background: #2a2a2a;
  color: #888;
  cursor: pointer;
  transition: all 0.15s;
}
.mode-tabs button:first-child {
  border-radius: 4px 0 0 4px;
}
.mode-tabs button:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.mode-tabs button.active {
  background: #2a3a2e;
  color: #ade;
  border-color: #6a8;
}
</style>
