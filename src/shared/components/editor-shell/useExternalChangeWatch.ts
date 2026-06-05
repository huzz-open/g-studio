import { onMounted, onUnmounted } from 'vue'
import { showToast } from '../toast'
import { useI18n } from '../../i18n'

export interface ExternalChangeWatchConfig {
  getInstance: () => {
    state: { gsPath: string | null; dirty: boolean }
    checkExternalChange: () => Promise<boolean>
    reloadFromDisk: () => Promise<void>
  } | null
}

/**
 * Watches for external file changes when the tab/window regains visibility.
 * If the file was modified externally and no local edits exist, auto-reloads.
 * If local edits exist, shows a notification.
 */
export function useExternalChangeWatch(config: ExternalChangeWatchConfig): void {
  const { t } = useI18n()

  async function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return
    const inst = config.getInstance()
    if (!inst || !inst.state.gsPath) return

    try {
      const changed = await inst.checkExternalChange()
      if (changed) {
        if (inst.state.dirty) {
          showToast(t('externalChange.dirtyHint'), 'info')
        } else {
          await inst.reloadFromDisk()
          showToast(t('externalChange.reloaded'), 'info')
        }
      }
    } catch { /* ignore read failures on focus */ }
  }

  onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange))
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisibilityChange))
}
