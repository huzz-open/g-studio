import type { IStorageProvider, StorageRecord, StorageQuery } from './interfaces'
import type { IndexedDBProvider, DirtyEntry } from './indexeddb-provider'
import type { SyncService } from './sync-service'

export class CachedStorageProvider implements IStorageProvider {
  private idb: IndexedDBProvider
  syncService: SyncService | null

  constructor(idb: IndexedDBProvider, syncService: SyncService | null) {
    this.idb = idb
    this.syncService = syncService
  }

  async init(): Promise<void> {
    /* IDB is already initialized */
  }

  async put(store: string, record: StorageRecord): Promise<void> {
    if (this.syncService) {
      const dirty: DirtyEntry = {
        key: `${store}:${record.id}`,
        type: 'record',
        store,
        action: 'upsert',
        createdAt: Date.now(),
      }
      await this.idb.putWithDirtyMark(store, record, dirty)
      this.syncService.scheduleFlush()
    } else {
      await this.idb.put(store, record)
    }
  }

  async get(store: string, key: string): Promise<StorageRecord | null> {
    return this.idb.get(store, key)
  }

  async getAll(store: string, query?: StorageQuery): Promise<StorageRecord[]> {
    return this.idb.getAll(store, query)
  }

  async delete(store: string, key: string): Promise<void> {
    if (this.syncService) {
      const dirty: DirtyEntry = {
        key: `${store}:${key}`,
        type: 'record',
        store,
        action: 'delete',
        createdAt: Date.now(),
      }
      await this.idb.deleteWithDirtyMark(store, key, dirty)
      this.syncService.scheduleFlush()
    } else {
      await this.idb.delete(store, key)
    }
  }

  async count(store: string, filter?: { field: string; value: unknown }): Promise<number> {
    return this.idb.count(store, filter)
  }

  async getBlob(key: string): Promise<Uint8Array | null> {
    const cached = await this.idb.getBlob(key)
    if (cached) return cached

    if (this.syncService) {
      const fromDisk = await this.syncService.loadBlobFromDisk(key)
      if (fromDisk) {
        await this.idb.setBlob(key, fromDisk)
        return fromDisk
      }
    }
    return null
  }

  async setBlob(key: string, data: Uint8Array): Promise<void> {
    if (this.syncService) {
      const dirty: DirtyEntry = {
        key: `blob:${key}`,
        type: 'blob',
        store: '_blobs',
        action: 'upsert',
        createdAt: Date.now(),
      }
      await this.idb.setBlobWithDirtyMark(key, data, dirty)
      this.syncService.scheduleFlush()
    } else {
      await this.idb.setBlob(key, data)
    }
  }

  async deleteBlob(key: string): Promise<void> {
    if (this.syncService) {
      const dirty: DirtyEntry = {
        key: `blob:${key}`,
        type: 'blob',
        store: '_blobs',
        action: 'delete',
        createdAt: Date.now(),
      }
      await this.idb.deleteBlobWithDirtyMark(key, dirty)
      this.syncService.scheduleFlush()
    } else {
      await this.idb.deleteBlob(key)
    }
  }

  async close(): Promise<void> {
    await this.idb.close()
  }

  getIdb(): IndexedDBProvider {
    return this.idb
  }
}
