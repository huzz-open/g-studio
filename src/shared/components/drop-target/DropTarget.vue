<script setup lang="ts">
import { ref, computed, useSlots } from 'vue'
import { useI18n } from '../../i18n'
import { filterFilesByAccept } from '../../utils/file-accept'
import { extractImageUrl, fetchImageAsFile } from '../../utils/drop-image-url'
import { showToast } from '../toast'
import type { DropModifiers } from '../editor-shell/types'

export type { DropModifiers }

const props = withDefaults(defineProps<{
  accept?: string
  disabled?: boolean
  defaultToast?: boolean
  defaultOverlay?: boolean
}>(), {
  accept: '*/*',
  disabled: false,
  defaultToast: true,
  defaultOverlay: true,
})

const emit = defineEmits<{
  drop: [files: File[], modifiers: DropModifiers]
  'fetch-start': [url: string]
  'fetch-end': []
  error: [reason: string]
}>()

const slots = useSlots()
const { t } = useI18n()

const dragging = ref(false)
const fetching = ref(false)
const fetchUrl = ref<string | null>(null)
let dragCounter = 0

const showDragOverlay = computed(() =>
  dragging.value && (props.defaultOverlay || !!slots['drag-overlay'])
)
const showLoadingOverlay = computed(() =>
  fetching.value && (props.defaultOverlay || !!slots['loading-overlay'])
)

function onDragEnter(e: DragEvent) {
  if (props.disabled) return
  e.preventDefault()
  dragCounter++
  dragging.value = true
}

function onDragOver(e: DragEvent) {
  if (props.disabled) return
  e.preventDefault()
}

function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    dragging.value = false
  }
}

async function onDrop(e: DragEvent) {
  e.preventDefault()
  dragCounter = 0
  dragging.value = false
  if (props.disabled) return

  const dt = e.dataTransfer
  if (!dt) return

  const modifiers: DropModifiers = { alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey }

  // Priority 1: local files
  if (dt.files.length > 0) {
    const valid = filterFilesByAccept(Array.from(dt.files), props.accept)
    if (valid.length > 0) {
      emit('drop', valid, modifiers)
    }
    return
  }

  // Priority 2: image in dataTransfer.items
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        emit('drop', [file], modifiers)
        return
      }
    }
  }

  // Priority 3: URL extraction + fetch
  const url = extractImageUrl(dt)
  if (!url) {
    console.warn('[DropTarget] Drop event has no usable data.', {
      types: dt.types,
      uriList: dt.getData('text/uri-list'),
      html: dt.getData('text/html')?.slice(0, 200),
      text: dt.getData('text/plain')?.slice(0, 200),
    })
    emit('error', 'unrecognized')
    if (props.defaultToast) {
      showToast(t('dropTarget.error.unrecognized'), 'error')
    }
    return
  }

  fetchUrl.value = url
  fetching.value = true
  emit('fetch-start', url)

  try {
    const file = await fetchImageAsFile(url)
    emit('drop', [file], modifiers)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[DropTarget] Fetch failed:', url, err)
    emit('error', reason)
    if (props.defaultToast) {
      const specificKey = `dropTarget.error.${reason}`
      const msg = t(specificKey)
      showToast(msg === specificKey ? t('dropTarget.error.generic', { detail: reason }) : msg, 'error')
    }
  } finally {
    fetching.value = false
    fetchUrl.value = null
    emit('fetch-end')
  }
}
</script>

<template>
  <div
    class="drop-target-root"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <slot :dragging="dragging" :fetching="fetching" :fetch-url="fetchUrl" />

    <!-- Drag overlay -->
    <Transition name="drop-fade">
      <div v-if="showDragOverlay" class="drop-drag-overlay">
        <slot name="drag-overlay">
          <span class="drop-overlay-text">{{ t('dropTarget.dropHint') }}</span>
        </slot>
      </div>
    </Transition>

    <!-- Loading overlay -->
    <Transition name="drop-fade">
      <div v-if="showLoadingOverlay" class="drop-loading-overlay">
        <slot name="loading-overlay">
          <div class="drop-loading-spinner" />
          <span>{{ t('dropTarget.loading') }}</span>
        </slot>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.drop-target-root {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.drop-drag-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(40, 80, 120, 0.3);
  border: 2px dashed #5577aa;
  border-radius: 8px;
  z-index: 20;
  pointer-events: none;
}
.drop-overlay-text {
  color: #8ab4f8;
  font-size: 13px;
}

.drop-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(30, 30, 30, 0.7);
  z-index: 25;
  color: #ccc;
  font-size: 13px;
  pointer-events: none;
}
.drop-loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #444;
  border-top-color: #8ab4f8;
  border-radius: 50%;
  animation: drop-spin 0.7s linear infinite;
}
@keyframes drop-spin { to { transform: rotate(360deg); } }

.drop-fade-enter-active,
.drop-fade-leave-active { transition: opacity 0.15s; }
.drop-fade-enter-from,
.drop-fade-leave-to { opacity: 0; }
</style>
