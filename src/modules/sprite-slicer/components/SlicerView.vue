<script setup lang="ts">
import { ref, watch, reactive, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../../../shared/i18n'
import { useSlicerStore } from '../store'
import { useWorkspace } from '../../../shared/workspace'
import {
  saveFileToWorkspace,
  saveSpritesheetToWorkspace,
  readFileFromWorkspace,
  isWorkspaceConnected,
} from '../../resource-manager'
import type { SlicerModuleData, MetaResourceType } from '../../resource-manager'
import { PngExporter } from '../core/export/png-exporter'
import { SlicerDraftService, type SlicerSession, type SlicerDraft } from '../services/draft-service'
import { getStorage } from '../../../shared/storage'
import { showToast } from '../../../shared/components/toast'
import { confirm } from '../../../shared/components/confirm'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import FileDropZone from '../../../shared/components/FileDropZone.vue'
import SlicerTabBar from './SlicerTabBar.vue'
import SlicerSidebar from './SlicerSidebar.vue'
import SlicerPreview from './SlicerPreview.vue'
import AnimationPreview from './AnimationPreview.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const store = useSlicerStore()
const { isOpen: wsOpen } = useWorkspace()
const showAnimPreview = ref(false)
const exporter = new PngExporter()
const restoring = ref(false)
const loadingResource = ref(false)

let draftService: SlicerDraftService | null = null
let draftSaveTimer = 0

async function getDraftService(): Promise<SlicerDraftService> {
  if (!draftService) {
    const storage = await getStorage()
    draftService = new SlicerDraftService(storage)
  }
  return draftService
}

function scheduleDraftSave() {
  if (restoring.value || store.isRestoring()) return
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = window.setTimeout(() => void saveDraft(), 1000)
}

async function saveDraft(): Promise<void> {
  if (store.tabs.value.length === 0) {
    const svc = await getDraftService()
    await svc.deleteSession()
    return
  }

  const svc = await getDraftService()
  const tabs: SlicerDraft[] = []

  for (const tabInfo of store.tabs.value) {
    const isActive = tabInfo.id === store.activeTabId.value
    const draft: SlicerDraft = {
      id: tabInfo.id,
      fileName: tabInfo.fileName,
      imageBlobKey: tabInfo.workspacePath ? '' : `slicer-drafts/${tabInfo.id}.png`,
      workspacePath: tabInfo.workspacePath,
      params: {
        bgRemoverId: store.bgRemoverId.value,
        bgColor: [...store.bgColor.value] as [number, number, number],
        bgTolerance: store.bgTolerance.value,
        bgSpillStrength: store.bgSpillStrength.value,
        detectionMode: isActive ? store.detectionMode.value : 'auto',
        mergeGap: isActive ? store.mergeGap.value : 3,
        minArea: isActive ? store.minArea.value : 50,
        cols: isActive ? store.cols.value : 6,
        rows: isActive ? store.rows.value : 6,
        gapH: isActive ? store.gapH.value : 0,
        gapV: isActive ? store.gapV.value : 0,
        marginH: isActive ? store.marginH.value : 0,
        marginV: isActive ? store.marginV.value : 0,
        namePrefix: isActive ? store.namePrefix.value : 'sprite',
        stdEnabled: isActive ? store.stdEnabled.value : false,
      },
      spriteNames: isActive ? store.sprites.value.map(s => s.name) : [],
      selectedIds: isActive ? [...store.selected.value] : [],
    }
    tabs.push(draft)
  }

  const session: SlicerSession = {
    id: 'current',
    activeTabId: store.activeTabId.value,
    tabs,
    savedAt: Date.now(),
  }
  await svc.saveSession(session)
}

async function tryRestoreSession(): Promise<void> {
  const svc = await getDraftService()
  const session = await svc.loadSession()
  if (!session || session.tabs.length === 0) return

  restoring.value = true
  try {
    const activeIdx = session.tabs.findIndex(t => t.id === session.activeTabId)
    const activeDraftIdx = activeIdx >= 0 ? activeIdx : 0

    for (const draft of session.tabs) {
      let fileData: Uint8Array | null = null

      if (draft.workspacePath && isWorkspaceConnected()) {
        const result = await readFileFromWorkspace(draft.workspacePath)
        if (result) fileData = result.data
      }
      if (!fileData && draft.imageBlobKey) {
        fileData = await svc.loadImageBlob(draft.imageBlobKey)
      }
      if (!fileData) continue

      const blob = new Blob([fileData as unknown as BlobPart], { type: 'image/png' })
      const file = new File([blob], draft.fileName, { type: 'image/png' })
      store.addTab(file, draft.workspacePath)
    }

    if (store.tabs.value.length === 0) return

    const targetTab = store.tabs.value[Math.min(activeDraftIdx, store.tabs.value.length - 1)]
    if (targetTab.id !== store.activeTabId.value) {
      store.switchTab(targetTab.id)
    }

    const activeDraft = session.tabs[activeDraftIdx]
    if (activeDraft?.params) {
      const p = activeDraft.params
      store.bgRemoverId.value = p.bgRemoverId
      store.bgColor.value = [...p.bgColor] as [number, number, number]
      store.bgTolerance.value = p.bgTolerance
      store.bgSpillStrength.value = p.bgSpillStrength
      store.detectionMode.value = p.detectionMode
      store.mergeGap.value = p.mergeGap
      store.minArea.value = p.minArea
      store.cols.value = p.cols
      store.rows.value = p.rows
      store.gapH.value = p.gapH
      store.gapV.value = p.gapV
      store.marginH.value = p.marginH
      store.marginV.value = p.marginV
      store.namePrefix.value = p.namePrefix
      store.stdEnabled.value = p.stdEnabled
    }
  } finally {
    restoring.value = false
  }
}

async function loadFromResource(_resourceId: string): Promise<void> {
  loadingResource.value = true
  restoring.value = true
  try {
    const filePath = route.query.path as string | undefined
    if (!filePath || !isWorkspaceConnected()) {
      showToast(t('slicer.save.needWorkspace'), 'error')
      return
    }

    const result = await readFileFromWorkspace(filePath)
    if (!result) {
      showToast(t('toast.save.error'), 'error')
      return
    }
    const blob = new Blob([result.data as BlobPart], { type: 'image/png' })
    const fileName = filePath.split('/').pop() ?? 'spritesheet.png'
    const file = new File([blob], fileName, { type: 'image/png' })
    store.addTab(file, filePath)

    const sc = result.meta?.moduleData?.['sprite-slicer']?.sliceConfig as Record<string, unknown> | undefined
    if (sc) {
      if (sc.bgRemoverId) store.bgRemoverId.value = sc.bgRemoverId as string
      if (sc.bgColor) store.bgColor.value = sc.bgColor as [number, number, number]
      if (sc.bgTolerance !== undefined) store.bgTolerance.value = sc.bgTolerance as number
      if (sc.mergeGap !== undefined) store.mergeGap.value = sc.mergeGap as number
      if (sc.minArea !== undefined) store.minArea.value = sc.minArea as number
      if (sc.cols !== undefined) store.cols.value = sc.cols as number
      if (sc.rows !== undefined) store.rows.value = sc.rows as number
      if (sc.gapH !== undefined) store.gapH.value = sc.gapH as number
      if (sc.gapV !== undefined) store.gapV.value = sc.gapV as number
      if (sc.marginH !== undefined) store.marginH.value = sc.marginH as number
      if (sc.marginV !== undefined) store.marginV.value = sc.marginV as number
      if (sc.stdEnabled) {
        store.detectionMode.value = 'grid'
      } else if (sc.detectionMode) {
        store.detectionMode.value = sc.detectionMode as 'auto' | 'grid'
      }
    }
    router.replace({ path: '/sprite-slicer' })
  } finally {
    restoring.value = false
    loadingResource.value = false
  }
}

onMounted(() => {
  const resourceId = route.query.resource as string | undefined
  if (resourceId) {
    void loadFromResource(resourceId)
  } else if (store.tabs.value.length === 0) {
    void tryRestoreSession()
  }
})

watch(() => route.query.resource, (newId) => {
  if (newId && typeof newId === 'string') {
    void loadFromResource(newId)
  }
})

onUnmounted(() => {
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
})

watch(wsOpen, async (connected) => {
  if (!connected) return
  const unsyncedTabs = store.tabs.value.filter(t => !t.workspacePath)
  if (unsyncedTabs.length === 0) return
  const ok = await confirm({
    title: t('slicer.workspace.syncOffer', { count: unsyncedTabs.length }),
    message: t('slicer.workspace.syncConfirmMsg', { count: unsyncedTabs.length }),
    confirmText: t('slicer.workspace.syncAction'),
  })
  if (ok) void syncAllTabsToWorkspace()
})

async function syncAllTabsToWorkspace() {
  const svc = await getDraftService()
  let saved = 0
  for (const tab of store.tabs.value) {
    if (tab.workspacePath) continue
    try {
      const blobKey = `slicer-drafts/${tab.id}.png`
      const blobData = await svc.loadImageBlob(blobKey)
      if (!blobData) continue
      await saveFileToWorkspace({
        fileName: tab.fileName,
        data: blobData,
        type: 'spritesheet',
        dir: 'spritesheets',
        openWith: 'sprite-slicer',
        origin: { source: 'uploaded', method: 'sprite-slicer/upload', createdBy: 'g-studio', importedAt: Date.now() },
        pipeline: [{ step: 'upload', at: Date.now(), detail: `synced from slicer: ${tab.fileName}` }],
      })
      saved++
    } catch { /* skip failed ones */ }
  }
  if (saved > 0) {
    showToast(t('slicer.workspace.syncDone', { count: saved }), 'success')
  }
}

async function offerSaveToWorkspace(file: File) {
  if (!isWorkspaceConnected()) return
  const ok = await confirm({
    title: t('slicer.upload.saveOffer'),
    message: t('slicer.upload.saveConfirmMsg', { name: file.name }),
    confirmText: t('slicer.upload.saveAction'),
  })
  if (ok) void saveOriginalToWorkspace(file)
}

async function saveOriginalToWorkspace(file: File) {
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    await saveFileToWorkspace({
      fileName: file.name,
      data,
      type: 'spritesheet',
      dir: 'spritesheets',
      openWith: 'sprite-slicer',
      origin: { source: 'uploaded', method: 'sprite-slicer/upload', createdBy: 'g-studio', importedAt: Date.now() },
      pipeline: [{ step: 'upload', at: Date.now(), detail: `slicer upload: ${file.name}` }],
    })
    showToast(t('toast.save.success'), 'success')
  } catch {
    showToast(t('toast.save.error'), 'error')
  }
}

