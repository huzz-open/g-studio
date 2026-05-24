export interface WorkspaceInfo {
  version: number
  name: string
  createdAt: number
  lastOpenedAt: number
}

export interface WorkspaceState {
  isOpen: boolean
  name: string
  needsPermission: boolean
}

export const WORKSPACE_DIRS = [
  'spritesheets',
  'icons',
  'animations',
  'tiles',
  'items',
  'maps',
] as const

export type WorkspaceDir = (typeof WORKSPACE_DIRS)[number]

export const WORKSPACE_SYSTEM_DIR = '.g-studio'
export const WORKSPACE_CONFIG_FILE = 'config.json'
