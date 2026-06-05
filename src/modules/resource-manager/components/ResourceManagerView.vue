<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import ConfirmDialog from '../../../shared/components/ConfirmDialog.vue'
import ContextMenu from '../../../shared/components/ContextMenu.vue'
import type { ContextMenuItem } from '../../../shared/components/ContextMenu.vue'
import { showToast } from '../../../shared/components/toast'
import { prompt } from '../../../shared/components/prompt'
import { useWorkspace, getWorkspaceHandle } from '../../../shared/workspace'
import { resolveDir, writeFile as fsWriteFile, listDirs } from '../../../shared/workspace/fs'
import { EditorShell, definePanelConfig } from '../../../shared/components/editor-shell'
import type { DropModifiers } from '../../../shared/components/editor-shell'
import DirectoryTree from './DirectoryTree.vue'
import FileGrid from './FileGrid.vue'
import FilePreview from './FilePreview.vue'
import type { FsEntry } from '../interfaces/meta'
import { createMetaForFile } from '../services/meta-service'
import { deleteFileFromWorkspace } from '../services/workspace-file-ops'
import { getWorkspaceCache, smartScan, fullScan, invalidateCache } from '../services/workspace-cache'
import { getHandlerByGsType, getAllHandlers } from '../../../shared/module-registry'
import { GsType } from '../../../shared/gs-format/types'
import { createGsFile } from '../../../shared/gs-format/writer'
import type { SceneRegionData } from '../../../shared/gs-format/types'
import { isImageFile, isGsFile } from '../../../shared/utils/file-type'

const router = useRouter()
const { t } = useI18n()
const { isOpen: wsOpen, openWorkspace } = useWorkspace()

const selectedFile = ref<FsEntry | null>(null)
const showDeleteConfirm = ref(false)
const deleteTarget = ref<FsEntry | null>(null)
const keyword = ref('')
const uploading = ref(false)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

const { scanResult, scanning } = getWorkspaceCache()
const rootHandle = ref<FileSystemDirectoryHandle | null>(null)
const selectedDirPath = ref('')
const expandedPaths = ref<Set<string>>(new Set())

const leftPanelConfig = definePanelConfig('rm-tree-width', 300)
const rightPanelConfig = definePanelConfig('rm-preview-width')

const wsFiles = computed<FsEntry[]>(() => {
  if (!scanResult.value) return []
  return collectFilesInDir(scanResult.value.tree, selectedDirPath.value)
})

const filteredWsFiles = computed<FsEntry[]>(() => {
  let files = wsFiles.value.filter(f => f.kind === 'file')
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    files = files.filter(f => f.name.toLowerCase().includes(kw))
  }
  return files
})

const treeEntries = computed<FsEntry[]>(() => {
  if (!scanResult.value) return []
  return scanResult.value.tree
})

const stats = computed(() => {
  if (!scanResult.value) return { total: 0, linked: 0, dirs: 0 }
  const total = countFiles(scanResult.value.tree)
  return { total, linked: scanResult.value.linked.length, dirs: countDirs(scanResult.value.tree) }
})

function collectFilesInDir(entries: FsEntry[], dirPath: string): FsEntry[] {
  if (!dirPath) return entries.filter(e => e.kind === 'file')
  const target = findDir(entries, dirPath)
  if (!target?.children) return []
  return target.children.filter(e => e.kind === 'file')
}

function findDir(entries: FsEntry[], path: string): FsEntry | null {
  for (const e of entries) {
    if (e.kind === 'directory' && e.path === path) return e
    if (e.children) {
      const found = findDir(e.children, path)
      if (found) return found
    }
  }
  return null
}

function countFiles(entries: FsEntry[]): number {
  let count = 0
  for (const e of entries) {
    if (e.kind === 'file') count++
    if (e.children) count += countFiles(e.children)
  }
  return count
}

function countDirs(entries: FsEntry[]): number {
  let count = 0
  for (const e of entries) {
    if (e.kind === 'directory') { count++; if (e.children) count += countDirs(e.children) }
  }
  return count
}