function onFile(file: File) {
  store.addTab(file)
  offerSaveToWorkspace(file)
}

function onAddFile(file: File) {
  store.addTab(file)
  offerSaveToWorkspace(file)
}

const viewportDrag = reactive({ active: false, alt: false })
function onViewportDragOver(e: DragEvent) {
  e.preventDefault()
  viewportDrag.active = true
  viewportDrag.alt = e.altKey
}
function onViewportDragLeave() {
  viewportDrag.active = false
  viewportDrag.alt = false
}
function onViewportDrop(e: DragEvent) {
  e.preventDefault()
  const replace = e.altKey && store.hasActiveTab.value
  viewportDrag.active = false
  viewportDrag.alt = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) {
    if (replace) {
      store.loadFile(file)
    } else {
      store.addTab(file)
    }
  }
}

async function saveToResources(type: MetaResourceType) {
  if (!isWorkspaceConnected()) {
    showToast(t('slicer.save.needWorkspace'), 'error')
    return
  }
  const sel = store.selectedSprites.value
  if (sel.length === 0) return
  store.saving.value = true
  try {
    const typeToDir: Record<string, string> = {
      icon: 'icons', animation: 'animations', spritesheet: 'spritesheets',
      tile: 'tiles', item: 'items', generic: 'exports',
    }
    const dir = typeToDir[type] ?? 'exports'

    for (const sprite of sel) {
      const resp = await fetch(sprite.dataUrl)
      const blob = await resp.blob()
      const data = new Uint8Array(await blob.arrayBuffer())
      await saveFileToWorkspace({
        fileName: `${sprite.name}.png`,
        data,
        type,
        dir,
        origin: { source: 'derived', method: 'sprite-slicer/slice', createdBy: 'g-studio', importedAt: Date.now() },
        pipeline: [{ step: 'slice', at: Date.now(), detail: `sliced from spritesheet` }],
      })
    }
    showToast(t('toast.save.success'), 'success')
  } catch {
    showToast(t('toast.save.error'), 'error')
  } finally {
    store.saving.value = false
  }
}

