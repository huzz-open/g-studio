<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import type { FsEntry } from '../interfaces/meta'

const props = defineProps<{
  file: FsEntry | null
}>()

const emit = defineEmits<{
  delete: [entry: FsEntry]
}>()

const router = useRouter()
const previewUrl = ref<string | null>(null)

function isImageFile(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.gif') || n.endsWith('.webp')
}

watch(() => props.file, async (f) => {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
  if (!f || f.kind !== 'file') return
  if (!isImageFile(f.name)) return
  try {
    const fh = f.handle as FileSystemFileHandle
    const blob = await fh.getFile()
    previewUrl.value = URL.createObjectURL(blob)
  } catch { /* skip */ }
}, { immediate: true })

function openInSlicer() {
  if (!props.file?.meta?.uid) return
  router.push({ path: '/sprite-slicer', query: { resource: props.file.meta.uid, path: props.file.path } })
}

function openInTilesetMaker() {
  if (!props.file?.meta?.uid) return
  router.push({ path: '/tileset-maker', query: { resource: props.file.meta.uid, path: props.file.path } })
}

function formatDate(ts?: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}
</script>

<template>
  <aside v-if="file" class="file-preview">
    <h4>{{ file.name }}</h4>
    <div class="preview-img checker-bg">
      <img v-if="previewUrl" :src="previewUrl" />
      <SvgIcon v-else name="image" :size="32" />
    </div>

    <div class="preview-meta">
      <div class="meta-row">
        <span>类型</span>
        <span>{{ file.meta?.type ?? 'generic' }}</span>
      </div>
      <div class="meta-row">
        <span>UID</span>
        <span class="uid-text">{{ file.meta?.uid ?? '-' }}</span>
      </div>
      <div v-if="file.meta?.tags?.length" class="meta-row">
        <span>标签</span>
        <span>{{ file.meta.tags.join(', ') }}</span>
      </div>
      <div class="meta-row">
        <span>来源</span>
        <span>{{ file.meta?.origin?.source ?? 'external' }}</span>
      </div>
      <div class="meta-row">
        <span>创建时间</span>
        <span>{{ formatDate(file.meta?.createdAt) }}</span>
      </div>
      <div class="meta-row">
        <span>更新时间</span>
        <span>{{ formatDate(file.meta?.updatedAt) }}</span>
      </div>
      <div v-if="file.meta?.description" class="meta-row">
        <span>描述</span>
        <span>{{ file.meta.description }}</span>
      </div>
    </div>

    <div class="preview-actions">
      <button
        v-if="file.meta?.openWith === 'sprite-slicer' || file.meta?.type === 'spritesheet'"
        class="btn btn-sm"
        @click="openInSlicer"
      >
        <SvgIcon name="scissors" :size="12" />
        在切分器中打开
      </button>
      <button
        v-if="file.meta?.openWith === 'tileset-maker' || file.meta?.type === 'tile'"
        class="btn btn-sm"
        @click="openInTilesetMaker"
      >
        <SvgIcon name="grid" :size="12" />
        在瓦片集制作中打开
      </button>
      <button class="btn btn-sm btn-danger" @click="emit('delete', file)">
        <SvgIcon name="trash" :size="12" />
        删除
      </button>
    </div>

    <div v-if="file.meta?.pipeline?.length" class="preview-pipeline">
      <h5>操作历史</h5>
      <div v-for="(step, idx) in file.meta.pipeline" :key="idx" class="pipeline-step">
        <span class="step-name">{{ step.step }}</span>
        <span class="step-detail">{{ step.detail ?? '' }}</span>
        <span class="step-time">{{ formatDate(step.at) }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.file-preview {
  width: 260px;
  border-left: 1px solid #3a3a3a;
  padding: 12px;
  overflow-y: auto;
  background: #252525;
  flex-shrink: 0;
}
.file-preview h4 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #eee;
  word-break: break-all;
}
.preview-img {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
  color: #555;
}
.checker-bg {
  background: repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 0 0 / 16px 16px;
}
.preview-img img {
  max-width: 100%;
  max-height: 100%;
  image-rendering: pixelated;
  object-fit: contain;
}
.preview-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}
.meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.meta-row span:first-child { color: #888; }
.meta-row span:last-child { color: #ccc; text-align: right; max-width: 140px; word-break: break-all; }
.uid-text { font-family: monospace; font-size: 10px; }
.preview-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: #3a5070;
  color: #dde4f0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.15s;
}
.btn:hover { background: #4a6080; }
.btn-danger { background: #6a3a3a; color: #f0d0d0; }
.btn-danger:hover { background: #7a4a4a; }
.preview-pipeline {
  border-top: 1px solid #3a3a3a;
  padding-top: 10px;
}
.preview-pipeline h5 {
  margin: 0 0 8px;
  font-size: 11px;
  color: #999;
}
.pipeline-step {
  display: flex;
  flex-direction: column;
  padding: 4px 0;
  border-bottom: 1px solid #2e2e2e;
  font-size: 10px;
}
.step-name { color: #aab; font-weight: 500; }
.step-detail { color: #777; }
.step-time { color: #555; }
</style>
