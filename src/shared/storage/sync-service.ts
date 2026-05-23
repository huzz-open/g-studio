import { ref, type Ref } from 'vue'
import type { IndexedDBProvider, DirtyEntry } from './indexeddb-provider'
import type { StorageRecord } from './interfaces'
import { WORKSPACE_REGISTRY_FILE } from '../workspace/interfaces'

export type SyncStatus = 'synced' | 'syncing' | 'error' | 'disconnected'

export class SyncService {
  private dirHandle: FileSystemDirectoryHandle | null = null
  private idb: IndexedDBProvider | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _onVisibilityChange: (() => void) | null = null
  private _onBeforeUnload: (() => void) | null = null
  private flushing = false

  readonly status: Ref<SyncStatus> = ref('disconnected')

  async connect(handle: FileSystemDirectoryHandle, idb: IndexedDBProvider): Promise<void> {
    this.dirHandle = handle
    this.idb = idb

    await this.flushAllPending()
    await this.incrementalSync()

    this.status.value = 'synced'
    this.setupLifecycleHooks()
    this.startHeartbeat()
  }

  async disconnect(): Promise<void> {
    await this.flushAllPending()
    this.teardownLifecycleHooks()
    this.stopHeartbeat()
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.dirHandle = null
    this.idb = null
    this.status.value = 'disconnected'
  }

  scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.flushAllPending(), 300)
  }

  async flushAllPending(): Promise<void> {
    if (!this.idb || !this.dirHandle || this.flushing) return
    this.flushing = true
    try {
      this.status.value = 'syncing'
      const entries = await this.idb.getAllDirtyEntries()
      if (entries.length === 0) {
        this.status.value = 'synced'
        return
      }

      for (const entry of entries) {
        try {
          await this.flushEntry(entry)
          await this.idb!.removeDirtyEntry(entry.key)
        } catch (err) {
          console.warn('[SyncService] flush error for', entry.key, err)
          this.status.value = 'error'
          return
        }
      }
      await this.persistRegistry()
      this.status.value = 'synced'
    } finally {
      this.flushing = false
    }
  }

  async loadBlobFromDisk(key: string): Promise<Uint8Array | null> {
    if (!this.dirHandle) return null
    try {
      const { dir, fileName } = await this.resolveFilePath(key, false)
      const fileHandle = await dir.getFileHandle(fileName)
      const file = await fileHandle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch {
      return null
    }
  }

  private async flushEntry(entry: DirtyEntry): Promise<void> {
    if (entry.action === 'delete') {
      if (entry.type === 'blob') {
        await this.deleteBlobFromDisk(entry.key.replace('blob:', ''))
      } else {
        // Record deletion: the registry will be persisted after all flushes
      }
    } else {
      if (entry.type === 'blob') {
        const blobKey = entry.key.replace('blob:', '')
        const data = await this.idb!.getBlob(blobKey)
        if (data) await this.writeBlobToDisk(blobKey, data)
      } else {
        // Record upsert: the registry will be persisted after all flushes
      }
    }
  }

  private async incrementalSync(): Promise<void> {
    if (!this.idb || !this.dirHandle) return

    const diskRecords = await this.readRegistryFromDisk()
    const idbRecords = await this.idb.getAll('resources')
    const idbMap = new Map<string, number>()
    for (const r of idbRecords) {
      idbMap.set(r.id as string, (r.updatedAt as number) ?? 0)
    }

    for (const diskRecord of diskRecords) {
      const diskId = diskRecord.id as string
      const idbUpdatedAt = idbMap.get(diskId)
      const diskUpdatedAt = (diskRecord.updatedAt as number) ?? 0

      if (idbUpdatedAt === undefined || diskUpdatedAt > idbUpdatedAt) {
        await this.idb.put('resources', diskRecord)
      }
      idbMap.delete(diskId)
    }

    for (const orphanId of idbMap.keys()) {
      await this.idb.delete('resources', orphanId)
    }

    await this.idb.clearDirtyQueue()
  }

  private async readRegistryFromDisk(): Promise<StorageRecord[]> {
    if (!this.dirHandle) return []
    try {
      const file = await this.dirHandle.getFileHandle(WORKSPACE_REGISTRY_FILE)
      const text = await (await file.getFile()).text()
      const data = JSON.parse(text) as { stores?: Record<string, StorageRecord[]> }
      return data.stores?.resources ?? []
    } catch {
      return []
    }
  }

  private async persistRegistry(): Promise<void> {
    if (!this.dirHandle || !this.idb) return
    const records = await this.idb.getAll('resources')
    const data = {
      version: 1,
      updatedAt: Date.now(),
      stores: { resources: records },
    }
    try {
      const fileHandle = await this.dirHandle.getFileHandle(WORKSPACE_REGISTRY_FILE, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(JSON.stringify(data, null, 2))
      await writable.close()
    } catch (err) {
      console.warn('[SyncService] registry persist error', err)
      this.status.value = 'error'
    }
  }

  private async writeBlobToDisk(key: string, data: Uint8Array): Promise<void> {
    if (!this.dirHandle) return
    const { dir, fileName } = await this.resolveFilePath(key, true)
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(new Blob([data as BlobPart]))
    await writable.close()
  }

  private async deleteBlobFromDisk(key: string): Promise<void> {
    if (!this.dirHandle) return
    try {
      const { dir, fileName } = await this.resolveFilePath(key, false)
      await dir.removeEntry(fileName)
    } catch {
      /* file doesn't exist, safe to ignore */
    }
  }

  private async resolveFilePath(
    key: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; fileName: string }> {
    const parts = key.split('/')
    let dir = this.dirHandle!
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create })
    }
    return { dir, fileName: parts[parts.length - 1] }
  }

  private setupLifecycleHooks(): void {
    this._onVisibilityChange = () => {
      if (document.hidden) void this.flushAllPending()
    }
    document.addEventListener('visibilitychange', this._onVisibilityChange)

    this._onBeforeUnload = () => {
      // Best-effort; File System Access API is async so this may not complete
      void this.flushAllPending()
    }
    window.addEventListener('beforeunload', this._onBeforeUnload)
  }

  private teardownLifecycleHooks(): void {
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange)
      this._onVisibilityChange = null
    }
    if (this._onBeforeUnload) {
      window.removeEventListener('beforeunload', this._onBeforeUnload)
      this._onBeforeUnload = null
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.idb && !this.flushing) {
        void this.idb.countDirtyEntries().then(count => {
          if (count > 0) void this.flushAllPending()
        })
      }
    }, 5000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