async function saveAsSpritesheet() {
  if (!isWorkspaceConnected()) {
    showToast(t('slicer.save.needWorkspace'), 'error')
    return
  }
  const img = store.sourceImage.value
  if (!img || store.sprites.value.length === 0) return
  store.saving.value = true
  try {
    let pngBlob: Blob | null

    const cleanUrl = store.cleanImageUrl.value
    if (store.stdEnabled.value && cleanUrl) {
      const resp = await fetch(cleanUrl)
      pngBlob = await resp.blob()
    } else {
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      const ctx = cv.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      pngBlob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'))
    }
    if (!pngBlob) return
    const data = new Uint8Array(await pngBlob.arrayBuffer())

    const tab = store.tabs.value.find(t => t.id === store.activeTabId.value)
    const name = tab?.fileName.replace(/\.[^.]+$/, '') ?? 'spritesheet'

    const slicerModuleData: SlicerModuleData = {
      sliceConfig: {
        detectionMode: store.detectionMode.value,
        bgRemoverId: store.bgRemoverId.value,
        bgColor: [...store.bgColor.value],
        bgTolerance: store.bgTolerance.value,
        cols: store.cols.value,
        rows: store.rows.value,
        gapH: store.gapH.value,
        gapV: store.gapV.value,
        marginH: store.marginH.value,
        marginV: store.marginV.value,
        stdEnabled: store.stdEnabled.value,
      },
      sprites: store.sprites.value.map(s => ({
        name: s.name,
        rect: { ...s.rect },
      })),
    }

    await saveSpritesheetToWorkspace(
      `${name}.png`,
      data,
      slicerModuleData,
    )
    showToast(t('toast.save.spritesheet'), 'success')
  } catch {
    showToast(t('toast.save.error'), 'error')
  } finally {
    store.saving.value = false
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

async function exportPng() {
  const data = store.getCleanImageData()
  if (!data) return
  const blob = await exporter.exportPng(store.selectedSprites.value, data)
  downloadBlob(blob, `${store.namePrefix.value || 'sprites'}.png`)
  showToast(t('toast.export.success'), 'success')
}

async function exportZip() {
  const blob = await exporter.exportZip(store.selectedSprites.value)
  downloadBlob(blob, `${store.namePrefix.value || 'sprites'}.zip`)
  showToast(t('toast.export.success'), 'success')
}

async function exportMeta() {
  const blob = await exporter.exportMetaJson(store.selectedSprites.value)
  downloadBlob(blob, `${store.namePrefix.value || 'sprites'}-meta.json`)
  showToast(t('toast.export.success'), 'success')
}

watch(() => store.bgRemoverId.value, () => {
  if (store.isRestoring()) return
  store.processBackground()
  scheduleDraftSave()
})
watch(() => store.bgColor.value, () => {
  if (store.isRestoring()) return
  store.processBackground()
  scheduleDraftSave()
}, { deep: true })

let bgDebounce = 0
watch([() => store.bgTolerance.value, () => store.bgSpillStrength.value], () => {
  if (store.isRestoring()) return
  clearTimeout(bgDebounce)
  bgDebounce = window.setTimeout(() => { store.processBackground(); scheduleDraftSave() }, 50)
})

watch([() => store.mergeGap.value, () => store.minArea.value], () => {
  if (store.isRestoring()) return
  if (store.detectionMode.value === 'auto') store.runDetection()
  scheduleDraftSave()
})

watch([() => store.cols.value, () => store.rows.value, () => store.gapH.value, () => store.gapV.value, () => store.marginH.value, () => store.marginV.value], () => {
  if (store.isRestoring()) return
  if (store.detectionMode.value === 'grid') store.runDetection()
  scheduleDraftSave()
})

watch(() => store.stdEnabled.value, () => {
  if (store.isRestoring()) return
  store.applyStandardize()
  scheduleDraftSave()
})

watch(() => store.namePrefix.value, () => {
  if (store.isRestoring()) return
  const prefix = store.namePrefix.value || 'sprite'
  store.sprites.value.forEach((s, i) => {
    s.name = `${prefix}-${String(i + 1).padStart(2, '0')}`
  })
  scheduleDraftSave()
})

watch(() => store.sourceImage.value, (img) => {
  if (!img || store.isRestoring() || restoring.value) return
  const activeTab = store.tabs.value.find(t => t.id === store.activeTabId.value)
  if (activeTab?.workspacePath) {
    scheduleDraftSave()
    return
  }
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  cv.toBlob(blob => {
    if (!blob || !store.activeTabId.value) return
    void (async () => {
      const data = new Uint8Array(await blob.arrayBuffer())
      const svc = await getDraftService()
      await svc.saveImageBlob(store.activeTabId.value!, data)
      scheduleDraftSave()
    })()
  }, 'image/png')
})

watch(() => store.tabs.value.length, () => {
  scheduleDraftSave()
})
</script>

<template>
  <div class="slicer-view">
    <SlicerSidebar
      :store="store"
      :has-image="!!store.sourceImage.value"
      @file="onFile"
      @save="(t: string) => saveToResources(t as MetaResourceType)"
      @save-spritesheet="saveAsSpritesheet"
      @show-anim="showAnimPreview = true"
      @export-png="exportPng"
      @export-zip="exportZip"
      @export-meta="exportMeta"
    />

    <div
      class="slicer-main"
      :class="{ 'drop-highlight': viewportDrag.active }"
      @dragover="onViewportDragOver"
      @dragleave="onViewportDragLeave"
      @drop="onViewportDrop"
    >
      <template v-if="loadingResource">
        <div class="resource-loading">
          <SvgIcon name="loop" :size="24" />
          <span>{{ t('slicer.upload.processing') }}</span>
        </div>
      </template>
      <template v-else>
        <SlicerTabBar
          v-if="store.tabs.value.length > 0"
          :tabs="store.tabs.value"
          :active-tab-id="store.activeTabId.value"
          @switch="store.switchTab($event)"
          @close="store.removeTab($event)"
          @add-file="onAddFile"
        />

        <template v-if="store.sourceImage.value">
          <SlicerPreview :store="store" />
        </template>
        <template v-else>
          <div class="upload-stage">
            <FileDropZone
              accept="image/png,image/jpeg,image/webp"
              :hint="store.loading.value ? t('slicer.upload.processing') : t('slicer.upload.hint')"
              :description="t('slicer.upload.desc')"
              :loading="store.loading.value"
              icon="upload"
              @file="onAddFile"
            />
          </div>
        </template>
      </template>

      <div v-if="viewportDrag.active" class="drop-overlay" :class="{ replace: viewportDrag.alt }">
        <span class="drop-overlay-text">{{ viewportDrag.alt ? t('common.dropToReplace') : t('common.dropToOpen') }}</span>
      </div>
    </div>

    <AnimationPreview
      v-if="showAnimPreview"
      :frames="store.selectedSprites.value"
      @close="showAnimPreview = false"
    />
  </div>
</template>

<style scoped>
.slicer-view {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.slicer-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.upload-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.slicer-main.drop-highlight {
  position: relative;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: rgba(30, 50, 80, 0.55);
  border: 2px dashed #5577aa;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.drop-overlay.replace {
  background: rgba(80, 50, 30, 0.55);
  border-color: #aa7755;
}
.drop-overlay-text {
  font-size: 16px;
  color: #aac8ee;
  font-weight: 500;
  padding: 10px 24px;
  background: rgba(0,0,0,0.4);
  border-radius: 8px;
}
.resource-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #888;
  font-size: 14px;
}
.resource-loading svg {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
