<script setup lang="ts">
import { ref } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'

const props = withDefaults(defineProps<{
  accept?: string
  compact?: boolean
  hint?: string
  description?: string
  fileName?: string
  loading?: boolean
  icon?: string
  multiple?: boolean
}>(), {
  accept: '*/*',
  compact: false,
  hint: '',
  description: '',
  fileName: '',
  loading: false,
  icon: 'upload',
  multiple: false,
})

const emit = defineEmits<{
  (e: 'file', file: File): void
  (e: 'files', files: FileList): void
}>()

const dragging = ref(false)
const fileInput = ref<HTMLInputElement>()

function triggerPicker() {
  fileInput.value?.click()
}

function onInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  if (props.multiple) {
    emit('files', files)
  } else {
    emit('file', files[0])
  }
  input.value = ''
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}

function onDragLeave() {
  dragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  if (props.accept !== '*/*') {
    const exts = props.accept.split(',').map(s => s.trim())
    const valid = Array.from(files).filter(f =>
      exts.some(ext => {
        if (ext.startsWith('.')) return f.name.toLowerCase().endsWith(ext)
        if (ext.endsWith('/*')) return f.type.startsWith(ext.replace('/*', '/'))
        return f.type === ext
      }),
    )
    if (valid.length === 0) return
    if (props.multiple) {
      const dt = new DataTransfer()
      valid.forEach(f => dt.items.add(f))
      emit('files', dt.files)
    } else {
      emit('file', valid[0])
    }
  } else {
    if (props.multiple) {
      emit('files', files)
    } else {
      emit('file', files[0])
    }
  }
}

defineExpose({ triggerPicker })
</script>

<template>
  <div
    class="dropzone"
    :class="{
      compact,
      'drag-over': dragging,
      'has-file': !!fileName,
    }"
    @click="triggerPicker"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <input
      ref="fileInput"
      type="file"
      :accept="accept"
      :multiple="multiple"
      style="display:none"
      @change="onInputChange"
    />

    <template v-if="compact">
      <div class="compact-content">
        <SvgIcon :name="fileName ? 'upload' : icon" :size="14" />
        <span v-if="loading" class="compact-text loading">{{ $attrs['loading-text'] || '...' }}</span>
        <template v-else-if="fileName">
          <span class="compact-file" :title="fileName">{{ fileName }}</span>
          <span class="compact-hint">{{ hint }}</span>
        </template>
        <span v-else class="compact-text">{{ hint }}</span>
      </div>
    </template>

    <template v-else>
      <SvgIcon :name="icon" :size="32" />
      <p class="zone-title">{{ loading ? ($attrs['loading-text'] as string || '...') : hint }}</p>
      <p v-if="description" class="zone-desc">{{ description }}</p>
    </template>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 2px dashed #444;
  border-radius: 12px;
  cursor: pointer;
  color: #777;
  transition: all 0.2s;
  text-align: center;
  user-select: none;
}
.dropzone:not(.compact) {
  padding: 48px 64px;
  max-width: 400px;
}
.dropzone:hover, .dropzone.drag-over {
  border-color: #7a9acc;
  color: #aaa;
  background: rgba(122, 154, 204, 0.04);
}
.dropzone.drag-over {
  border-color: #8ab4f8;
  background: rgba(122, 154, 204, 0.08);
  transform: scale(1.01);
}

/* Compact mode (sidebar) */
.dropzone.compact {
  padding: 8px 10px;
  border-radius: 6px;
  border-width: 1px;
  border-style: dashed;
  gap: 0;
}
.dropzone.compact.has-file {
  border-color: #3a5a4a;
  background: #2a3a30;
  color: #8ab;
}
.dropzone.compact.has-file:hover {
  border-color: #5a8a6a;
  background: #2e4038;
}
.compact-content {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  font-size: 11px;
}
.compact-file {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #bbb;
}
.compact-hint {
  flex-shrink: 0;
  color: #666;
  font-size: 10px;
}
.compact-text { color: #999; }
.compact-text.loading { color: #aaa; }

/* Full mode */
.zone-title {
  font-size: 15px;
  margin: 0;
  color: #bbb;
}
.zone-desc {
  font-size: 12px;
  margin: 0;
  line-height: 1.5;
  color: inherit;
}
</style>
