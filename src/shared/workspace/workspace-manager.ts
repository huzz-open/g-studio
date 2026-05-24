import { ref, readonly } from 'vue'
import { WORKSPACE_DIRS, WORKSPACE_SYSTEM_DIR, WORKSPACE_CONFIG_FILE } from './interfaces'
import type { WorkspaceInfo } from './interfaces'
import { invalidateCache as invalidateRmCache } from '../../modules/resource-manager'
import { readJsonFileOrNull, writeJsonFile } from './fs'

const HANDLE_DB_NAME = 'g-studio-workspace-handle'
const HANDLE_STORE = 'handles'
const ACTIVE_KEY = 'active-workspace'
const LIST_KEY = 'workspace-list'

export interface SavedWorkspace {
  name: string
  handle: FileSystemDirectoryHandle
  lastOpenedAt: number
}

const isOpen = ref(false)
const workspaceName = ref('')
let _dirHandle: FileSystemDirectoryHandle | null = null

type WorkspaceSwitchHook = () => Promise<boolean>
const _switchHooks: WorkspaceSwitchHook[] = []

export function onBeforeWorkspaceSwitch(hook: WorkspaceSwitchHook) {
  _switchHooks.push(hook)
}

async function runSwitchHooks(): Promise<boolean> {
  for (const hook of _switchHooks) {
    const ok = await hook()
    if (!ok) return false
  }
  return true
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IDB upgrade blocked by another connection'))
  })
}

async function saveActiveToIDB(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(handle, ACTIVE_KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function clearActiveFromIDB(): Promise<void> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).delete(ACTIVE_KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function loadActiveFromIDB(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIDB()
  return new Promise((resolve) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly')
    const get = tx.objectStore(HANDLE_STORE).get(ACTIVE_KEY)
    get.onsuccess = () => { db.close(); resolve(get.result ?? null) }
    get.onerror = () => { db.close(); resolve(null) }
  })
}

async function upsertWorkspaceList(entry: SavedWorkspace): Promise<void> {
  const db = await openIDB()
  const list = await readWorkspaceListFromDB(db)
  const idx = list.findIndex((w) => w.name === entry.name)
  if (idx >= 0) {
    list[idx] = entry
  } else {
    list.push(entry)
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(list, LIST_KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

function readWorkspaceListFromDB(db: IDBDatabase): Promise<SavedWorkspace[]> {
  return new Promise((resolve) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly')
    const get = tx.objectStore(HANDLE_STORE).get(LIST_KEY)
    get.onsuccess = () => resolve(Array.isArray(get.result) ? get.result : [])
    get.onerror = () => resolve([])
  })
}

export async function listSavedWorkspaces(): Promise<SavedWorkspace[]> {
  try {
    const db = await openIDB()
    const list = await readWorkspaceListFromDB(db)
    db.close()
    return list.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  } catch {
    return []
  }
}

export async function removeSavedWorkspace(name: string): Promise<void> {
  const db = await openIDB()
  const list = await readWorkspaceListFromDB(db)
  const filtered = list.filter((w) => w.name !== name)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(filtered, LIST_KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function initWorkspaceStructure(root: FileSystemDirectoryHandle): Promise<void> {
  for (const dir of WORKSPACE_DIRS) {
    await root.getDirectoryHandle(dir, { create: true })
  }

  const sysDir = await root.getDirectoryHandle(WORKSPACE_SYSTEM_DIR, { create: true })
  const existing = await readJsonFileOrNull<WorkspaceInfo>(sysDir, WORKSPACE_CONFIG_FILE)
  const meta: WorkspaceInfo = existing
    ? { ...existing, lastOpenedAt: Date.now() }
    : { version: 1, name: root.name, createdAt: Date.now(), lastOpenedAt: Date.now() }

  await writeJsonFile(sysDir, WORKSPACE_CONFIG_FILE, meta)
}

export async function openWorkspace(handle?: FileSystemDirectoryHandle): Promise<void> {
  const h = handle ?? await window.showDirectoryPicker({ mode: 'readwrite' })

  const perm = await h.requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') {
    throw new Error('Permission denied')
  }

  const isSame = _dirHandle ? await _dirHandle.isSameEntry(h).catch(() => false) : false

  if (_dirHandle && !isSame) {
    const canSwitch = await runSwitchHooks()
    if (!canSwitch) return
    invalidateRmCache()
  }

  await initWorkspaceStructure(h)

  _dirHandle = h
  workspaceName.value = h.name
  isOpen.value = true

  try {
    await saveActiveToIDB(h)
    await upsertWorkspaceList({ name: h.name, handle: h, lastOpenedAt: Date.now() })
  } catch (e) {
    console.warn('[workspace-manager] IDB persistence failed:', e)
  }
}

export async function closeWorkspace(): Promise<void> {
  if (_dirHandle) {
    const canSwitch = await runSwitchHooks()
    if (!canSwitch) return
  }

  invalidateRmCache()
  _dirHandle = null
  workspaceName.value = ''
  isOpen.value = false

  try {
    await clearActiveFromIDB()
  } catch (e) {
    console.warn('[workspace-manager] IDB clear failed:', e)
  }
}

export async function tryRestoreWorkspace(): Promise<boolean> {
  try {
    const handle = await loadActiveFromIDB()
    if (!handle) return false

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
    listSavedWorkspaces,
    removeSavedWorkspace,
  }
}
