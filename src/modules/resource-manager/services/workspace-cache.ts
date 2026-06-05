import { ref, type Ref } from 'vue'
import type { ScanResult } from '../interfaces/meta'
import { scanWorkspace } from './fs-scanner'
import { getWorkspaceHandle } from '../../../shared/workspace'

export interface WorkspaceCacheState {
  scanResult: Ref<ScanResult | null>
  scanning: Ref<boolean>
  lastScanAt: Ref<number>
}

const scanResult = ref<ScanResult | null>(null)
const scanning = ref(false)
const lastScanAt = ref(0)

export function getWorkspaceCache(): WorkspaceCacheState {
  return { scanResult, scanning, lastScanAt }
}

async function scan(): Promise<ScanResult | null> {
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

export async function quickScan(): Promise<ScanResult | null> {
  return scan()
}

export async function fullScan(): Promise<ScanResult | null> {
  return scan()
}

export async function smartScan(): Promise<ScanResult | null> {
  return scan()
}

export function invalidateCache() {
  scanResult.value = null
  lastScanAt.value = 0
}

export function notifyFileChanged() {
  void scan()
}
