import { ref, readonly } from 'vue'
import { WORKSPACE_SYSTEM_DIR, WORKSPACE_CONFIG_FILE } from './interfaces'
import type { WorkspaceInfo, WorkspaceMode } from './interfaces'
import { invalidateCache as invalidateRmCache } from '../../modules/resource-manager'
import { readJsonFileOrNull, writeJsonFile, writeFile, fileExists } from './fs'

declare const __APP_VERSION__: string

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
const workspaceMode = ref<WorkspaceMode | null>(null)
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

async function detectWorkspaceMode(root: FileSystemDirectoryHandle): Promise<WorkspaceMode> {
  const hasGodotProject = await fileExists(root, 'project.godot')
  return hasGodotProject ? 'godot-project' : 'generic'
}

async function initWorkspaceStructure(root: FileSystemDirectoryHandle): Promise<WorkspaceMode> {
  const mode = await detectWorkspaceMode(root)

  const sysDir = await root.getDirectoryHandle(WORKSPACE_SYSTEM_DIR, { create: true })

  if (mode === 'godot-project') {
    const hasGdIgnore = await fileExists(sysDir, '.gdignore')
    if (!hasGdIgnore) {
      await writeFile(sysDir, '.gdignore', '')
    }
  }

  const existing = await readJsonFileOrNull<WorkspaceInfo>(sysDir, WORKSPACE_CONFIG_FILE)
  const meta: WorkspaceInfo = existing
    ? { ...existing, mode, lastOpenedAt: Date.now(), gStudioVersion: __APP_VERSION__ }
    : { version: 1, name: root.name, mode, createdAt: Date.now(), lastOpenedAt: Date.now(), gStudioVersion: __APP_VERSION__ }

  await writeJsonFile(sysDir, WORKSPACE_CONFIG_FILE, meta)

  return mode
}

export async function openWorkspace(handle?: FileSystemDirectoryHandle): Promise<boolean> {
  let h: FileSystemDirectoryHandle
  try {
    h = handle ?? await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false
    throw e
  }

  const perm = await h.requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') {
    throw new Error('Permission denied')
  }

  const isSame = _dirHandle ? await _dirHandle.isSameEntry(h).catch(() => false) : false

  if (_dirHandle && !isSame) {
    const canSwitch = await runSwitchHooks()
    if (!canSwitch) return false
    invalidateRmCache()
  }

  const mode = await initWorkspaceStructure(h)

  _dirHandle = h
  workspaceName.value = h.name
  workspaceMode.value = mode
  isOpen.value = true

  try {
    await saveActiveToIDB(h)
    await upsertWorkspaceList({ name: h.name, handle: h, lastOpenedAt: Date.now() })
  } catch (e) {
    console.warn('[workspace-manager] IDB persistence failed:', e)
  }

  return true
}

export async function closeWorkspace(): Promise<void> {
  if (_dirHandle) {
    const canSwitch = await runSwitchHooks()
    if (!canSwitch) return
  }

  invalidateRmCache()
  _dirHandle = null
  workspaceName.value = ''
  workspaceMode.value = null
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

export function getWorkspaceMode(): WorkspaceMode | null {
  return workspaceMode.value
}

export function useWorkspace() {
  return {
    isOpen: readonly(isOpen),
    workspaceName: readonly(workspaceName),
    workspaceMode: readonly(workspaceMode),
    openWorkspace,
    closeWorkspace,
    tryRestoreWorkspace,
    reconnectWorkspace,
    hasSavedHandle,
    listSavedWorkspaces,
    removeSavedWorkspace,
    getWorkspaceMode,
  }
}