async function loadWorkspace(force = false) {
  const handle = getWorkspaceHandle()
  if (!handle) return
  rootHandle.value = handle

  try {
    const report = force ? await fullScan() : await smartScan()

    if (report && (report.repaired > 0 || report.newMetas > 0)) {
      showToast(`扫描完成：修复 ${report.repaired} 个绑定，新建 ${report.newMetas} 个元数据`, 'info')
    }

    if (scanResult.value) {
      for (const entry of scanResult.value.tree) {
        if (entry.kind === 'directory' && !expandedPaths.value.has(entry.path)) {
          expandedPaths.value.add(entry.path)
        }
      }
    }
  } catch (err) {
    console.error('[ResourceManager] scan error:', err)
    showToast('扫描工作区失败', 'error')
  }
}

async function handleRefresh() {
  selectedFile.value = null
  await loadWorkspace(true)
  showToast('已刷新', 'success')
}

function handleTreeSelect(path: string) {
  selectedDirPath.value = path
  selectedFile.value = null
}
function handleTreeToggle(path: string) {
  const s = new Set(expandedPaths.value)
  if (s.has(path)) s.delete(path); else s.add(path)
  expandedPaths.value = s
}
function handleShowRoot() {
  selectedDirPath.value = ''
  selectedFile.value = null
}

// --- Context menu state ---
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])
const ctxTarget = ref<{ type: 'file'; entry: FsEntry } | { type: 'dir'; path: string } | null>(null)


function handleFileSelect(entry: FsEntry) {
  selectedFile.value = entry
}

async function handleFileOpen(entry: FsEntry) {
  if (isGsFile(entry.name)) {
    await openGsFile(entry)
    return
  }
  // Legacy: .meta based routing
  if (entry.meta) {
    if (entry.meta.openWith === 'sprite-slicer' || entry.meta.type === 'spritesheet') {
      router.push({ path: '/sprite-slicer', query: { resource: entry.meta.uid, path: entry.path } })
    } else if (entry.meta.openWith === 'tileset-maker' || entry.meta.type === 'tile') {
      router.push({ path: '/tileset-maker', query: { resource: entry.meta.uid, path: entry.path } })
    }
  }
}

async function openGsFile(entry: FsEntry) {
  try {
    const fh = entry.handle as FileSystemFileHandle
    const text = await (await fh.getFile()).text()
    const parsed = JSON.parse(text)
    const handler = getHandlerByGsType(parsed.type)
    if (!handler) {
      showToast(`不支持的 .gs 类型: ${parsed.type}`, 'error')
      return
    }
    router.push({ path: handler.route, query: { gs: entry.path } })
  } catch (e) {
    showToast(`打开 .gs 文件失败: ${(e as Error).message}`, 'error')
  }
}

// --- File context menu ---
function handleFileContextMenu(entry: FsEntry, event: MouseEvent) {
  selectedFile.value = entry
  const items: ContextMenuItem[] = []

  if (isGsFile(entry.name)) {
    items.push({ id: 'open', label: '打开', icon: 'edit' })
    items.push({ id: 'sep-1', label: '', separator: true })
    items.push({ id: 'rename', label: '重命名', icon: 'pencil' })
    items.push({ id: 'delete', label: '删除', icon: 'trash' })
  } else if (isImageFile(entry.name)) {
    for (const handler of getAllHandlers()) {
      items.push({ id: `create-${handler.gsType}`, label: handler.createLabel, icon: handler.icon })
    }
    items.push({ id: 'sep-1', label: '', separator: true })
    items.push({ id: 'rename', label: '重命名', icon: 'pencil' })
    items.push({ id: 'delete', label: '删除', icon: 'trash' })
  } else {
    items.push({ id: 'rename', label: '重命名', icon: 'pencil' })
    items.push({ id: 'delete', label: '删除', icon: 'trash' })
  }

  ctxTarget.value = { type: 'file', entry }
  ctxItems.value = items
  ctxX.value = event.clientX
  ctxY.value = event.clientY
  ctxVisible.value = true
}

