import { ref, readonly } from 'vue'
import { WORKSPACE_DIRS, WORKSPACE_META_FILE } from './interfaces'
import type { WorkspaceInfo } from './interfaces'
import { connectWorkspace, disconnectWorkspace, clearWorkspaceData } from '../storage'
import { invalidateCache as invalidateRmCache } from '../../modules/resource-manager/services/workspace-cache'

const HANDLE_DB_NAME = 'g-studio-workspace-handle'
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'last-workspace'

const isOpen = ref(false)
const workspaceName = ref('')
let _dirHandle: FileSystemDirectoryHandle | null = null

async function saveHandleToIDB(handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE)
    req.onsuccess = () => {
      const tx = req.result.transaction(HANDLE_STORE, 'readwrite')
      tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY)
      tx.oncomplete = () => { req.result.close(); resolve() }
      tx.onerror = () => { req.result.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  })
}

async function loadHandleFromIDB(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE)
    req.onsuccess = () => {
      const tx = req.result.transaction(HANDLE_STORE, 'readonly')
      const get = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY)
      get.onsuccess = () => { req.result.close(); resolve(get.result ?? null) }
      get.onerror = () => { req.result.close(); resolve(null) }
    }
    req.onerror = () => resolve(null)
  })
}

async function clearHandleFromIDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE)
    req.onsuccess = () => {
      const tx = req.result.transaction(HANDLE_STORE, 'readwrite')
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY)
      tx.oncomplete = () => { req.result.close(); resolve() }
      tx.onerror = () => { req.result.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  })
}

async function initWorkspaceStructure(root: FileSystemDirectoryHandle): Promise<void> {
  for (const dir of WORKSPACE_DIRS) {
    await root.getDirectoryHandle(dir, { create: true })
  }

  let meta: WorkspaceInfo
  try {
    const file = await root.getFileHandle(WORKSPACE_META_FILE)
    const text = await (await file.getFile()).text()
    meta = JSON.parse(text) as WorkspaceInfo
    meta.lastOpenedAt = Date.now()
  } catch {
    meta = {
      version: 1,
      name: root.name,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    }
  }

  const metaHandle = await root.getFileHandle(WORKSPACE_META_FILE, { create: true })
  const writable = await metaHandle.createWritable()
  await writable.write(JSON.stringify(meta, null, 2))
  await writable.close()
}

export async function openWorkspace(handle?: FileSystemDirectoryHandle): Promise<void> {
  const h = handle ?? await window.showDirectoryPicker({ mode: 'readwrite' })

  const perm = await h.requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') {
    throw new Error('Permission denied')
  }

  const isSame = _dirHandle ? await _dirHandle.isSameEntry(h).catch(() => false) : false
  if (_dirHandle && !isSame) {
    await clearWorkspaceData()
    invalidateRmCache()
  }

  await initWorkspaceStructure(h)
  await connectWorkspace(h)
  await saveHandleToIDB(h)

  _dirHandle = h
  workspaceName.value = h.name
  isOpen.value = true
}

export async function closeWorkspace(): Promise<void> {
  await clearWorkspaceData()
  await clearHandleFromIDB()
  invalidateRmCache()
  _dirHandle = null
  workspaceName.value = ''
  isOpen.value = false
}

export async function tryRestoreWorkspace(): Promise<boolean> {
  const handle = await loadHandleFromIDB()
  if (!handle) return false

  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' })
    if (perm === 'granted') {
      await openWorkspace(handle)
      return true
    }
    _dirHandle = handle
    workspaceName.value = handle.name
    return false
  } catch {
    return false
  }
}

export async function reconnectWorkspace(): Promise<void> {
  if (!_dirHandle) throw new Error('No saved workspace handle')
  await openWorkspace(_dirHandle)
}

export function hasSavedHandle(): boolean {
  return _dirHandle !== null
}

export function getWorkspaceHandle(): FileSystemDirectoryHandle | null {
  return _dirHandle
}

export function useWorkspace() {
  return {
    isOpen: readonly(isOpen),
    workspaceName: readonly(workspaceName),
    openWorkspace,
    closeWorkspace,
    tryRestoreWorkspace,
    reconnectWorkspace,
    hasSavedHandle,
  }
}
