<script setup lang="ts">
import { computed, ref } from 'vue'
import HistoryControls from './HistoryControls.vue'
import { useHistoryInteraction } from './useHistoryInteraction'
import type { HistoryController } from '../../history/interaction'
import ShellTabBar from './ShellTabBar.vue'
import SidePanel from './SidePanel.vue'
import ViewportArea from './ViewportArea.vue'
import { useEditorShell } from './useEditorShell'
import type { TabItem, PanelConfig, ViewportConfig, DropModifiers } from './types'

const props = withDefaults(defineProps<{
  history?: HistoryController | null
  resolveHistory?: (event: Event) => HistoryController | null | undefined
  tabs: TabItem[]
  activeTabId: string | null
  tabAccept?: string
  tabAddMode?: 'file' | 'empty'
  tabAddLabel?: string
  leftPanel?: PanelConfig
  rightPanel?: PanelConfig
  leftCollapsed?: boolean
  rightCollapsed?: boolean
  viewport?: ViewportConfig
  showEmpty?: boolean
  loading?: boolean
  managedDrop?: boolean
}>(), {
  tabAccept: '*/*',
  leftCollapsed: false,
  rightCollapsed: false,
  showEmpty: false,
  loading: false,
  managedDrop: true,
})

const emit = defineEmits<{
  'tab-switch': [id: string]
  'tab-close': [id: string]
  'tab-pin': [id: string, pinned: boolean]
  'tab-add-empty': []
  'tab-add-file': [file: File]
  'tab-load-file': [file: File]
  'tab-rename': [id: string]
  'viewport-drop': [files: File[], modifiers: DropModifiers]
  'update:leftCollapsed': [val: boolean]
  'update:rightCollapsed': [val: boolean]
}>()

const root = ref<HTMLElement>()
const historyInteraction = useHistoryInteraction(root, () => props.history, event => props.resolveHistory?.(event))
const shell = useEditorShell()
shell.leftCollapsed.value = props.leftCollapsed
shell.rightCollapsed.value = props.rightCollapsed

const mergedTabs = computed<TabItem[]>(() =>
  props.tabs.map(tab => ({
    ...tab,
    dirty: tab.dirty || shell.dirtyTabs.value.has(tab.id),
  }))
)


function onViewportDrop(files: File[], modifiers: DropModifiers) {
  emit('viewport-drop', files, modifiers)

  if (!props.managedDrop) return

  const file = files[0]
  if (!file) return
  if (modifiers.alt && props.activeTabId) {
    emit('tab-load-file', file)
  } else if (props.showEmpty && props.activeTabId) {
    emit('tab-load-file', file)
  } else {
    emit('tab-add-file', file)
  }
}
</script>

<template>
  <div ref="root" class="editor-shell" @pointerdown.capture="historyInteraction.begin" @keydown.capture="historyInteraction.begin">
    <!-- Left sidebar -->
    <SidePanel
      v-if="leftPanel"
      side="left"
      :default-width="leftPanel.width.default"
      :min-width="leftPanel.width.min"
      :max-width="leftPanel.width.max"
      :persist-key="leftPanel.persistKey"
      :collapsed="leftCollapsed"
      @update:collapsed="emit('update:leftCollapsed', $event)"
    >
      <slot name="left" />
    </SidePanel>

    <!-- Center: tab bar + viewport -->
    <div class="shell-center">
      <ShellTabBar
        :tabs="mergedTabs"
        :active-id="activeTabId"
        :accept="tabAccept"
        :add-mode="tabAddMode"
        :add-label="tabAddLabel"
        @switch="emit('tab-switch', $event)"
        @close="emit('tab-close', $event)"
        @pin="(id, pinned) => emit('tab-pin', id, pinned)"
        @add-empty="emit('tab-add-empty')"
        @add-file="emit('tab-add-file', $event)"
        @rename="emit('tab-rename', $event)"
      ><template #actions><slot name="tab-actions" /></template><template #toolbar><HistoryControls :history="history"/></template></ShellTabBar>

      <ViewportArea
        :key="activeTabId ?? ''"
        :accept="viewport?.accept ?? tabAccept"
        :drop-overlay-text="viewport?.dropOverlayText"
        :alt-drop-overlay-text="viewport?.altDropOverlayText"
        :show-empty="showEmpty"
        :loading="loading"
        @drop="onViewportDrop"
      >
        <slot name="viewport" />
      </ViewportArea>
    </div>

    <!-- Right sidebar -->
    <SidePanel
      v-if="rightPanel"
      side="right"
      :default-width="rightPanel.width.default"
      :min-width="rightPanel.width.min"
      :max-width="rightPanel.width.max"
      :persist-key="rightPanel.persistKey"
      :collapsed="rightCollapsed"
      @update:collapsed="emit('update:rightCollapsed', $event)"
    >
      <slot name="right" />
    </SidePanel>
  </div>
</template>

<style scoped>
.editor-shell {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}
.shell-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
</style>
