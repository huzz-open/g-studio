<script setup lang="ts">
import { ref, watch, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../../../shared/i18n'
import { useSlicerStore } from '../store'
import { useWorkspace } from '../../../shared/workspace'
import {
  saveFileToWorkspace,
  saveFileBatch,
  readFileFromWorkspace,
  readMetaFile,
  isWorkspaceConnected,
} from '../../resource-manager'
import type { SaveFileOptions } from '../../resource-manager'
import type { SlicerModuleData } from '../../resource-manager'
import { notifyFileChanged } from '../../resource-manager'
import { resolveDir, splitPath } from '../../../shared/workspace/fs'
import type { FsErrorKind } from '../../../shared/workspace/fs'
import { getWorkspaceHandle } from '../../../shared/workspace'
import { readUidIndex } from '../../resource-manager'
import { useSettings } from '../../../shared/settings'
import type { OutputPayload } from './SlicerSidebar.vue'
import { showToast, withProgress } from '../../../shared/components/toast'
import { confirm } from '../../../shared/components/confirm'
import { EditorShell } from '../../../shared/components/editor-shell'
import type { TabItem, PanelConfig, DropModifiers } from '../../../shared/components/editor-shell'
import SlicerSidebar from './SlicerSidebar.vue'
import SlicerPreview from './SlicerPreview.vue'
import AnimationPreview from './AnimationPreview.vue'
import FileDropZone from '../../../shared/components/FileDropZone.vue'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const store = useSlicerStore()
const { isOpen: wsOpen } = useWorkspace()
const { settings: appSettings } = useSettings()
const showAnimPreview = ref(false)
const loadingResource = ref(false)
const leftCollapsed = ref(false)

const leftPanelConfig: PanelConfig = {
  width: { default: 300, min: 180, max: 480 },
  persistKey: 'slicer-sidebar-width',
}

const tabs = computed<TabItem[]>(() =>
  store.tabs.value.map(tab => ({
    id: tab.id,
    label: tab.fileName,
    dirty: store.isTabModified(tab.id),
  }))
)

const showEmpty = computed(() => !store.sourceImage.value && !loadingResource.value)

function guessMime(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'image/png'
  }
}

function showLoadError(error: FsErrorKind) {
  switch (error) {
    case 'not-found': showToast(t('slicer.load.notFound'), 'error'); break
    case 'parse-error':
    case 'invalid-schema': showToast(t('slicer.load.corrupt'), 'error'); break
    case 'permission-denied': showToast(t('slicer.load.permDenied'), 'error'); break
    default: showToast(t('slicer.load.unknownError'), 'error')
  }
}

async function loadFromResource(_resourceId: string): Promise<void> {
  loadingResource.value = true
  try {
    let filePath = route.query.path as string | undefined
    const resourceUid = route.query.resource as string | undefined
    if (!filePath || !isWorkspaceConnected()) {
      showToast(t('slicer.save.needWorkspace'), 'error')
      return
    }

    if (resourceUid) {
      const existingTab = store.tabs.value.find(tab => tab.resourceUid === resourceUid)
      if (existingTab) {
        if (store.isTabModified(existingTab.id)) {
          const switchToExisting = await confirm({
            title: t('slicer.load.alreadyOpenTitle'),
            message: t('slicer.load.alreadyOpenMsg', { name: existingTab.fileName }),
            confirmText: t('slicer.load.switchToExisting'),
            cancelText: t('slicer.load.openOriginal'),
          })
          if (switchToExisting) {
            store.switchTab(existingTab.id)
            router.replace({ path: '/sprite-slicer' })
            return
          }
          store.removeTab(existingTab.id)
        } else {
          store.switchTab(existingTab.id)
          router.replace({ path: '/sprite-slicer' })
          return
        }
      }
    }

    let result = await readFileFromWorkspace(filePath)

    if (!result.ok && result.error === 'not-found' && resourceUid) {
      const root = getWorkspaceHandle()
      if (root) {
        const uidIndex = await readUidIndex(root)
        const altPath = uidIndex[resourceUid]
        if (altPath && altPath !== filePath) {
          filePath = altPath
          result = await readFileFromWorkspace(filePath)
        }
      }
    }

    if (!result.ok) {
      showLoadError(result.error)
      return
    }

    const { data: fileData, meta } = result.data
    const fileUid = meta?.uid ?? resourceUid
    const { fileName: resourceFileName } = splitPath(filePath)
    const mime = guessMime(resourceFileName)
    const blob = new Blob([fileData as BlobPart], { type: mime })
    const file = new File([blob], resourceFileName || 'spritesheet.png', { type: mime })

    const slicerData = meta?.moduleData?.['sprite-slicer'] as SlicerModuleData | undefined
    const isComposite = slicerData?.isComposite === true

    if (isComposite && slicerData?.sprites && slicerData.sprites.length > 0) {
      store.setPendingMetaRestore({ sprites: slicerData.sprites })
    }

    store.addTab(file, filePath, fileUid)

    if (isComposite && slicerData?.sliceConfig) {
      store.applySliceConfig(slicerData.sliceConfig)
    }
    router.replace({ path: '/sprite-slicer' })
  } finally {
    loadingResource.value = false
  }
}

