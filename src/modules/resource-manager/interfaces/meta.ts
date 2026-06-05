export interface FsEntry {
  name: string
  kind: 'file' | 'directory'
  path: string
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  children?: FsEntry[]
}

export interface ScanResult {
  tree: FsEntry[]
}
