<script setup lang="ts">
import { ref } from 'vue'
import SvgIcon from '../../icons/SvgIcon.vue'
import { matchesAccept } from '../../utils/file-accept'
import type { TabItem } from './types'

const props = defineProps<{
  tabs: TabItem[]
  activeId: string | null
  accept?: string
}>()

const emit = defineEmits<{
  switch: [id: string]
  close: [id: string]
  addEmpty: []
  addFile: [file: File]
}>()

const dragging = ref(false)
const fileInputEl = ref<HTMLInputElement>()

function onClickAdd() {
  fileInputEl.value?.click()
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    emit('addFile', input.files[0])
    input.value = ''
  }
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
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (!matchesAccept(file, props.accept ?? '*/*')) return
  emit('addFile', file)
}

function onMiddleClick(id: string, e: MouseEvent) {
  if (e.button === 1) {
    e.preventDefault()
    emit('close', id)
  }
}
</script>

<template>
  <div
    class="shell-tab-bar"
    :class="{ 'drag-over': dragging }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="tab-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.id === activeId }"
        :title="tab.label"
        @click="emit('switch', tab.id)"
        @mousedown="onMiddleClick(tab.id, $event)"
      >
        <SvgIcon v-if="tab.icon" :name="tab.icon" :size="11" />
        <span class="tab-name">{{ tab.label }}</span>
        <span v-if="tab.dirty" class="tab-dirty">●</span>
        <button class="tab-close" @click.stop="emit('close', tab.id)">
          <SvgIcon name="close" :size="10" />
        </button>
      </div>
      <button class="tab-add" @click="onClickAdd">
        <SvgIcon name="plus" :size="12" />
      </button>
    </div>
    <input
      ref="fileInputEl"
      type="file"
      :accept="accept || '*/*'"
      style="display:none"
      @change="onFileInput"
    />
  </div>
</template>

<style scoped>
.shell-tab-bar {
  display: flex;
  align-items: stretch;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  height: 32px;
  min-height: 32px;
  user-select: none;
}
.shell-tab-bar.drag-over {
  background: #2a3a2a;
}
.tab-scroll {
  display: flex;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}
.tab-scroll::-webkit-scrollbar { height: 0; }
.tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  min-width: 80px;
  max-width: 160px;
  cursor: pointer;
  font-size: 11px;
  color: #888;
  border-right: 1px solid #2a2a2a;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.tab-item:hover { background: #2a2a2a; color: #bbb; }
.tab-item.active {
  background: #2d2d2d;
  color: #eee;
  box-shadow: inset 0 -2px 0 #5577aa;
}
.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.tab-dirty {
  color: #8ab4f8;
  font-size: 8px;
  flex-shrink: 0;
}
.tab-close {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s;
}
.tab-item:hover .tab-close,
.tab-item.active .tab-close { opacity: 0.6; }
.tab-close:hover { opacity: 1 !important; background: #444; }
.tab-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  flex-shrink: 0;
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.tab-add:hover { color: #ccc; background: #2a2a2a; }
</style>
