<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../../shared/i18n'
import { EditorShell, SidebarSection, SegmentedControl, definePanelConfig, useTabRouteSync, EmptyDropHint } from '../../../shared/components/editor-shell'
import type { TabItem, DropModifiers } from '../../../shared/components/editor-shell'
import { ActionButtons } from '../../../shared/components/editor-shell'
import { useTilesetTabs, useTilesetTerrain, type TilesetInstance } from '../store'
import { showToast } from '../../../shared/components/toast'
import { prompt } from '../../../shared/components/prompt'
import { getWorkspaceHandle, splitPath } from '../../../shared/workspace'
import { resolveDir, writeFile as fsWriteFile } from '../../../shared/workspace/fs'
import TextureSourcePanel from './TextureSourcePanel.vue'
import NineGridSourcePanel from './NineGridSourcePanel.vue'
import TexturePainter from './TexturePainter.vue'
import AtlasPreview from './AtlasPreview.vue'
import TerrainCanvas from './TerrainCanvas.vue'
import ExportPanel from './ExportPanel.vue'

const { t } = useI18n()

const tabsManager = useTilesetTabs()
const { instances: tabInstances, activeTabId, activeInstance, createTab: createTabRaw, switchTab: onTabSwitch, closeTab: onTabClose } = tabsManager
useTabRouteSync({
  ...tabsManager,
  activeGsPath: computed(() => activeInstance.value?.state.gsPath ?? null),
  async loadPendingTabs() {
    for (const inst of tabInstances.value) {
      if (inst.state.gsPath && !inst.hasSource.value) {
        try { await inst.loadFromGsFile(inst.state.gsPath) } catch { /* workspace not ready */ }
      }
    }
  },
})

const terrainState = useTilesetTerrain()

const sidebarInstance = shallowRef<TilesetInstance | null>(null)
watch(activeInstance, (inst) => {
  if (inst) sidebarInstance.value = inst
}, { immediate: true })

const leftCollapsed = ref(false)
const splitPercent = ref(50)

const tabs = computed<TabItem[]>(() =>
  tabInstances.value.map((inst: TilesetInstance) => ({
    id: inst.id,
    label: inst.state.textureFileName || inst.state.nineGridFileName || (inst.state.gsPath ? splitPath(inst.state.gsPath).fileName.replace('.gs', '') : t('common.newTab')),
    dirty: inst.state.isDirty,
  }))
)

const leftPanelConfig = definePanelConfig('tileset-panel-left', 300)

const isTopEmpty = computed(() =>
  !activeInstance.value || !activeInstance.value.hasSource.value,
)

const isTopLoading = computed(() =>
  activeInstance.value?.state.isGenerating ?? false,
)

const isTopError = computed(() =>
  !!(activeInstance.value?.state.generateError && !activeInstance.value.state.atlasPixels),
)

watch(() => activeInstance.value?.id, (id) => {
  if (id) terrainState.setActiveTileset(id)
})

function createTab(fileName?: string): TilesetInstance {
  const inst = createTabRaw()
  const inheritedMode = activeInstance.value?.state.mode ?? 'sdf'
  inst.state.mode = inheritedMode
  if (fileName) {
    if (inheritedMode === 'sdf') {
      inst.state.textureFileName = fileName
    } else {
      inst.state.nineGridFileName = fileName
    }
  }
  return inst
}

function onTabAddFile(file: File) {
  if (isTopEmpty.value && activeInstance.value) {
    setFileNameForMode(activeInstance.value, file.name)
    loadFileToInstance(activeInstance.value, file)
  } else {
    const inst = createTab(file.name)
    loadFileToInstance(inst, file)
  }
}

function onViewportDrop(files: File[], modifiers: DropModifiers) {
  const file = files[0]
  if (!file) return
  if (modifiers.alt && activeInstance.value) {
    onTabLoadFile(file)
  } else if (isTopEmpty.value && activeInstance.value) {
    setFileNameForMode(activeInstance.value, file.name)
    loadFileToInstance(activeInstance.value, file)
  } else {
    onTabAddFile(file)
  }
}

function onTabLoadFile(file: File) {
  if (!activeInstance.value) return
  setFileNameForMode(activeInstance.value, file.name)
  loadFileToInstance(activeInstance.value, file)
}

function onEmptyFileSelect(file: File) {
  if (!activeInstance.value) return
  setFileNameForMode(activeInstance.value, file.name)
  loadFileToInstance(activeInstance.value, file)
}

