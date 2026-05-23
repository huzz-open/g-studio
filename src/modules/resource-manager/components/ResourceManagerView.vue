<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../../../shared/i18n'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import ConfirmDialog from '../../../shared/components/ConfirmDialog.vue'
import { showToast } from '../../../shared/components/toast'
import { useWorkspace, getWorkspaceHandle } from '../../../shared/workspace'
import DirectoryTree from './DirectoryTree.vue'
import FileGrid from './FileGrid.vue'
import FilePreview from './FilePreview.vue'
import type { FsEntry } from '../interfaces/meta'
import { deleteMetaFile, createMetaForFile } from '../services/meta-service'
import { getWorkspaceCache, smartScan, fullScan, invalidateCache } from '../services/workspace-cache'

const router = useRouter()
const { t } = useI18n()
const { isOpen: wsOpen, openWorkspace } = useWorkspace()

const selectedFile = ref<FsEntry | null>(null)
const showDeleteConfirm = ref(false)
const deleteTarget = ref<FsEntry | null>(null)
const keyword = ref('')
const uploading = ref(false)

const { scanResult, scanning } = getWorkspaceCache()
const rootHandle = ref<FileSystemDirectoryHandle | null>(null)
const selectedDirPath = ref('')
const expandedPaths = ref<Set<string>>(new Set())
const showMetaFiles = ref(false)

const wsFiles = computed<FsEntry[]>(() => {
  if (!scanResult.value) return []
  return collectFilesInDir(scanResult.value.tree, selectedDirPath.value)
})