onMounted(() => {
  const resourceId = route.query.resource as string | undefined
  if (resourceId) {
    void loadFromResource(resourceId)
  }
})

watch(() => route.query.resource, (newId) => {
  if (newId && typeof newId === 'string') {
    void loadFromResource(newId)
  }
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
  let saved = 0
  let skipped = 0
  for (const tab of store.tabs.value) {
    if (tab.workspacePath) continue
    try {
      const isActive = tab.id === store.activeTabId.value
      const img = isActive
        ? store.sourceImage.value
        : store.getTabSnapshot(tab.id)?.sourceImage ?? null
      if (!img) { skipped++; continue }
      const cv = document.createElement('canvas')
      cv.width = img.width; cv.height = img.height
      cv.getContext('2d')!.drawImage(img, 0, 0)
      const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'))
      if (!blob) continue
      const data = new Uint8Array(await blob.arrayBuffer())
      const result = await saveFileToWorkspace({
        fileName: tab.fileName,
        data,
        type: 'spritesheet',
        dir: 'spritesheets',
        openWith: 'sprite-slicer',
        origin: { source: 'uploaded', method: 'sprite-slicer/upload', createdBy: 'g-studio', importedAt: Date.now() },
        pipeline: [{ step: 'upload', at: Date.now(), detail: `synced from slicer: ${tab.fileName}` }],
      })
      tab.workspacePath = result.path
      tab.resourceUid = result.uid
      saved++
    } catch { /* skip failed ones */ }
  }
  if (saved > 0) {
    showToast(t('slicer.workspace.syncDone', { count: saved }), 'success')
  }
  if (skipped > 0) {
    showToast(t('slicer.workspace.syncSkipped', { count: skipped }), 'info')
  }
}

async function offerSaveToWorkspace(file: File) {
  if (!isWorkspaceConnected()) return
  if (wsOpen.value) {
    void saveOriginalToWorkspace(file)
    return
  }
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
    const result = await saveFileToWorkspace({
      fileName: file.name,
      data,
      type: 'spritesheet',
      dir: 'spritesheets',
      openWith: 'sprite-slicer',
      origin: { source: 'uploaded', method: 'sprite-slicer/upload', createdBy: 'g-studio', importedAt: Date.now() },
      pipeline: [{ step: 'upload', at: Date.now(), detail: `slicer upload: ${file.name}` }],
    })
    const tab = store.tabs.value.find(t => t.fileName === file.name && !t.workspacePath)
    if (tab) {
      tab.workspacePath = result.path
      tab.resourceUid = result.uid
    }
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

function onViewportDrop(files: File[], modifiers: DropModifiers) {
  const file = files[0]
  if (!file || !file.type.startsWith('image/')) return
  const replace = modifiers.alt && store.hasActiveTab.value
  if (replace) {
    store.loadFile(file)
  } else {
    store.addTab(file)
  }
}

function onTabSwitch(id: string) {
  store.switchTab(id)
}

function onTabClose(id: string) {
  store.removeTab(id)
}

function getPrefix(): string {
  return store.namePrefix.value || 'sprites'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function generateMetaJson(): Blob {
  const sprites = store.selectedSprites.value
  const mode = store.arrangeMode.value
  const prefix = getPrefix()

  const base: Record<string, any> = {
    image: `${prefix}.png`,
    size: { w: store.imgSize.value.w, h: store.imgSize.value.h },
  }

  if (mode === 'standardize') {
    const opts = store.stdOptions.value
    const tw = opts.targetWidth
    const th = opts.targetHeight
    base.layout = 'grid'
    base.cols = opts.cols
    base.rows = opts.rows
    base.cellWidth = tw
    base.cellHeight = th
    base.sprites = sprites.map(s => {
      const origW = s._origRect ? s._origRect.w : s.rect.w
      const origH = s._origRect ? s._origRect.h : s.rect.h
      return {
        name: s.name,
        x: Math.round((tw - origW) / 2),
        y: Math.round((th - origH) / 2),
        w: origW,
        h: origH,
      }
    })
  } else {
    base.layout = mode === 'bin-pack' ? 'packed' : 'none'
    base.sprites = sprites.map(s => ({
      name: s.name,
      x: s.rect.x,
      y: s.rect.y,
      w: s.rect.w,
      h: s.rect.h,
    }))
  }

  return new Blob([JSON.stringify(base, null, 2)], { type: 'application/json' })
}

async function exportLocal(payload: OutputPayload) {
  store.saving.value = true
  try {
    const prefix = getPrefix()
    const files: { name: string; blob: Blob }[] = []

    if (payload.composite) {
      const url = store.cleanImageUrl.value
      if (url) {
        const resp = await fetch(url)
        files.push({ name: `${prefix}.png`, blob: await resp.blob() })
      }
    }

    if (payload.sprites) {
      for (const sprite of store.selectedSprites.value) {
        const resp = await fetch(sprite.dataUrl)
        files.push({ name: `sprites/${sprite.name}.png`, blob: await resp.blob() })
      }
    }

    if (payload.meta) {
      files.push({ name: `${prefix}-meta.json`, blob: generateMetaJson() })
    }

    if (files.length === 0) return

    if (files.length === 1) {
      downloadBlob(files[0].blob, files[0].name)
    } else {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      for (const f of files) zip.file(f.name, f.blob)
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, `${prefix}.zip`)
    }
  } catch (e) {
    showToast(t('toast.save.error'), 'error')
  } finally {
    store.saving.value = false
  }
}

async function saveToWorkspace(payload: OutputPayload) {
  if (!isWorkspaceConnected()) return
  store.saving.value = true
  try {
    await withProgress(
      t('slicer.save.saving'),
      t('toast.save.success'),
      t('toast.save.error'),
      async () => {
        const tab = store.tabs.value.find(t => t.id === store.activeTabId.value)
        const baseName = tab?.fileName.replace(/\.[^.]+$/, '') ?? 'spritesheet'
        const dir = payload.dir
        const now = Date.now()

        let sourceUid: string | undefined
        if (tab?.workspacePath) {
          const { dir: sourceDirPath, fileName: sourceFileName } = splitPath(tab.workspacePath)
          try {
            const sourceDir = sourceDirPath ? await resolveDir(sourceDirPath) : getWorkspaceHandle()!
            const sourceMeta = await readMetaFile(sourceDir, sourceFileName)
            if (sourceMeta) sourceUid = sourceMeta.uid
          } catch { /* source may not exist */ }
        }

        const derivedRelations = sourceUid
          ? [{ rel: 'derived-from' as const, uid: sourceUid }]
          : []
        const originBase = {
          source: 'derived' as const,
          createdBy: 'g-studio' as const,
          importedAt: now,
          sourceFiles: sourceUid ? [sourceUid] : undefined,
        }

        const batchFiles: SaveFileOptions[] = []

        if (payload.composite) {
          const cleanUrl = store.cleanImageUrl.value
          let pngBlob: Blob | null = null
          if (cleanUrl) {
            const resp = await fetch(cleanUrl)
            pngBlob = await resp.blob()
          }
          if (pngBlob) {
            const data = new Uint8Array(await pngBlob.arrayBuffer())
            const slicerModuleData: SlicerModuleData = {
              sliceConfig: store.getSliceConfig(),
              sprites: store.getSpriteSnapshot(),
              isComposite: true,
            }
            let compositeName = `${baseName}.png`
            if (tab?.workspacePath) {
              const { dir: srcDirPath, fileName: srcFileName } = splitPath(tab.workspacePath)
              if (srcFileName === compositeName && srcDirPath === dir) {
                compositeName = `${baseName}-sheet.png`
              }
            }
            batchFiles.push({
              fileName: compositeName,
              data,
              type: 'spritesheet',
              dir,
              tags: payload.tags,
              openWith: 'sprite-slicer',
              moduleData: { 'sprite-slicer': slicerModuleData },
              origin: { ...originBase, method: `sprite-slicer/${store.arrangeMode.value || 'none'}` },
              pipeline: [{ step: 'save', at: now, detail: 'saved from slicer' }],
              relations: derivedRelations,
              sourceUid,
            })
          }
        }

        if (payload.sprites) {
          for (const sprite of store.selectedSprites.value) {
            const resp = await fetch(sprite.dataUrl)
            const blob = await resp.blob()
            const data = new Uint8Array(await blob.arrayBuffer())
            batchFiles.push({
              fileName: `${sprite.name}.png`,
              data,
              type: 'generic',
              dir,
              tags: payload.tags,
              origin: { ...originBase, method: 'sprite-slicer/slice' },
              pipeline: [{ step: 'slice', at: now, detail: 'sliced from spritesheet' }],
              relations: derivedRelations,
              sourceUid,
            })
          }
        }

        if (payload.meta) {
          const metaBlob = generateMetaJson()
          const metaData = new Uint8Array(await metaBlob.arrayBuffer())
          batchFiles.push({
            fileName: `${baseName}-meta.json`,
            data: metaData,
            type: 'generic',
            dir,
            tags: payload.tags,
            origin: { ...originBase, method: 'sprite-slicer/meta-export' },
            pipeline: [{ step: 'meta-export', at: now, detail: 'sprite metadata JSON' }],
            relations: derivedRelations,
            sourceUid,
          })
        }

        if (batchFiles.length > 0) {
          const sliceConfig = store.getSliceConfig()
          await saveFileBatch({
            files: batchFiles,
            sourceMetaUpdate: (meta) => {
              meta.moduleData = meta.moduleData ?? {}
              meta.moduleData['sprite-slicer'] = { sliceConfig }
            },
          })
        }

        appSettings.spriteSlicer.lastSaveDir = dir
        appSettings.spriteSlicer.lastTags = [...payload.tags]

        notifyFileChanged()
      },
    )
  } finally {
    store.saving.value = false
  }
}

watch(() => store.bgRemoverId.value, () => {
  if (store.isRestoring()) return
  store.processBackground()
})
watch(() => store.bgColor.value, () => {
  if (store.isRestoring()) return
  store.processBackground()
}, { deep: true })

let bgDebounce = 0
watch([() => store.bgTolerance.value, () => store.bgSpillStrength.value], () => {
  if (store.isRestoring()) return
  clearTimeout(bgDebounce)
  bgDebounce = window.setTimeout(() => store.processBackground(), 50)
})

watch([() => store.mergeGap.value, () => store.minArea.value], () => {
  if (store.isRestoring()) return
  if (store.detectionMode.value === 'auto') store.runDetection()
})

watch([() => store.cols.value, () => store.rows.value, () => store.gapH.value, () => store.gapV.value, () => store.marginH.value, () => store.marginV.value], () => {
  if (store.isRestoring()) return
  if (store.detectionMode.value === 'grid') store.runDetection()
})

watch(() => store.arrangeMode.value, () => {
  if (store.isRestoring()) return
  store.applyArrange()
})

watch(() => store.namePrefix.value, () => {
  if (store.isRestoring()) return
  const prefix = store.namePrefix.value || 'sprite'
  store.sprites.value.forEach((s, i) => {
    s.name = `${prefix}-${String(i + 1).padStart(2, '0')}`
  })
})
</script>

<template>
  <EditorShell
    :tabs="tabs"
    :active-tab-id="store.activeTabId.value"
    tab-accept="image/png,image/jpeg,image/webp"
    :left-panel="leftPanelConfig"
    :left-collapsed="leftCollapsed"
    :show-empty="showEmpty"
    :loading="loadingResource"
    :viewport="{ accept: 'image/png,image/jpeg,image/webp', dropOverlayText: t('common.dropToOpen'), altDropOverlayText: t('common.dropToReplace'), emptyState: { icon: 'upload', titleKey: t('slicer.upload.desc'), descKey: t('slicer.upload.hint') } }"
    @tab-switch="onTabSwitch"
    @tab-close="onTabClose"
    @tab-add-file="onAddFile"
    @viewport-drop="onViewportDrop"
    @update:left-collapsed="leftCollapsed = $event"
  >
    <!-- Left sidebar -->
    <template #left>
      <SlicerSidebar
        :store="store"
        :has-image="!!store.sourceImage.value"
        @file="onFile"
        @show-anim="showAnimPreview = true"
        @export-local="exportLocal"
        @save-workspace="saveToWorkspace"
      />
    </template>

    <!-- Viewport -->
    <template #viewport>
      <template v-if="loadingResource">
        <div class="resource-loading">
          <SvgIcon name="loop" :size="24" />
          <span>{{ t('slicer.upload.processing') }}</span>
        </div>
      </template>
      <template v-else-if="store.sourceImage.value">
        <SlicerPreview :store="store" />
      </template>
      <template v-else-if="!showEmpty">
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
  </EditorShell>

  <AnimationPreview
    v-if="showAnimPreview"
    :frames="store.selectedSprites.value"
    @close="showAnimPreview = false"
  />
</template>

<style scoped>
.upload-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
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
