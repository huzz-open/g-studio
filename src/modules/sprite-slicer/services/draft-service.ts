import type { IStorageProvider } from '../../../shared/storage/interfaces'

const STORE = 'slicer-drafts'
const SESSION_KEY = 'current'

export interface SlicerDraftParams {
  bgRemoverId: string
  bgColor: [number, number, number]
  bgTolerance: number
  bgSpillStrength: number
  detectionMode: 'auto' | 'grid'
  mergeGap: number
  minArea: number
  cols: number
  rows: number
  gapH: number
  gapV: number
  marginH: number
  marginV: number
  namePrefix: string
  stdEnabled: boolean
}

export interface SlicerDraft {
  id: string
  fileName: string
  imageBlobKey: string
  /** If the tab was opened from resource manager, stores workspace-relative path. Restore reads from disk instead of IDB blob. */
  workspacePath?: string
  params: SlicerDraftParams
  spriteNames: string[]
  selectedIds: number[]
}

export interface SlicerSession {
  id: typeof SESSION_KEY
  activeTabId: string | null
  tabs: SlicerDraft[]
  savedAt: number
}

export class SlicerDraftService {
  private storage: IStorageProvider

  constructor(storage: IStorageProvider) {
    this.storage = storage
  }

  async saveSession(session: SlicerSession): Promise<void> {
    await this.storage.put(STORE, session as unknown as Record<string, unknown>)
  }

  async loadSession(): Promise<SlicerSession | null> {
    const rec = await this.storage.get(STORE, SESSION_KEY)
    return rec ? (rec as unknown as SlicerSession) : null
  }

  async saveImageBlob(tabId: string, data: Uint8Array): Promise<string> {
    const key = `slicer-drafts/${tabId}.png`
    await this.storage.setBlob(key, data)
    return key
  }

  async loadImageBlob(blobKey: string): Promise<Uint8Array | null> {
    return this.storage.getBlob(blobKey)
  }

  async deleteSession(): Promise<void> {
    const session = await this.loadSession()
    if (session) {
      for (const tab of session.tabs) {
        try { await this.storage.deleteBlob(tab.imageBlobKey) } catch { /* ok */ }
      }
      await this.storage.delete(STORE, SESSION_KEY)
    }
  }

  async deleteTabBlob(blobKey: string): Promise<void> {
    try { await this.storage.deleteBlob(blobKey) } catch { /* ok */ }
  }
}
