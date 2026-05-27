export interface TabItem {
  id: string
  label: string
  dirty?: boolean
  icon?: string
}

export interface PanelConfig {
  width: { default: number; min: number; max: number }
  persistKey: string
  collapsible?: boolean
  collapsed?: boolean
}

export interface ViewportConfig {
  accept: string
  dropOverlayText?: string
  altDropOverlayText?: string
  emptyState?: {
    icon: string
    title: string
    desc?: string
  }
}

export interface DropModifiers {
  alt: boolean
  ctrl: boolean
  shift: boolean
}

export interface ViewportState {
  scale: number
  panX: number
  panY: number
}

export interface EditorShellContext {
  markDirty(tabId: string): void
  markClean(tabId: string): void
  isDirty(tabId: string): boolean
  registerShortcut(combo: string, handler: () => void): () => void
  containerWidth: import('vue').Ref<number>
  containerHeight: import('vue').Ref<number>
  leftCollapsed: import('vue').Ref<boolean>
  rightCollapsed: import('vue').Ref<boolean>
}
