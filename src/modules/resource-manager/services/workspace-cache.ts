import { ref, type Ref } from 'vue'
import type { ScanResult } from '../interfaces/meta'
import { scanWorkspace } from './fs-scanner'
import { reconcile, type ReconciliationReport } from './reconciliation'
import { migrateFromRegistry } from './migration'
import { getWorkspaceHandle } from '../../../shared/workspace'

export interface WorkspaceCacheState {
  scanResult: Ref<ScanResult | null>
  scanning: Ref<boolean>
  lastScanAt: Ref<number>
}

const scanResult = ref<ScanResult | null>(null)
const scanning = ref(false)
const lastScanAt = ref(0)
let reconciled = false

export function getWorkspaceCache(): WorkspaceCacheState {
  return { scanResult, scanning, lastScanAt }
}

/**
 * Quick scan: only runs directory scan + reads existing metas.
 * No reconciliation (no contentHash computation).
 */
export async function quickScan(): Promise<ScanResult | null> {
  const handle = getWorkspaceHandle()
  if (!handle) return null

  scanning.value = true
  try {
    const result = await scanWorkspace(handle)
    scanResult.value = result
    lastScanAt.value = Date.now()
    return result
  } finally {
    scanning.value = false
  }
}

/**
 * Full scan with reconciliation. Only needed on first connection
 * or explicit refresh.
 */
export async function fullScan(): Promise<ReconciliationReport | null> {
  const handle = getWorkspaceHandle()
  if (!handle) return null

  scanning.value = true
  try {
    const migrated = await migrateFromRegistry(handle)
    const result = await scanWorkspace(handle)
    const report = await reconcile(handle, result)
    scanResult.value = result
    lastScanAt.value = Date.now()
    reconciled = true

    if (migrated > 0) {
      report.newMetas += migrated
    }
    return report
  } finally {
    scanning.value = false
  }
}

/**
 * Smart scan: full reconcile on first call, quick scan on subsequent.
 */
export async function smartScan(): Promise<ReconciliationReport | null> {
  if (!reconciled) {
    return fullScan()
  }
  await quickScan()
  return null
}

/**
 * Invalidate the cache, next smartScan will do full reconcile.
 */
export function invalidateCache() {
  reconciled = false
  scanResult.value = null
  lastScanAt.value = 0
}

/**
 * Mark that a file was written to workspace, triggering a quick re-scan.
 * Used by workspace-file-ops after saves.
 */
export function notifyFileChanged() {
  void quickScan()
}
