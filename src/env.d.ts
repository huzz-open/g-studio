/// <reference types="vite/client" />

interface FileSystemDirectoryHandle {
  queryPermission(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}


interface Window {
  showDirectoryPicker(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  }): Promise<FileSystemDirectoryHandle>
}
