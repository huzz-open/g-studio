import { reactive } from 'vue'
import { canGenerateModels } from './generation/connection'
import { translate } from './i18n'
import { showToast, dismissToast } from './components/toast'
export const settingsDialog = reactive({ visible: false, category: '' })
export function openGenerationSettings() {
  settingsDialog.category = 'generation.connection'
  settingsDialog.visible = true
}
let connectionNotice: number | undefined
/** Existing/offline work stays accessible; attempts to enter from navigation prompt setup. */
export function needsGenerationSetup(path: string) {
  if (path !== '/model-generation' || canGenerateModels.value) return false
  if (connectionNotice !== undefined) dismissToast(connectionNotice)
  connectionNotice = showToast(translate('generation.openingSettings'), 'info')
  openGenerationSettings()
  return true
}
