import { reactive } from 'vue'
import { canGenerateModels } from './generation/connection'
import { generationServiceStatus } from './generation/readiness'
import { showGenerationFeedback } from './generation/feedback'
export const settingsDialog = reactive({ visible: false, category: '' })
export function openGenerationSettings() {
  settingsDialog.category = 'generation.connection'
  settingsDialog.visible = true
}
/** Existing/offline work stays accessible; attempts to enter from navigation prompt setup. */
export function needsGenerationSetup(path: string) {
  if (path !== '/model-generation' || canGenerateModels.value) return false
  const status = generationServiceStatus.value
  showGenerationFeedback(status.detail, status.type, 6000)
  openGenerationSettings()
  return true
}
