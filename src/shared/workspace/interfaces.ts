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
  'exports',
] as const

export type WorkspaceDir = (typeof WORKSPACE_DIRS)[number]

export const WORKSPACE_META_FILE = 'workspace.json'
export const WORKSPACE_REGISTRY_FILE = '.g-studio-registry.json'
