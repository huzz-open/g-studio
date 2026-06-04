/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENCV_MODE: 'local' | 'auto'
  readonly VITE_OPENCV_DOWNLOAD_TIMEOUT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// File System Access API (experimental, not in default TS lib)
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemDirectoryHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface Window {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}
