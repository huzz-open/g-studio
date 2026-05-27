export { default as EditorShell } from './EditorShell.vue'
export { default as ShellTabBar } from './ShellTabBar.vue'
export { default as SidePanel } from './SidePanel.vue'
export { default as ViewportArea } from './ViewportArea.vue'
export { default as SidebarSection } from './SidebarSection.vue'
export { useEditorShell, EDITOR_SHELL_KEY } from './useEditorShell'
export * from './sidebar-atoms'
export type {
  TabItem,
  TabConfig,
  PanelConfig,
  ViewportConfig,
  DropModifiers,
  ViewportState,
  EditorShellContext,
} from './types'
