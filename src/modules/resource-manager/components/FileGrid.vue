<script setup lang="ts">
import { ref, watch } from 'vue'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import type { FsEntry } from '../interfaces/meta'

const props = defineProps<{
  files: FsEntry[]
  selectedFile: FsEntry | null
}>()

const emit = defineEmits<{
  select: [entry: FsEntry]
  open: [entry: FsEntry]
}>()

const thumbCache = ref<Map<string, string>>(new Map())

watch(() => props.files, () => {
  loadThumbnails()
}, { immediate: true })

function isImageFile(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.gif') || n.endsWith('.webp')
}

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

function typeIcon(entry: FsEntry): string {
  if (entry.meta?.type === 'spritesheet') return 'grid'
  if (entry.meta?.type === 'map-data') return 'map'
  const name = entry.name.toLowerCase()
  if (name.endsWith('.json')) return 'file-text'
  return 'image'
}

function typeLabel(entry: FsEntry): string {
  return entry.meta?.type ?? 'generic'
}
</script>

<template>
  <div class="file-grid" v-if="files.length > 0">
    <div
      v-for="file in files"
      :key="file.path"
      class="file-card"
      :class="{ selected: selectedFile?.path === file.path }"
      @click="emit('select', file)"
      @dblclick="emit('open', file)"
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
      </div>
      <div v-if="file.meta?.uid" class="card-badge" :title="file.meta.uid">
        <SvgIcon name="link" :size="8" />
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
