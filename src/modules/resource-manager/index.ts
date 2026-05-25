export {
  isWorkspaceConnected,
  saveFileToWorkspace,
  saveFileBatch,
  readFileFromWorkspace,
  deleteFileFromWorkspace,
} from './services/workspace-file-ops'

export type { SaveFileOptions, SaveResult, BatchOptions } from './services/workspace-file-ops'

export { scanWorkspace } from './services/fs-scanner'
export { readUidIndex } from './services/uid-index'
export { reconcile } from './services/reconciliation'
export { createMetaForFile, readMetaFile, readMetaFileFsResult, writeMetaFile } from './services/meta-service'
export { notifyFileChanged, invalidateCache } from './services/workspace-cache'

export type {
  MetaFile,
  FsEntry,
  ScanResult,
  MetaResourceType,
  SlicerModuleData,
  SlicerSliceConfig,
  SlicerSpriteEntry,
} from './interfaces/meta'
