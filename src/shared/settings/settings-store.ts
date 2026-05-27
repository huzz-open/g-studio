import { reactive, watch, toRaw } from 'vue'
import { getWorkspaceHandle } from '../workspace'
import { WORKSPACE_SYSTEM_DIR, WORKSPACE_CONFIG_FILE } from '../workspace/interfaces'
import { readJsonFileOrNull, writeJsonFile } from '../workspace/fs'
import { showToast } from '../components/toast'

export interface ExportOptions {
  composite: boolean
  sprites: boolean
  meta: boolean
}

export interface SlicerDefaults {
  detectionMode: 'auto' | 'grid'
  bgRemoval: 'auto' | 'none'
  minArea: number
  mergeGap: number
  namePrefix: string
  arrangeMode: 'none' | 'standardize' | 'bin-pack'
  snapDistance: number
  exportOptions: ExportOptions
}

export interface SettingsData {
  spriteSlicer: {
    defaults: SlicerDefaults
    lastSaveDir?: string
    lastTags?: string[]
  }
}

const DEFAULTS: SettingsData = {
  spriteSlicer: {
    defaults: {
      detectionMode: 'auto',
      bgRemoval: 'auto',
      minArea: 50,
      mergeGap: 3,
      namePrefix: 'sprite',
      arrangeMode: 'none' as const,
      snapDistance: 5,
      exportOptions: { composite: true, sprites: false, meta: true },
    },
  },
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sv = source[key]
    if (sv !== undefined && typeof sv === 'object' && !Array.isArray(sv) && typeof target[key] === 'object') {
      result[key] = deepMerge(target[key] as any, sv as any)
    } else if (sv !== undefined) {
      result[key] = sv as any
    }
  }
  return result
}

const settings = reactive<SettingsData>(structuredClone(DEFAULTS))
let _loaded = false
let _saving = false

async function readFromDisk(): Promise<Partial<SettingsData>> {
  const root = getWorkspaceHandle()
  if (!root) return {}
  try {
    const sysDir = await root.getDirectoryHandle(WORKSPACE_SYSTEM_DIR)
    const config = await readJsonFileOrNull<Record<string, unknown>>(sysDir, WORKSPACE_CONFIG_FILE)
    return (config?.settings as Partial<SettingsData>) ?? {}
  } catch (e) {
    console.error('[settings] failed to read:', e)
    return {}
  }
}

async function writeToDisk(): Promise<void> {
  const root = getWorkspaceHandle()
  if (!root) return
  try {
    const sysDir = await root.getDirectoryHandle(WORKSPACE_SYSTEM_DIR, { create: true })
    const config = await readJsonFileOrNull<Record<string, unknown>>(sysDir, WORKSPACE_CONFIG_FILE) ?? {}
    config.settings = toRaw(settings)
    await writeJsonFile(sysDir, WORKSPACE_CONFIG_FILE, config)
  } catch (e) {
    console.error('[settings] failed to write:', e)
    showToast('设置保存失败', 'error')
  }
}

export async function loadSettings(): Promise<void> {
  const stored = await readFromDisk()
  const merged = deepMerge(structuredClone(DEFAULTS), stored as any)
  Object.assign(settings, merged)
  _loaded = true
}

export async function saveSettings(): Promise<void> {
  if (_saving) return
  _saving = true
  try {
    await writeToDisk()
  } finally {
    _saving = false
  }
}

export function resetSettings(): void {
  Object.assign(settings, structuredClone(DEFAULTS))
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(settings, () => {
  if (!_loaded) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => saveSettings(), 500)
}, { deep: true })

export function useSettings() {
  return {
    settings,
    loadSettings,
    saveSettings,
    resetSettings,
    DEFAULTS,
  }
}
