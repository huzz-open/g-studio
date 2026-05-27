<script setup lang="ts">
import ShellTabBar from './ShellTabBar.vue'
import SidePanel from './SidePanel.vue'
import ViewportArea from './ViewportArea.vue'
import { useEditorShell } from './useEditorShell'
import type { TabItem, PanelConfig, ViewportConfig, DropModifiers } from './types'

const props = withDefaults(defineProps<{
  tabs: TabItem[]
  activeTabId: string | null
  tabAccept?: string
  leftPanel?: PanelConfig
  rightPanel?: PanelConfig
  leftCollapsed?: boolean
  rightCollapsed?: boolean
  viewport?: ViewportConfig
  showEmpty?: boolean
  loading?: boolean
}>(), {
  tabAccept: '*/*',
  leftCollapsed: false,
  rightCollapsed: false,
  showEmpty: false,
  loading: false,
})

const emit = defineEmits<{
  'tab-switch': [id: string]
  'tab-close': [id: string]
  'tab-add-file': [file: File]
  'viewport-drop': [files: File[], modifiers: DropModifiers]
  'update:leftCollapsed': [val: boolean]
  'update:rightCollapsed': [val: boolean]
}>()

const shell = useEditorShell()
shell.leftCollapsed.value = props.leftCollapsed
shell.rightCollapsed.value = props.rightCollapsed
</script>

<template>
  <div class="editor-shell">
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
        v-if="tabs.length > 0"
        :tabs="tabs"
        :active-id="activeTabId"
        :accept="tabAccept"
        @switch="emit('tab-switch', $event)"
        @close="emit('tab-close', $event)"
        @add-file="emit('tab-add-file', $event)"
      />

      <ViewportArea
        :accept="viewport?.accept ?? tabAccept"
        :drop-overlay-text="viewport?.dropOverlayText"
        :alt-drop-overlay-text="viewport?.altDropOverlayText"
        :empty-icon="viewport?.emptyState?.icon"
        :empty-title="viewport?.emptyState?.titleKey"
        :empty-desc="viewport?.emptyState?.descKey"
        :show-empty="showEmpty"
        :loading="loading"
        @drop="(files, mods) => emit('viewport-drop', files, mods)"
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