function handleDirContextMenu(path: string, event: MouseEvent) {
  ctxTarget.value = { type: 'dir', path }
  ctxItems.value = [
    { id: 'new-folder', label: '新建文件夹', icon: 'folder' },
    { id: 'upload', label: '上传文件', icon: 'upload' },
    { id: 'sep-1', label: '', separator: true },
    { id: 'delete-dir', label: '删除', icon: 'trash' },
  ]
  ctxX.value = event.clientX
  ctxY.value = event.clientY
  ctxVisible.value = true
}

async function handleCtxAction(id: string) {
  const target = ctxTarget.value
  if (!target) return

  if (id === 'open' && target.type === 'file') {
    await handleFileOpen(target.entry)
  } else if (id === 'delete' && target.type === 'file') {
    requestDelete(target.entry)
  } else if (id === 'rename' && target.type === 'file') {
    await handleRename(target.entry)
  } else if (id === 'new-folder') {
    await createFolder()
  } else if (id === 'upload') {
    triggerUpload()
  } else if (id.startsWith('create-') && target.type === 'file') {
    const gsType = Number(id.replace('create-', '')) as GsType
    await createGsFromImage(target.entry, gsType)
  }
}

async function handleRename(entry: FsEntry) {
  const newName = await prompt({
    title: '重命名',
    placeholder: entry.name,
    defaultValue: entry.name,
  })
  if (!newName || newName === entry.name) return

  try {
    const parentPath = entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/')) : ''
    const parentDir = await resolveDir(parentPath)
    const fh = entry.handle as FileSystemFileHandle
    const file = await fh.getFile()
    const buffer = await file.arrayBuffer()
    await fsWriteFile(parentDir, newName, new Uint8Array(buffer))
    await parentDir.removeEntry(entry.name)
    showToast(`已重命名为 ${newName}`, 'success')
    selectedFile.value = null
    await loadWorkspace()
  } catch (e) {
    showToast(`重命名失败: ${(e as Error).message}`, 'error')
  }
}

async function createGsFromImage(entry: FsEntry, gsType: GsType) {
  const baseName = entry.name.replace(/\.[^.]+$/, '')
  const name = await prompt({
    title: '新建资源',
    placeholder: baseName,
    defaultValue: baseName,
  })
  if (!name) return

  try {
    const parentPath = entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/')) : ''
    const gsPath = parentPath ? `${parentPath}/${name}.gs` : `${name}.gs`

    if (gsType === GsType.SceneRegion) {
      const fh = entry.handle as FileSystemFileHandle
      const blob = await fh.getFile()
      const bmp = await createImageBitmap(blob)
      const data: SceneRegionData = {
        name,
        texture: `./${entry.name}`,
        size: [bmp.width, bmp.height],
        y_sort: true,
        regions: [],
      }
      bmp.close()
      await createGsFile({ path: gsPath, type: GsType.SceneRegion, data })
    }

    showToast(`已创建 ${name}.gs`, 'success')
    await loadWorkspace()
    router.push({ path: getHandlerByGsType(gsType)!.route, query: { gs: gsPath } })
  } catch (e) {
    showToast(`创建失败: ${(e as Error).message}`, 'error')
  }
}

const uploadInput = ref<HTMLInputElement>()
function triggerUpload() {
  uploadInput.value?.click()
}

function requestDelete(entry: FsEntry) {
  deleteTarget.value = entry
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  showDeleteConfirm.value = false
  const target = deleteTarget.value
  if (!target || !rootHandle.value) return

  try {
    const { referencedBy } = await deleteFileFromWorkspace(target.path)
    if (referencedBy && referencedBy.length > 0) {
      showToast(`已删除 ${target.name}（${referencedBy.length} 个文件仍引用此资源）`, 'info')
    } else {
      showToast(`已删除 ${target.name}`, 'success')
    }
    selectedFile.value = null
    await loadWorkspace()
  } catch (err) {
    console.error('[ResourceManager] delete error:', err)
    showToast('删除失败', 'error')
  }
}

