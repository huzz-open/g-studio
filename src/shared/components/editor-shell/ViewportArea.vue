<script setup lang="ts">
import { computed } from 'vue'
import DropTarget from '../drop-target/DropTarget.vue'
import EmptyDropHint from './EmptyDropHint.vue'
import { useI18n } from '../../i18n'
import type { DropModifiers } from './types'

const props = withDefaults(defineProps<{
  accept?: string
  dropOverlayText?: string
  altDropOverlayText?: string
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

const { t } = useI18n()

function onDrop(files: File[], modifiers: DropModifiers) {
  emit('drop', files, modifiers)
}

function onFileSelect(file: File) {
  emit('drop', [file], { alt: false, ctrl: false, shift: false })
}

const overlayText = computed(() => props.dropOverlayText ?? t('common.dropToOpen'))
const altOverlayText = computed(() => props.altDropOverlayText ?? t('common.dropToReplace'))
</script>

<template>
  <DropTarget
    :accept="accept"
    :default-overlay="false"
    @drop="onDrop"
    v-slot="{ dragging, fetching }"
  >
    <div class="viewport-area">
      <!-- Drop overlay -->
      <Transition name="fade">
        <div v-if="dragging" class="drop-overlay">
          <div class="drop-message">
            <p class="drop-main">{{ overlayText }}</p>
            <p class="drop-alt">Alt: {{ altOverlayText }}</p>
          </div>
        </div>
      </Transition>

      <!-- Fetch loading overlay -->
      <Transition name="fade">
        <div v-if="fetching" class="fetch-loading-overlay">
          <div class="fetch-loading-spinner" />
          <span class="fetch-loading-text">{{ t('common.loadingDot') }}<span class="dot-anim" /></span>
        </div>
      </Transition>

      <!-- Empty state -->
      <EmptyDropHint
        v-if="showEmpty && !loading && !dragging"
        :accept="accept"
        @select="onFileSelect"
      />

      <!-- Loading -->
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner" />
      </div>

      <!-- Actual viewport content -->
      <slot v-if="!showEmpty || loading" />
    </div>
  </DropTarget>
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
}
.drop-main {
  margin: 0;
  font-size: 13px;
  color: #8ab4f8;
}
.drop-alt {
  margin: 6px 0 0;
  font-size: 11px;
  color: #aaa;
}

.fetch-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(30, 30, 30, 0.7);
  z-index: 25;
  pointer-events: none;
}
.fetch-loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #444;
  border-top-color: #8ab4f8;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.fetch-loading-text {
  color: #ccc;
  font-size: 13px;
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
