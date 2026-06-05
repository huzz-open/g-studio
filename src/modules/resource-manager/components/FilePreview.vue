<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import { ActionButtons } from '../../../shared/components/editor-shell/sidebar-atoms'
import type { ActionButton } from '../../../shared/components/editor-shell/sidebar-atoms'
import type { FsEntry } from '../interfaces/meta'
import { getHandlerByGsType } from '../../../shared/module-registry'
import { GsType } from '../../../shared/gs-format/types'
import { isImageFile, isGsFile } from '../../../shared/utils/file-type'

const props = defineProps<{
  file: FsEntry | null
}>()

const emit = defineEmits<{
  delete: [entry: FsEntry]
}>()

const router = useRouter()
const previewUrl = ref<string | null>(null)
const gsInfo = ref<{ type: GsType; version: number; gen: string; summary: string } | null>(null)


watch(() => props.file, async (f) => {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
  gsInfo.value = null

  if (!f || f.kind !== 'file') return

  if (isGsFile(f.name)) {
    try {
      const fh = f.handle as FileSystemFileHandle
      const text = await (await fh.getFile()).text()
      const parsed = JSON.parse(text)
      const handler = getHandlerByGsType(parsed.type)
      gsInfo.value = {
        type: parsed.type,
        version: parsed.version,
        gen: parsed.gen,
        summary: handler ? handler.fileSummary(parsed.data) : '',
      }
    } catch { /* skip */ }
    return
  }

  if (!isImageFile(f.name)) return
  try {
    const fh = f.handle as FileSystemFileHandle
    const blob = await fh.getFile()
    previewUrl.value = URL.createObjectURL(blob)
  } catch { /* skip */ }
}, { immediate: true })

const actionButtons = computed<ActionButton[]>(() => {
  const btns: ActionButton[] = []
  const f = props.file
  if (!f) return btns

  if (isGsFile(f.name) && gsInfo.value) {
    const handler = getHandlerByGsType(gsInfo.value.type)
    if (handler) {
      btns.push({ id: 'open-gs', label: `在${handler.label}中打开`, icon: handler.icon })
    }
  }

  btns.push({ id: 'delete', label: '删除', icon: 'trash', variant: 'danger' })
  return btns
})

function onAction(id: string) {
  const f = props.file
  if (!f) return

  if (id === 'open-gs' && gsInfo.value) {
    const handler = getHandlerByGsType(gsInfo.value.type)
    if (handler) {
      router.push({ path: handler.route, query: { gs: f.path } })
    }
  } else if (id === 'delete') {
    emit('delete', f)
  }
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
      <template v-if="gsInfo">
        <div class="meta-row">
          <span>类型</span>
          <span class="gs-type-badge">{{ gsInfo.type === 1 ? '场景区域' : gsInfo.type === 2 ? '瓦片集' : gsInfo.type === 3 ? '精灵切分' : '未知' }}</span>
        </div>
        <div class="meta-row">
          <span>版本</span>
          <span>v{{ gsInfo.version }}</span>
        </div>
        <div class="meta-row">
          <span>生成工具</span>
          <span>{{ gsInfo.gen }}</span>
        </div>
        <div v-if="gsInfo.summary" class="meta-row">
          <span>摘要</span>
          <span>{{ gsInfo.summary }}</span>
        </div>
      </template>
      <template v-else>
        <div class="meta-row">
          <span>路径</span>
          <span>{{ file.path }}</span>
        </div>
      </template>
    </div>

    <div class="preview-actions">
      <ActionButtons
        :buttons="actionButtons"
        direction="column"
        @click="onAction"
      />
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
.gs-type-badge { color: #8cb8a0; font-weight: 500; }
.preview-actions {
  margin-bottom: 12px;
}
</style>
