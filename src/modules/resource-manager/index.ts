export {
  isWorkspaceConnected,
  saveFileToWorkspace,
  saveSpritesheetToWorkspace,
  readFileFromWorkspace,
} from './services/workspace-file-ops'

export type { SaveFileOptions, SaveResult } from './services/workspace-file-ops'

export { scanWorkspace } from './services/fs-scanner'
export { reconcile } from './services/reconciliation'
export { migrateFromRegistry } from './services/migration'
export { createMetaForFile, readMetaFile, writeMetaFile } from './services/meta-service'

export type {
  MetaFile,
  FsEntry,
  ScanResult,
  MetaResourceType,
  SlicerModuleData,
} from './interfaces/meta'
