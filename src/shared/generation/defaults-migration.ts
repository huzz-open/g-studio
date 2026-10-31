import { TARGET_FACES_DEFAULT } from '../../../packages/generation-protocol/limits'

const revision = '40000-128-v1'
const builtInProviders = ['hunyuan-mini', 'hunyuan-turbo', 'hunyuan-2-1']

export function writeStoredGenerationParameters(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
  localStorage.setItem(key + ':defaults-revision', revision)
}

/** Upgrade legacy default-valued preferences once, not submitted job snapshots.
 * Older storage did not distinguish a default from an explicitly entered value.
 * After migration the marker preserves even deliberate reuse of those old values.
 */
export function readStoredGenerationParameters(key: string, migrateDefaults = true) {
  let saved
  try { saved = JSON.parse(localStorage.getItem(key) || 'null') } catch { return undefined }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return undefined
  if (!migrateDefaults) return saved
  const marker = key + ':defaults-revision'
  try { if (localStorage.getItem(marker) === revision) return saved } catch { return saved }
  if (saved.targetFaces === 12000) saved.targetFaces = TARGET_FACES_DEFAULT
  for (const id of builtInProviders) {
    const parameters = saved.parametersByProvider?.[id]
    if (parameters && typeof parameters === 'object' && [256, 384].includes(parameters.resolution)) {
      // Inherit the current provider default instead of freezing another number.
      delete parameters.resolution
    }
  }
  try {
    writeStoredGenerationParameters(key, saved)
  } catch { /* Keep the migrated values in memory when storage is unavailable. */ }
  return saved
}
