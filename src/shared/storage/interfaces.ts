export interface StorageRecord {
  [key: string]: unknown
}

export interface StorageQuery {
  filter?: { field: string; value: unknown }
  keyword?: { field: string; text: string }
  sort?: { field: string; direction: 'asc' | 'desc' }
  limit?: number
  offset?: number
}

export interface IStorageProvider {
  init(): Promise<void>

  put(store: string, record: StorageRecord): Promise<void>
  get(store: string, key: string): Promise<StorageRecord | null>
  getAll(store: string, query?: StorageQuery): Promise<StorageRecord[]>
  delete(store: string, key: string): Promise<void>
  count(store: string, filter?: { field: string; value: unknown }): Promise<number>

  getBlob(key: string): Promise<Uint8Array | null>
  setBlob(key: string, data: Uint8Array): Promise<void>
  deleteBlob(key: string): Promise<void>

  close(): Promise<void>
}
