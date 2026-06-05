<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import type { FsEntry } from '../interfaces/meta'
import { getHandlerByGsType } from '../../../shared/module-registry'
import { GsType } from '../../../shared/gs-format/types'
import { isImageFile, isGsFile } from '../../../shared/utils/file-type'

const props = defineProps<{
  files: FsEntry[]
  selectedFile: FsEntry | null
}>()

const emit = defineEmits<{
  select: [entry: FsEntry]
  open: [entry: FsEntry]
  contextmenu: [entry: FsEntry, event: MouseEvent]
}>()

const thumbCache = ref<Map<string, string>>(new Map())
const gsInfoCache = ref<Map<string, { type: GsType; summary: string }>>(new Map())

watch(() => props.files, (newFiles, oldFiles) => {
  if (oldFiles) {
    const newPaths = new Set(newFiles.map(f => f.path))
    for (const [path, url] of thumbCache.value) {
      if (!newPaths.has(path)) {
        URL.revokeObjectURL(url)
        thumbCache.value.delete(path)
      }
    }
  }
  loadThumbnails()
  loadGsInfo()
}, { immediate: true })

onUnmounted(() => {
  for (const url of thumbCache.value.values()) {
    URL.revokeObjectURL(url)
  }
})


async function loadThumbnails() {
  for (const file of props.files) {
    if (thumbCache.value.has(file.path)) continue
    if (file.kind !== 'file') continue
    if (!isImageFile(file.name)) continue

    try {
      const fh = file.handle as FileSystemFileHandle
      const blob = await fh.getFile()
      const url = URL.createObjectURL(blob)
      thumbCache.value = new Map(thumbCache.value).set(file.path, url)
    } catch { /* skip */ }
  }
}

async function loadGsInfo() {
  for (const file of props.files) {
    if (gsInfoCache.value.has(file.path)) continue
    if (file.kind !== 'file') continue
    if (!isGsFile(file.name)) continue

    try {
      const fh = file.handle as FileSystemFileHandle
      const text = await (await fh.getFile()).text()
      const parsed = JSON.parse(text)
      const gsType = parsed.type as GsType
      const handler = getHandlerByGsType(gsType)
      const summary = handler ? handler.fileSummary(parsed.data) : ''
      gsInfoCache.value = new Map(gsInfoCache.value).set(file.path, { type: gsType, summary })
    } catch { /* skip */ }
  }
}

function typeIcon(entry: FsEntry): string {
  if (isGsFile(entry.name)) {
    const info = gsInfoCache.value.get(entry.path)
    if (info) {
      const handler = getHandlerByGsType(info.type)
      if (handler) return handler.icon
    }
    return 'file-text'
  }
  const name = entry.name.toLowerCase()
  if (name.endsWith('.json')) return 'file-text'
  if (isImageFile(entry.name)) return 'image'
  return 'file-text'
}

function typeLabel(entry: FsEntry): string {
  if (isGsFile(entry.name)) {
    const info = gsInfoCache.value.get(entry.path)
    if (info) {
      const handler = getHandlerByGsType(info.type)
      return handler ? handler.label : `gs:${info.type}`
    }
    return 'gs'
  }
  const ext = entry.name.includes('.') ? entry.name.split('.').pop()! : 'file'
  return ext
}

function gsCardSummary(entry: FsEntry): string {
  const info = gsInfoCache.value.get(entry.path)
  return info?.summary ?? ''
}

function onContextMenu(entry: FsEntry, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  emit('contextmenu', entry, event)
}
</script>

<template>
  <div class="file-grid" v-if="files.length > 0">
    <div
      v-for="file in files"
      :key="file.path"
      class="file-card"
      :class="{ selected: selectedFile?.path === file.path, 'gs-card': isGsFile(file.name) }"
      @click="emit('select', file)"
      @dblclick="emit('open', file)"
      @contextmenu="onContextMenu(file, $event)"
    >
      <div class="card-thumb">
        <img
          v-if="thumbCache.get(file.path)"
          :src="thumbCache.get(file.path)!"
          loading="lazy"
        />
        <SvgIcon v-else :name="typeIcon(file)" :size="24" />
      </div>
      <div class="card-info">
        <span class="card-name" :title="file.name">{{ file.name }}</span>
        <span class="card-type">{{ typeLabel(file) }}</span>
        <span v-if="isGsFile(file.name) && gsCardSummary(file)" class="card-summary">{{ gsCardSummary(file) }}</span>
      </div>
      <div v-if="isGsFile(file.name)" class="card-badge gs-badge" title=".gs">
        <SvgIcon name="file-text" :size="8" />
      </div>
    </div>
  </div>
  <div v-else class="file-empty">
    <SvgIcon name="folder" :size="36" />
    <p>此目录为空</p>
  </div>
</template>

<style scoped>
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  align-content: start;
}
.file-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: #2a2a2a;
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.12s;
  overflow: hidden;
}
.file-card:hover { border-color: #555; }
.file-card.selected { border-color: #5577aa; }
.card-thumb {
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-conic-gradient(#333 0% 25%, #282828 0% 50%) 0 0 / 12px 12px;
  color: #555;
}
.card-thumb img {
  max-width: 100%;
  max-height: 100%;
  image-rendering: pixelated;
  object-fit: contain;
}
.card-info {
  padding: 5px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-name {
  font-size: 11px;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-type {
  font-size: 10px;
  color: #777;
}
.card-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  background: rgba(50, 80, 120, 0.7);
  border-radius: 3px;
  padding: 2px 4px;
  color: #8ab;
}
.file-card.gs-card {
  border-color: rgba(100, 160, 120, 0.3);
}
.file-card.gs-card:hover {
  border-color: rgba(100, 160, 120, 0.6);
}
.card-summary {
  font-size: 9px;
  color: #6a9;
}
.gs-badge {
  background: rgba(60, 120, 80, 0.7);
  color: #8cb8a0;
}
.file-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #555;
  gap: 10px;
  font-size: 13px;
}
</style>