function setFileNameForMode(inst: TilesetInstance, name: string) {
  if (inst.state.mode === 'sdf') {
    inst.state.textureFileName = name
  } else {
    inst.state.nineGridFileName = name
  }
}

function loadFileToInstance(inst: TilesetInstance, file: File) {
  if (inst.state.mode === 'sdf') {
    inst.loadTexture(file)
  } else {
    inst.loadNineGrid(file)
  }
}


// --- Split viewport resize ---
let splitResizing = false
let splitContainerRect: DOMRect | null = null

function startSplitResize(e: MouseEvent) {
  e.preventDefault()
  splitResizing = true
  const container = (e.target as HTMLElement).parentElement!
  splitContainerRect = container.getBoundingClientRect()
  document.addEventListener('mousemove', onSplitMove)
  document.addEventListener('mouseup', onSplitUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

function onSplitMove(e: MouseEvent) {
  if (!splitResizing || !splitContainerRect) return
  const y = e.clientY - splitContainerRect.top
  const pct = (y / splitContainerRect.height) * 100
  splitPercent.value = Math.max(20, Math.min(80, pct))
}

function onSplitUp() {
  splitResizing = false
  splitContainerRect = null
  document.removeEventListener('mousemove', onSplitMove)
  document.removeEventListener('mouseup', onSplitUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

async function onKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey
  if (!ctrl || !activeInstance.value) return
  if (e.key === 's') {
    e.preventDefault()
    await handleSave()
  }
}

async function handleSave() {
  const inst = activeInstance.value
  if (!inst) return

  if (!inst.state.gsPath) {
    if (!getWorkspaceHandle()) {
      showToast(t('workspace.openFirst'), 'info')
      return
    }
    await handleSaveAsNewGs(inst)
    return
  }

  try {
    const result = await inst.saveToGsFile()
    if (result.status === 'ok') {
      tabsManager.saveSession()
      showToast(t('common.saved'), 'success')
    } else {
      showToast(t('common.saveFailed'), 'error')
    }
  } catch (e: any) {
    showToast(e.message, 'error')
  }
}

async function handleSaveAsNewGs(inst: TilesetInstance) {
  const texName = inst.state.mode === 'sdf' ? inst.state.textureFileName : inst.state.nineGridFileName
  if (!texName) {
    showToast('没有关联的图片', 'error')
    return
  }
  const defaultName = texName.replace(/\.[^.]+$/, '')
  const name = await prompt({ title: t('tileset.saveAs'), defaultValue: defaultName })
  if (!name) return

  try {
    const dirHandle = await resolveDir('', true)

    const bitmap = inst.state.mode === 'sdf' ? inst.state.texture : inst.state.nineGridImage
    if (!bitmap) {
      showToast('没有关联的图片', 'error')
      return
    }
    const cv = new OffscreenCanvas(bitmap.width, bitmap.height)
    cv.getContext('2d')!.drawImage(bitmap, 0, 0)
    const blob = await cv.convertToBlob({ type: 'image/png' })
    const buffer = new Uint8Array(await blob.arrayBuffer())
    await fsWriteFile(dirHandle, texName, buffer)

    const gsPath = name.endsWith('.gs') ? name : `${name}.gs`

    const { createGsFile } = await import('../../../shared/gs-format/writer')
    const { GsType } = await import('../../../shared/gs-format/types')

    const textureSize: [number, number] = inst.state.mode === 'sdf'
      ? [inst.state.tileSize, inst.state.tileSize]
      : [inst.state.nineGridWidth, inst.state.nineGridHeight]

    const data: import('../../../shared/gs-format/types').TilesetData = {
      texture: `./${texName}`,
      size: textureSize,
      mode: inst.state.mode as 'sdf' | 'subtile',
      layout: inst.state.layout,
      terrainName: defaultName,
      sdfConfig: inst.state.mode === 'sdf' ? {
        tileSize: inst.state.tileSize,
        profile: { ...inst.state.profile },
      } : undefined,
      subtileConfig: inst.state.mode === 'subtile' ? {
        useMagenta: inst.state.useMagenta,
        magentaTolerance: inst.state.magentaTolerance,
      } : undefined,
    }

    const result = await createGsFile({
      path: gsPath,
      type: GsType.Tileset,
      data,
    })

    inst.state.gsPath = result.path
    inst.state.gsLastKnownVersion = result.version
    inst.state.isDirty = false
    tabsManager.saveSession()
    showToast(t('common.saved'), 'success')
  } catch (e: any) {
    showToast(`保存失败: ${e.message}`, 'error')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (splitResizing) onSplitUp()
})
</script>

<template>
  <EditorShell
    :tabs="tabs"
    :active-tab-id="activeTabId"
    tab-accept="image/png,image/jpeg,image/webp"
    :left-panel="leftPanelConfig"
    :left-collapsed="leftCollapsed"
    :show-empty="false"
    :loading="false"
    :managed-drop="false"
    :viewport="{ accept: 'image/png,image/jpeg,image/webp' }"
    @tab-switch="onTabSwitch"
    @tab-close="onTabClose"
    @tab-add-empty="createTab()"
    @tab-add-file="onTabAddFile"
    @tab-load-file="onTabLoadFile"
    @viewport-drop="onViewportDrop"
    @update:left-collapsed="leftCollapsed = $event"
  >
    <!-- Left sidebar -->
    <template #left>
      <template v-if="sidebarInstance">
        <SidebarSection :title="t('tileset.mode.title')" :collapsible="false">
          <SegmentedControl
            :model-value="sidebarInstance.state.mode"
            :options="[
              { value: 'sdf', label: t('tileset.mode.sdf') },
              { value: 'subtile', label: t('tileset.mode.subtile') },
            ]"
            @update:model-value="sidebarInstance.setMode($event as any)"
          />
        </SidebarSection>
        <TextureSourcePanel v-if="sidebarInstance.state.mode === 'sdf'" :store="sidebarInstance" />
        <NineGridSourcePanel v-else :store="sidebarInstance" />
        <ExportPanel :store="sidebarInstance" :terrain="terrainState" />
      </template>
      <div v-else class="sidebar-empty">
        <p class="sidebar-empty-hint">{{ t('tileset.empty.title') }}</p>
        <ActionButtons
          :buttons="[{ id: 'new', label: t('common.newTab'), icon: 'plus', variant: 'primary' }]"
          @click="createTab()"
        />
      </div>
    </template>

    <!-- Viewport: split top (atlas) + bottom (terrain) -->
    <template #viewport>
      <div class="split-viewport">
        <div class="split-top" :style="{ flex: `0 0 ${splitPercent}%` }">
          <!-- Loading -->
          <div v-if="isTopLoading" class="top-loading">
            <div class="loading-spinner" />
          </div>
          <!-- Empty state -->
          <EmptyDropHint
            v-else-if="isTopEmpty"
            accept="image/png,image/jpeg,image/webp"
            @select="onEmptyFileSelect"
          />
          <!-- Generate error -->
          <div v-else-if="isTopError" class="top-error">
            <span class="top-error-icon">⚠</span>
            <span>{{ activeInstance!.state.generateError }}</span>
          </div>
          <!-- Atlas preview -->
          <AtlasPreview v-else :store="activeInstance!" />
        </div>
        <div class="split-handle" @mousedown="startSplitResize">
          <div class="split-handle-line" />
        </div>
        <div class="split-bottom">
          <TerrainCanvas :terrain="terrainState" />
        </div>
      </div>
    </template>
  </EditorShell>

  <!-- Texture Painter Dialog -->
  <TexturePainter
    v-if="activeInstance?.state.showPainter"
    :store="activeInstance!"
    @close="activeInstance!.state.showPainter = false"
  />
</template>

<style scoped>
/* Sidebar empty state */
.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 16px;
  color: #666;
}
.sidebar-empty-hint {
  font-size: 12px;
  margin: 0;
  text-align: center;
}
/* Split viewport layout */
.split-viewport {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.split-top {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  min-height: 80px;
  border-bottom: 1px solid #333;
}
.split-bottom {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 80px;
}

/* Split handle */
.split-handle {
  height: 6px;
  cursor: row-resize;
  background: #1e1e1e;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}
.split-handle:hover {
  background: #2a2a2a;
}
.split-handle-line {
  width: 40px;
  height: 2px;
  border-radius: 1px;
  background: #444;
  transition: background 0.15s;
}
.split-handle:hover .split-handle-line {
  background: #6a8;
}

/* Top pane states */
.top-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}
.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #444;
  border-top-color: #8ab4f8;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.top-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #e88;
  font-size: 13px;
  padding: 24px;
  text-align: center;
}
.top-error-icon {
  font-size: 28px;
}
</style>
