import { ref, readonly, computed, type Ref } from 'vue'
import type { IStorageProvider } from './interfaces'
import { IndexedDBProvider } from './indexeddb-provider'
import { CachedStorageProvider } from './cached-provider'
import { SyncService, type SyncStatus } from './sync-service'

export type { IStorageProvider }
export type { StorageRecord, StorageQuery } from './interfaces'
export type { SyncStatus } from './sync-service'

export type StorageMode = 'browser' | 'workspace'

const storageMode = ref<StorageMode>('browser')

let _idb: IndexedDBProvider | null = null
let _provider: CachedStorageProvider | null = null
let _sync: SyncService | null = null

export async function getStorage(): Promise<IStorageProvider> {
  if (_provider) return _provider
  _idb = new IndexedDBProvider()
  await _idb.init()
  _provider = new CachedStorageProvider(_idb, _sync)
  return _provider
}

export async function connectWorkspace(handle: FileSystemDirectoryHandle): Promise<void> {
  if (!_idb) await getStorage()
  _sync = new SyncService()
  await _sync.connect(handle, _idb!)
  _provider!.syncService = _sync
  storageMode.value = 'workspace'
}

export async function disconnectWorkspace(): Promise<void> {
  if (_sync) {
    await _sync.disconnect()
    _sync = null
    if (_provider) _provider.syncService = null
    storageMode.value = 'browser'
  }
}

export async function closeStorage(): Promise<void> {
  if (_sync) {
    await _sync.disconnect()
    _sync = null
  }
  if (_provider) {
    await _provider.close()
    _provider = null
    _idb = null
    storageMode.value = 'browser'
  }
}

export function useStorageMode() {
  return {
    storageMode: readonly(storageMode),
  }
}

export function useSyncStatus(): { status: Ref<SyncStatus> } {
  return {
    status: computed(() => _sync?.status.value ?? 'disconnected') as unknown as Ref<SyncStatus>,
  }
}

export async function flushSync(): Promise<void> {
  if (_sync) await _sync.flushAllPending()
}

export async function clearWorkspaceData(): Promise<void> {
  if (_sync) {
    await _sync.flushAllPending()
    await _sync.disconnect()
    _sync = null
    if (_provider) _provider.syncService = null
  }
  if (!_idb) await getStorage()
  await _idb!.clearWorkspaceData()
  storageMode.value = 'browser'
}

export async function clearCache(): Promise<void> {
  if (_sync) {
    await _sync.disconnect()
    _sync = null
  }
  if (_provider) {
    await _provider.close()
    _provider = null
    _idb = null
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('g-studio')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
  storageMode.value = 'browser'
}