async function onViewportDrop(files: File[], _modifiers: DropModifiers) {
  if (!rootHandle.value || files.length === 0) return

  uploading.value = true
  try {
    const targetDir = await resolveDir(selectedDirPath.value, true)
    for (const file of files) {
      const buffer = await file.arrayBuffer()
      await fsWriteFile(targetDir, file.name, new Uint8Array(buffer))
      if (!isGsFile(file.name)) {
        await createMetaForFile(targetDir, file.name, buffer)
      }
    }
    showToast(`已上传 ${files.length} 个文件`, 'success')
    await loadWorkspace()
  } catch (err) {
    console.error('[ResourceManager] upload error:', err)
    showToast('上传失败', 'error')
  } finally {
    uploading.value = false
  }
}

async function onUploadFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !rootHandle.value) return

  uploading.value = true
  try {
    const targetDir = await resolveDir(selectedDirPath.value, true)
    const buffer = await file.arrayBuffer()
    await fsWriteFile(targetDir, file.name, new Uint8Array(buffer))
    if (!isGsFile(file.name)) {
      await createMetaForFile(targetDir, file.name, buffer)
    }
    showToast(`已上传 ${file.name}`, 'success')
    await loadWorkspace()
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function createFolder() {
  if (!rootHandle.value) return
  const dirs = await listDirs()
  const name = await prompt({
    title: t('resource.newFolderTitle'),
    placeholder: 'my-folder',
    suggestions: dirs,
  })
  if (!name) return
  try {
    const targetDir = await resolveDir(selectedDirPath.value)
    await targetDir.getDirectoryHandle(name, { create: true })
    showToast(`已创建文件夹 ${name}`, 'success')
    await loadWorkspace()
  } catch {
    showToast('创建文件夹失败', 'error')
  }
}

watch(wsOpen, (open) => {
  if (open) {
    loadWorkspace()
  } else {
    invalidateCache()
    rootHandle.value = null
  }
})

onMounted(() => {
  if (wsOpen.value) loadWorkspace()
})

const showRightPanel = computed(() => !!selectedFile.value)
</script>

<template>
  <div class="resource-manager">
    <!-- No workspace: guide page -->
    <template v-if="!wsOpen">
      <div class="rm-guide">
        <SvgIcon name="folder" :size="48" />
        <h3>{{ t('resource.noWorkspace') }}</h3>
        <p>{{ t('resource.noWorkspaceHint') }}</p>
        <button class="btn btn-primary" @click="openWorkspace()">
          <SvgIcon name="folder" :size="14" />
          {{ t('resource.openWorkspace') }}
        </button>
      </div>
    </template>

    <!-- Workspace connected: EditorShell layout -->
    <template v-else>
      <EditorShell
        :tabs="[]"
        :active-tab-id="null"
        :left-panel="leftPanelConfig"
        :right-panel="showRightPanel ? rightPanelConfig : undefined"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        :viewport="{ accept: '*/*', dropOverlayText: '拖放文件到此处上传' }"
        :managed-drop="false"
        @viewport-drop="onViewportDrop"
        @update:left-collapsed="leftCollapsed = $event"
        @update:right-collapsed="rightCollapsed = $event"
      >
        <!-- Left: directory tree -->
        <template #left>
          <div class="rm-tree-panel">
            <div class="tree-header">
              <button
                class="tree-root-btn"
                :class="{ active: selectedDirPath === '' }"
                @click="handleShowRoot"
              >
                <SvgIcon name="home" :size="11" />
                根目录
              </button>
              <span class="tree-stats">{{ stats.total }} 文件</span>
            </div>
            <DirectoryTree
              v-if="treeEntries.length > 0"
              :entries="treeEntries"
              :selected-path="selectedDirPath"
              :expanded-paths="expandedPaths"
              @select="(p: string) => handleTreeSelect(p)"
              @toggle="(p: string) => handleTreeToggle(p)"
              @contextmenu="handleDirContextMenu"
            />
          </div>
        </template>

        <!-- Center: toolbar + file grid -->
        <template #viewport>
          <div class="rm-viewport-content">
            <div class="rm-toolbar">
              <div class="search-box">
                <SvgIcon name="search" :size="14" />
                <input
                  type="text"
                  v-model="keyword"
                  :placeholder="t('common.search') + '...'"
                />
              </div>
              <div class="rm-toolbar-right">
                <button class="btn btn-sm" @click="handleRefresh" :disabled="scanning">
                  <SvgIcon name="loop" :size="12" />
                  {{ scanning ? '扫描中...' : '刷新' }}
                </button>
                <button class="btn btn-sm" @click="createFolder">
                  <SvgIcon name="folder" :size="12" />
                  新建
                </button>
                <label class="btn btn-sm">
                  <SvgIcon name="upload" :size="12" />
                  上传
                  <input type="file" style="display:none" @change="onUploadFile" accept="*/*" />
                </label>
              </div>
            </div>
            <div class="rm-grid-area">
              <div v-if="(scanning || uploading) && filteredWsFiles.length === 0" class="rm-loading">
                <SvgIcon name="loop" :size="24" />
                <span>正在扫描工作区...</span>
              </div>
              <FileGrid
                v-else
                :files="filteredWsFiles"
                :selected-file="selectedFile"
                @select="handleFileSelect"
                @open="handleFileOpen"
                @contextmenu="handleFileContextMenu"
              />
            </div>
          </div>
        </template>

        <!-- Right: file preview -->
        <template #right>
          <FilePreview
            v-if="selectedFile"
            :file="selectedFile"
            @delete="requestDelete"
          />
        </template>
      </EditorShell>
    </template>

    <ConfirmDialog
      :visible="showDeleteConfirm"
      :title="t('resource.deleteTitle')"
      :message="`确定要删除 ${deleteTarget?.name ?? ''} 吗？\n此操作将同时删除关联的 .meta 文件，且无法恢复。`"
      :confirm-text="t('common.delete')"
      :cancel-text="t('common.cancel')"
      :danger="true"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    />

    <ContextMenu
      :visible="ctxVisible"
      :x="ctxX"
      :y="ctxY"
      :items="ctxItems"
      @action="handleCtxAction"
      @close="ctxVisible = false"
    />

    <input ref="uploadInput" type="file" style="display:none" @change="onUploadFile" accept="*/*" />
  </div>
</template>

<style scoped>
.resource-manager {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.rm-guide {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #888;
  text-align: center;
  padding: 40px;
}
.rm-guide h3 { color: #ccc; font-size: 18px; margin: 0; }
.rm-guide p { font-size: 13px; line-height: 1.6; max-width: 360px; white-space: pre-line; }
.btn-primary { background: #3a7050; color: #e0f0e8; padding: 8px 20px; font-size: 13px; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
.btn-primary:hover { background: #4a8060; }

.rm-tree-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.tree-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #333; }
.tree-root-btn { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #aaa; background: none; border: none; cursor: pointer; padding: 3px 6px; border-radius: 3px; }
.tree-root-btn:hover { background: #333; color: #ddd; }
.tree-root-btn.active { background: #3a3a5a; color: #fff; }
.tree-stats { font-size: 10px; color: #666; }

.rm-viewport-content { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
.rm-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid #333; gap: 8px; flex-shrink: 0; }
.rm-toolbar-right { display: flex; align-items: center; gap: 6px; }
.search-box { display: flex; align-items: center; gap: 6px; background: #333; border: 1px solid #555; border-radius: 4px; padding: 3px 8px; color: #aaa; }
.search-box input { background: none; border: none; color: #eee; font-size: 12px; outline: none; width: 140px; }
.btn { display: flex; align-items: center; gap: 5px; padding: 4px 10px; background: #3a5070; color: #dde4f0; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.15s; }
.btn:hover { background: #4a6080; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rm-grid-area { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.rm-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #888; font-size: 13px; }
</style>
