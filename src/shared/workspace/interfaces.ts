export type WorkspaceMode = 'godot-project' | 'generic'

export interface WorkspaceInfo {
  version: number
  name: string
  mode: WorkspaceMode
  createdAt: number
  lastOpenedAt: number
  gStudioVersion: string
}

export interface WorkspaceState {
  isOpen: boolean
  name: string
  mode: WorkspaceMode | null
  needsPermission: boolean
}

/** @deprecated 不再创建预设子目录，保留仅为向后兼容检测 */
export const WORKSPACE_DIRS_LEGACY = [
  'spritesheets',
  'icons',
  'animations',
  'tiles',
  'items',
  'maps',
] as const

export const WORKSPACE_SYSTEM_DIR = '.g-studio'
export const WORKSPACE_CONFIG_FILE = 'config.json'