const filteredWsFiles = computed<FsEntry[]>(() => {
  let files = wsFiles.value
  if (!showMetaFiles.value) {
    files = files.filter(f => f.kind === 'file')
  }
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

function handleFileSelect(entry: FsEntry) {
  selectedFile.value = entry
}

function handleFileOpen(entry: FsEntry) {
  if (!entry.meta) return
  if (entry.meta.openWith === 'sprite-slicer' || entry.meta.type === 'spritesheet') {
    router.push({ path: '/sprite-slicer', query: { resource: entry.meta.uid, path: entry.path } })
  }
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
    const dirPath = target.path.includes('/') ? target.path.substring(0, target.path.lastIndexOf('/')) : ''
    let dirHandle = rootHandle.value
    if (dirPath) {
      for (const p of dirPath.split('/')) dirHandle = await dirHandle.getDirectoryHandle(p)
    }
    await dirHandle.removeEntry(target.name)
    await deleteMetaFile(dirHandle, target.name)
    showToast(`已删除 ${target.name}`, 'success')
    selectedFile.value = null
    await loadWorkspace()
  } catch (err) {
    console.error('[ResourceManager] delete error:', err)
    showToast('删除失败', 'error')
  }
}

async function onDropFiles(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0 || !rootHandle.value) return

  uploading.value = true
  try {
    let targetDir = rootHandle.value
    if (selectedDirPath.value) {
      for (const p of selectedDirPath.value.split('/')) targetDir = await targetDir.getDirectoryHandle(p, { create: true })
    }
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const fh = await targetDir.getFileHandle(file.name, { create: true })
      const writable = await fh.createWritable()
      await writable.write(file)
      await writable.close()
      const buffer = await file.arrayBuffer()
      await createMetaForFile(targetDir, file.name, buffer)
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
    let targetDir = rootHandle.value
    if (selectedDirPath.value) {
      for (const p of selectedDirPath.value.split('/')) targetDir = await targetDir.getDirectoryHandle(p, { create: true })
    }
    const fh = await targetDir.getFileHandle(file.name, { create: true })
    const writable = await fh.createWritable()
    await writable.write(file)
    await writable.close()
    const buffer = await file.arrayBuffer()
    await createMetaForFile(targetDir, file.name, buffer)
    showToast(`已上传 ${file.name}`, 'success')
    await loadWorkspace()
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function createFolder() {
  if (!rootHandle.value) return
  const name = prompt('文件夹名称:')
  if (!name) return
  try {
    let targetDir = rootHandle.value
    if (selectedDirPath.value) {
      for (const p of selectedDirPath.value.split('/')) targetDir = await targetDir.getDirectoryHandle(p)
    }
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
</script>

<template>
  <div class="resource-manager">
    <!-- No workspace: guide page -->
    <template v-if="!wsOpen">
      <div class="rm-guide">
        <SvgIcon name="folder" :size="48" />
        <h3>{{ t('resource.noWorkspace') }}</h3>
        <p>{{ t('resource.noWorkspaceHint') }}</p>
        <button class="btn btn-primary" @click="openWorkspace">
          <SvgIcon name="folder" :size="14" />
          {{ t('resource.openWorkspace') }}
        </button>
      </div>
    </template>

    <!-- Workspace connected: file system browser -->
    <template v-else>
      <div class="rm-toolbar">
        <div class="rm-toolbar-left">
          <button
            class="btn btn-sm"
            @click="handleShowRoot"
            :class="{ active: selectedDirPath === '' }"
          >
            <SvgIcon name="home" :size="12" />
            根目录
          </button>
          <div class="search-box">
            <SvgIcon name="search" :size="14" />
            <input
              type="text"
              v-model="keyword"
              :placeholder="t('common.search') + '...'"
            />
          </div>
          <span class="count">
            {{ stats.total }} 个文件 · {{ stats.dirs }} 个目录
          </span>
        </div>
        <div class="rm-toolbar-right">
          <label class="meta-toggle">
            <input type="checkbox" v-model="showMetaFiles" />
            <span>显示 .meta</span>
          </label>
          <button class="btn btn-sm" @click="handleRefresh" :disabled="scanning">
            <SvgIcon name="loop" :size="12" />
            {{ scanning ? '扫描中...' : '刷新' }}
          </button>
          <button class="btn btn-sm" @click="createFolder">
            <SvgIcon name="folder" :size="12" />
            新建文件夹
          </button>
          <label class="btn btn-sm">
            <SvgIcon name="upload" :size="12" />
            上传
            <input type="file" style="display:none" @change="onUploadFile" accept="*/*" />
          </label>
        </div>
      </div>

      <div
        class="rm-body"
        @dragover.prevent
        @drop="onDropFiles"
      >
        <div class="rm-sidebar" v-if="treeEntries.length > 0">
          <DirectoryTree
            :entries="treeEntries"
            :selected-path="selectedDirPath"
            :expanded-paths="expandedPaths"
            @select="(p: string) => handleTreeSelect(p)"
            @toggle="(p: string) => handleTreeToggle(p)"
          />
        </div>

        <div class="rm-content">
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
          />
        </div>

        <FilePreview
          v-if="selectedFile"
          :file="selectedFile"
          @delete="requestDelete"
        />
      </div>
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
.rm-guide h3 {
  color: #ccc;
  font-size: 18px;
  margin: 0;
}
.rm-guide p {
  font-size: 13px;
  line-height: 1.6;
  max-width: 360px;
  white-space: pre-line;
}
.btn-primary {
  background: #3a7050;
  color: #e0f0e8;
  padding: 8px 20px;
  font-size: 13px;
}
.btn-primary:hover { background: #4a8060; }
.rm-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #3a3a3a;
  background: #252525;
  gap: 10px;
  flex-wrap: wrap;
}
.rm-toolbar-left, .rm-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 3px 8px;
  color: #aaa;
}
.search-box input {
  background: none;
  border: none;
  color: #eee;
  font-size: 12px;
  outline: none;
  width: 140px;
}
.count { font-size: 11px; color: #888; display: flex; align-items: center; gap: 6px; }
.meta-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #888;
  cursor: pointer;
}
.meta-toggle input { accent-color: #5577aa; }
.btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: #3a5070;
  color: #dde4f0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.15s;
}
.btn:hover { background: #4a6080; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.active { background: #4a6080; }
.rm-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.rm-sidebar {
  width: 220px;
  border-right: 1px solid #3a3a3a;
  overflow-y: auto;
  padding: 8px;
  background: #232323;
  flex-shrink: 0;
}
.rm-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.rm-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #888;
  font-size: 13px;
}
</style>
