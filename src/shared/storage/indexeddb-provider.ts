import type { IStorageProvider, StorageRecord, StorageQuery } from './interfaces'

const DB_NAME = 'g-studio'
const DB_VERSION = 2
const BLOB_STORE = '_blobs'
const RESOURCE_STORE = 'resources'
const DIRTY_QUEUE_STORE = '_dirty_queue'

export interface DirtyEntry {
  key: string
  type: 'record' | 'blob'
  store: string
  action: 'upsert' | 'delete'
  createdAt: number
}

export class IndexedDBProvider implements IStorageProvider {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(RESOURCE_STORE)) {
          const store = db.createObjectStore(RESOURCE_STORE, { keyPath: 'id' })
          store.createIndex('type', 'type', { unique: false })
          store.createIndex('name', 'name', { unique: false })
          store.createIndex('updatedAt', 'updatedAt', { unique: false })
        }
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE)
        }
        if (!db.objectStoreNames.contains(DIRTY_QUEUE_STORE)) {
          db.createObjectStore(DIRTY_QUEUE_STORE, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async put(store: string, record: StorageRecord): Promise<void> {
    return this.tx(store, 'readwrite', s => { s.put(record) })
  }

  async get(store: string, key: string): Promise<StorageRecord | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readonly')
      const req = tx.objectStore(store).get(key)
      req.onsuccess = () => resolve((req.result as StorageRecord) ?? null)
      req.onerror = () => reject(req.error)
    })
  }

  async getAll(store: string, query?: StorageQuery): Promise<StorageRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readonly')
      const objectStore = tx.objectStore(store)

      let source: IDBObjectStore | IDBIndex = objectStore
      let range: IDBKeyRange | null = null

      if (query?.filter) {
        try {
          source = objectStore.index(query.filter.field)
          range = IDBKeyRange.only(query.filter.value as IDBValidKey)
        } catch {
          source = objectStore
        }
      }

      const direction: IDBCursorDirection =
        query?.sort?.direction === 'asc' ? 'next' : 'prev'

      const results: StorageRecord[] = []
      const offset = query?.offset ?? 0
      const limit = query?.limit ?? Infinity
      let skipped = 0

      const req = source.openCursor(range, direction)
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor || results.length >= limit) {
          resolve(results)
          return
        }

        const record = cursor.value as StorageRecord

        if (query?.keyword) {
          const field = String(record[query.keyword.field] ?? '')
          if (!field.toLowerCase().includes(query.keyword.text.toLowerCase())) {
            cursor.continue()
            return
          }
        }

        if (skipped < offset) {
          skipped++
          cursor.continue()
          return
        }

        results.push(record)
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  }

  async delete(store: string, key: string): Promise<void> {
    return this.tx(store, 'readwrite', s => { s.delete(key) })
  }

  async count(store: string, filter?: { field: string; value: unknown }): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, 'readonly')
      const objectStore = tx.objectStore(store)
      let req: IDBRequest<number>
      if (filter) {
        try {
          req = objectStore.index(filter.field).count(IDBKeyRange.only(filter.value as IDBValidKey))
        } catch {
          req = objectStore.count()
        }
      } else {
        req = objectStore.count()
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async getBlob(key: string): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(BLOB_STORE, 'readonly')
      const req = tx.objectStore(BLOB_STORE).get(key)
      req.onsuccess = () => resolve((req.result as Uint8Array) ?? null)
      req.onerror = () => reject(req.error)
    })
  }

  async setBlob(key: string, data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(BLOB_STORE, 'readwrite')
      tx.objectStore(BLOB_STORE).put(data, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async deleteBlob(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(BLOB_STORE, 'readwrite')
      tx.objectStore(BLOB_STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  // --- Atomic dirty-mark operations (multi-store transactions) ---

  async putWithDirtyMark(store: string, record: StorageRecord, dirty: DirtyEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([store, DIRTY_QUEUE_STORE], 'readwrite')
      tx.objectStore(store).put(record)
      tx.objectStore(DIRTY_QUEUE_STORE).put(dirty)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async setBlobWithDirtyMark(key: string, data: Uint8Array, dirty: DirtyEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([BLOB_STORE, DIRTY_QUEUE_STORE], 'readwrite')
      tx.objectStore(BLOB_STORE).put(data, key)
      tx.objectStore(DIRTY_QUEUE_STORE).put(dirty)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async deleteWithDirtyMark(store: string, key: string, dirty: DirtyEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([store, DIRTY_QUEUE_STORE], 'readwrite')
      tx.objectStore(store).delete(key)
      tx.objectStore(DIRTY_QUEUE_STORE).put(dirty)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async deleteBlobWithDirtyMark(key: string, dirty: DirtyEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([BLOB_STORE, DIRTY_QUEUE_STORE], 'readwrite')
      tx.objectStore(BLOB_STORE).delete(key)
      tx.objectStore(DIRTY_QUEUE_STORE).put(dirty)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  // --- Dirty queue access ---

  async getAllDirtyEntries(): Promise<DirtyEntry[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(DIRTY_QUEUE_STORE, 'readonly')
      const req = tx.objectStore(DIRTY_QUEUE_STORE).getAll()
      req.onsuccess = () => resolve((req.result as DirtyEntry[]) ?? [])
      req.onerror = () => reject(req.error)
    })
  }

  async removeDirtyEntry(key: string): Promise<void> {
    return this.tx(DIRTY_QUEUE_STORE, 'readwrite', s => { s.delete(key) })
  }

  async countDirtyEntries(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(DIRTY_QUEUE_STORE, 'readonly')
      const req = tx.objectStore(DIRTY_QUEUE_STORE).count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async clearDirtyQueue(): Promise<void> {
    return this.tx(DIRTY_QUEUE_STORE, 'readwrite', s => { s.clear() })
  }

  async clearWorkspaceData(): Promise<void> {
    if (!this.db) return
    const stores = [RESOURCE_STORE, BLOB_STORE, DIRTY_QUEUE_STORE]
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(stores, 'readwrite')
      for (const name of stores) {
        tx.objectStore(name).clear()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
  }

  private tx(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(store, mode)
      fn(tx.objectStore(store))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
