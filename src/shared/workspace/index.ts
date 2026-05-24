export { useWorkspace, openWorkspace, closeWorkspace, tryRestoreWorkspace, getWorkspaceHandle, onBeforeWorkspaceSwitch, listSavedWorkspaces, removeSavedWorkspace } from './workspace-manager'
export type { SavedWorkspace } from './workspace-manager'
export type { WorkspaceInfo, WorkspaceState } from './interfaces'
export { WORKSPACE_DIRS } from './interfaces'
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
