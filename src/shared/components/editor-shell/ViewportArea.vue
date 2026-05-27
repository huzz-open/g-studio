<script setup lang="ts">
import { ref, computed } from 'vue'
import SvgIcon from '../../icons/SvgIcon.vue'
import { useI18n } from '../../i18n'
import type { DropModifiers } from './types'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  accept?: string
  dropOverlayText?: string
  altDropOverlayText?: string
  emptyIcon?: string
  emptyTitle?: string
  emptyDesc?: string
  showEmpty?: boolean
  loading?: boolean
}>(), {
  accept: '*/*',
  showEmpty: false,
  loading: false,
})

const emit = defineEmits<{
  drop: [files: File[], modifiers: DropModifiers]
}>()

const dragging = ref(false)
let dragCounter = 0

function onDragEnter(e: DragEvent) {
  e.preventDefault()
  dragCounter++
  dragging.value = true
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    dragging.value = false
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragCounter = 0
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (!files.length) return

  if (props.accept && props.accept !== '*/*') {
    const exts = props.accept.split(',').map(s => s.trim())
    const valid = files.filter(f => exts.some(ext => {
      if (ext.startsWith('.')) return f.name.toLowerCase().endsWith(ext)
      if (ext.endsWith('/*')) return f.type.startsWith(ext.replace('/*', '/'))
      return f.type === ext
    }))
    if (!valid.length) return
    emit('drop', valid, { alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey })
  } else {
    emit('drop', files, { alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey })
  }
}

const showOverlay = computed(() => dragging.value && (props.dropOverlayText || props.altDropOverlayText))
</script>

<template>
  <div
    class="viewport-area"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Drop overlay -->
    <Transition name="fade">
      <div v-if="showOverlay" class="drop-overlay">
        <div class="drop-message">
          <SvgIcon name="upload" :size="32" />
          <p>{{ dropOverlayText }}</p>
          <p v-if="altDropOverlayText" class="drop-alt">Alt: {{ altDropOverlayText }}</p>
        </div>
      </div>
    </Transition>

    <!-- Empty state -->
    <div v-if="showEmpty && !loading && !dragging" class="empty-state">
      <SvgIcon v-if="emptyIcon" :name="emptyIcon" :size="48" />
      <p v-if="emptyTitle" class="empty-title">{{ emptyTitle }}</p>
      <p v-if="emptyDesc" class="empty-desc">{{ emptyDesc }}</p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner" />
    </div>

    <!-- Actual viewport content -->
    <slot v-if="!showEmpty || loading" />
  </div>
</template>

<style scoped>
.viewport-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.drop-overlay {
  position: absolute;
  inset: 0;
  background: rgba(40, 80, 120, 0.3);
  border: 2px dashed #5577aa;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
  pointer-events: none;
}
.drop-message {
  text-align: center;
  color: #8ab4f8;
}
.drop-message p {
  margin: 8px 0 0;
  font-size: 13px;
}
.drop-alt {
  font-size: 11px !important;
  color: #aaa;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #666;
  gap: 8px;
  pointer-events: none;
}
.empty-title {
  font-size: 14px;
  color: #888;
  margin: 0;
}
.empty-desc {
  font-size: 12px;
  color: #666;
  margin: 0;
}

.loading-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 15;
}
.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #444;
  border-top-color: #8ab4f8;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.fade-enter-active,
.fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
