<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from '../../../shared/icons/SvgIcon.vue'
import type { FsEntry } from '../interfaces/meta'

const props = defineProps<{
  entries: FsEntry[]
  selectedPath: string
  expandedPaths: Set<string>
}>()

const emit = defineEmits<{
  select: [path: string, entry: FsEntry]
  toggle: [path: string]
  contextmenu: [path: string, event: MouseEvent]
}>()

const dirs = computed(() =>
  props.entries.filter(e => e.kind === 'directory'),
)

function isExpanded(path: string): boolean {
  return props.expandedPaths.has(path)
}

function handleClick(entry: FsEntry) {
  emit('select', entry.path, entry)
  if (entry.kind === 'directory') {
    emit('toggle', entry.path)
  }
}

function handleContextMenu(path: string, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  emit('contextmenu', path, event)
}
</script>

<template>
  <div class="dir-tree">
    <div
      v-for="entry in dirs"
      :key="entry.path"
      class="tree-node"
    >
      <div
        class="tree-label"
        :class="{ active: selectedPath === entry.path }"
        @click="handleClick(entry)"
        @contextmenu="handleContextMenu(entry.path, $event)"
      >
        <SvgIcon
          :name="isExpanded(entry.path) ? 'chevron-down' : 'chevron-right'"
          :size="10"
          class="tree-arrow"
        />
        <SvgIcon
          :name="isExpanded(entry.path) ? 'folder-open' : 'folder'"
          :size="14"
        />
        <span class="tree-name">{{ entry.name }}</span>
        <span
          v-if="entry.children?.filter(c => c.kind === 'file').length"
          class="tree-count"
        >{{ entry.children?.filter(c => c.kind === 'file').length }}</span>
      </div>
      <div v-if="isExpanded(entry.path) && entry.children" class="tree-children">
        <DirectoryTree
          :entries="entry.children"
          :selected-path="selectedPath"
          :expanded-paths="expandedPaths"
          @select="(p, e) => emit('select', p, e)"
          @toggle="(p) => emit('toggle', p)"
          @contextmenu="(p, e) => emit('contextmenu', p, e)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.dir-tree {
  font-size: 12px;
  user-select: none;
}
.tree-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  color: #bbb;
  transition: background 0.1s, color 0.1s;
}
.tree-label:hover {
  background: #333;
  color: #eee;
}
.tree-label.active {
  background: #3a3a3a;
  color: #eee;
}
.tree-arrow {
  flex-shrink: 0;
  opacity: 0.5;
}
.tree-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-count {
  font-size: 10px;
  color: #666;
  background: #2a2a2a;
  padding: 0 5px;
  border-radius: 8px;
}
.tree-children {
  padding-left: 14px;
}
</style>
