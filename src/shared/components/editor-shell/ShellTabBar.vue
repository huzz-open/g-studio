<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ContextMenu from '../ContextMenu.vue'
import { tabCloseTargets, type TabCloseAction } from './tab-actions'
import SvgIcon from '../../icons/SvgIcon.vue'
import { matchesAccept } from '../../utils/file-accept'
import type { TabItem } from './types'
import { useI18n } from '../../i18n'

const props = defineProps<{
  tabs: TabItem[]
  activeId: string | null
  accept?: string
  addMode?: 'file' | 'empty'
  addLabel?: string
}>()

const emit = defineEmits<{
  switch: [id: string]
  close: [id: string]
  pin: [id: string, pinned: boolean]
  addEmpty: []
  addFile: [file: File]
  rename: [id: string]
}>()
const { t } = useI18n()

const dragging = ref(false)
const fileInputEl = ref<HTMLInputElement>()
const tabScroll = ref<HTMLElement>()
const context = ref<{ id: string; x: number; y: number } | null>(null)
const closeActions: TabCloseAction[] = ['current', 'others', 'left', 'right']
const contextItems = computed(() => {
  const target = props.tabs.find(tab => tab.id === context.value?.id)
  return [
    ...closeActions.map(action => ({ id: action, label: t('tabs.close.' + action), disabled: !target || !tabCloseTargets(props.tabs, target.id, action).length })),
    { id: 'separator', label: '', separator: true },
    { id: 'pin', label: t(target?.pinned ? 'tabs.unpin' : 'tabs.pin'), disabled: !target },
  ]
})
function openContext(id: string, event: MouseEvent | KeyboardEvent) {
  event.preventDefault(); event.stopPropagation()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  context.value = { id, x: event instanceof MouseEvent ? event.clientX : rect.left, y: event instanceof MouseEvent ? event.clientY : rect.bottom }
}
function closeContext() {
  const id = context.value?.id
  context.value = null
  void nextTick(() => {
    const elements = [...tabScroll.value?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []]
    const target = elements.find(el => el.dataset.tabId === id) ?? elements.find(el => el.dataset.tabId === props.activeId)
    target?.focus({ preventScroll: true })
  })
}
function contextAction(action: string) {
  const target = props.tabs.find(tab => tab.id === context.value?.id)
  if (!target) return
  if (action === 'pin') {
    emit('pin', target.id, !target.pinned)
    if (!target.pinned) void nextTick(() => tabScroll.value?.scrollTo({ left: 0 }))
  }
  else if (closeActions.includes(action as TabCloseAction)) {
    for (const id of tabCloseTargets(props.tabs, target.id, action as TabCloseAction)) emit('close', id)
  }
}
watch(() => props.tabs, () => { if (context.value && !props.tabs.some(tab => tab.id === context.value!.id)) context.value = null })

function onClickAdd() {
  if (props.addMode === 'empty') { emit('addEmpty'); return }
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
    if (props.tabs.find(tab => tab.id === id)?.closable !== false) emit('close', id)
  }
}
</script>

<template>
  <div
    class="shell-tab-bar"
    role="tablist"
    :class="{ 'drag-over': dragging }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div ref="tabScroll" class="tab-scroll" @scroll="context = null">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-item"
        :class="{ active: tab.id === activeId, pinned: tab.pinned }"
        :title="tab.label + (tab.pinned ? ' · ' + t('tabs.pinned') : '')"
        :data-tab-id="tab.id"
        role="tab"
        :aria-selected="tab.id === activeId"
        :tabindex="tab.id === activeId ? 0 : -1"
        @click="emit('switch', tab.id)"
        @keydown.enter.prevent="emit('switch', tab.id)"
        @keydown.space.prevent="emit('switch', tab.id)"
        @dblclick="emit('rename', tab.id)"
        @mousedown="onMiddleClick(tab.id, $event)"
        @contextmenu="openContext(tab.id, $event)"
        @keydown.shift.f10="openContext(tab.id, $event)"
        @keydown.context-menu="openContext(tab.id, $event)"
      >
        <svg v-if="tab.pinned" class="tab-pin" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" :aria-label="t('tabs.pinned')" role="img"><path d="M16 3l5 5-4 1-4 4v4l-6-6h4l4-4zM9 15l-6 6"/></svg>
        <SvgIcon v-if="tab.icon" :name="tab.icon" :size="11" />
        <span class="tab-name">{{ tab.label }}</span>
        <button v-if="tab.closable !== false && !tab.dirty" class="tab-close" :aria-label="t('common.closeTab', {name:tab.label})" @click.stop="emit('close', tab.id)">
          <SvgIcon name="close" :size="10" />
        </button>
        <span v-else-if="tab.dirty" class="tab-dirty" @click.stop="tab.closable !== false && emit('close', tab.id)">●</span>
      </div>
      <button class="tab-add" :title="addLabel || t('common.newTab')" :aria-label="addLabel || t('common.newTab')" @click="onClickAdd">
        <SvgIcon name="plus" :size="12" />
      </button>
      <slot name="actions" />
    </div>
    <slot name="toolbar" />
    <input
      ref="fileInputEl"
      type="file"
      :accept="accept || '*/*'"
      style="display:none"
      @change="onFileInput"
    />
    <ContextMenu :visible="!!context" :x="context?.x ?? 0" :y="context?.y ?? 0" :items="contextItems" @action="contextAction" @close="closeContext" />
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
  min-width: 0;
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
.tab-pin { flex-shrink: 0; color: #a8bfd9; }
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
  font-size: 9px;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s;
}
.tab-dirty:hover {
  background: #444;
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
