export { useWorkspace, openWorkspace, closeWorkspace, tryRestoreWorkspace, getWorkspaceHandle, getWorkspaceMode, onBeforeWorkspaceSwitch, listSavedWorkspaces, removeSavedWorkspace } from './workspace-manager'
export type { SavedWorkspace } from './workspace-manager'
export type { WorkspaceInfo, WorkspaceState, WorkspaceMode } from './interfaces'
export { WORKSPACE_DIRS_LEGACY } from './interfaces'
export {
  splitPath,
  joinPath,
  resolveDir,
  readFile,
  readTextFile,
  writeFile,
  readJsonFile,
  readJsonFileOrNull,
  writeJsonFile,
  deleteFile,
  fileExists,
  listDirs,
  classifyError,
} from './fs'
export type { FsErrorKind, FsResult } from './fs'
