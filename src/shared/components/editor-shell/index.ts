export { default as EditorShell } from './EditorShell.vue'
export { default as ShellTabBar } from './ShellTabBar.vue'
export { default as SidePanel } from './SidePanel.vue'
export { default as ViewportArea } from './ViewportArea.vue'
export { default as EmptyDropHint } from './EmptyDropHint.vue'
export { default as SidebarSection } from './SidebarSection.vue'
export { useEditorShell, EDITOR_SHELL_KEY } from './useEditorShell'
export { useEditorTabs } from './useEditorTabs'
export type { UseEditorTabsReturn, UseEditorTabsOptions, TabPersistConfig } from './useEditorTabs'
export { useTabRouteSync } from './useTabRouteSync'
export { useEditorKeyboard } from './useEditorKeyboard'
export type { EditorKeyboardConfig } from './useEditorKeyboard'
export { useExternalChangeWatch } from './useExternalChangeWatch'
export type { ExternalChangeWatchConfig } from './useExternalChangeWatch'
export { createInstanceRegistry } from './createInstanceRegistry'
export { definePanelConfig } from './definePanelConfig'
export * from './sidebar-atoms'
export type {
  TabItem,
  PanelConfig,
  ViewportConfig,
  DropModifiers,
  ViewportState,
  EditorShellContext,
} from './types'
