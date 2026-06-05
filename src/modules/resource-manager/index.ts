export {
  isWorkspaceConnected,
  saveFileToWorkspace,
  saveFileBatch,
  readFileFromWorkspace,
  deleteFileFromWorkspace,
} from './services/workspace-file-ops'

export type { SaveFileOptions, SaveResult, BatchOptions } from './services/workspace-file-ops'

export { scanWorkspace } from './services/fs-scanner'
export { notifyFileChanged, invalidateCache } from './services/workspace-cache'

export type { FsEntry, ScanResult } from './interfaces/meta'
