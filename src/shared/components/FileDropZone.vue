<script setup lang="ts">
import { ref, computed } from 'vue'
import SvgIcon from '../icons/SvgIcon.vue'
import DropTarget from './drop-target/DropTarget.vue'
import type { DropModifiers } from './editor-shell/types'

const props = withDefaults(defineProps<{
  accept?: string
  compact?: boolean
  hint?: string
  description?: string
  fileName?: string
  loading?: boolean
  loadingText?: string
  icon?: string
  multiple?: boolean
}>(), {
  accept: '*/*',
  compact: false,
  hint: '',
  description: '',
  fileName: '',
  loading: false,
  loadingText: '加载中',
  icon: 'upload',
  multiple: false,
})

const emit = defineEmits<{
  (e: 'file', file: File): void
  (e: 'files', files: FileList): void
}>()

const fileInput = ref<HTMLInputElement>()
const isFetching = ref(false)

const isLoading = computed(() => props.loading || isFetching.value)

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

function onDropFiles(files: File[], _modifiers: DropModifiers) {
  if (props.multiple) {
    const dt = new DataTransfer()
    files.forEach(f => dt.items.add(f))
    emit('files', dt.files)
  } else {
    emit('file', files[0])
  }
}

function onFetchStart() {
  isFetching.value = true
}

function onFetchEnd() {
  isFetching.value = false
}

defineExpose({ triggerPicker })
</script>

<template>
  <DropTarget
    :accept="accept"
    :default-overlay="false"
    @drop="onDropFiles"
    @fetch-start="onFetchStart"
    @fetch-end="onFetchEnd"
    v-slot="{ dragging }"
  >
    <div
      class="dropzone"
      :class="{
        compact,
        'drag-over': dragging,
        'has-file': !!fileName,
        'is-fetching': isFetching,
      }"
      @click="triggerPicker"
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
          <span v-if="isLoading" class="compact-text loading">
            {{ loadingText }}<span class="dot-anim" />
          </span>
          <template v-else-if="fileName">
            <span class="compact-file" :title="fileName">{{ fileName }}</span>
            <span class="compact-hint">{{ hint }}</span>
          </template>
          <span v-else class="compact-text">{{ hint }}</span>
        </div>
      </template>

      <template v-else>
        <SvgIcon :name="icon" :size="32" />
        <p v-if="isLoading" class="zone-title">{{ loadingText }}<span class="dot-anim" /></p>
        <p v-else class="zone-title">{{ hint }}</p>
        <p v-if="description" class="zone-desc">{{ description }}</p>
      </template>
    </div>
  </DropTarget>
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
.dropzone.is-fetching {
  pointer-events: none;
  opacity: 0.7;
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

/* Dot animation */
.dot-anim::after {
  content: '';
  animation: dots 1.2s steps(3, end) infinite;
}
@keyframes dots {
  0%   { content: ''; }
  33%  { content: '.'; }
  66%  { content: '..'; }
  100% { content: '...'; }
}
</style>
