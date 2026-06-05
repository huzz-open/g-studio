import { onMounted, onUnmounted } from 'vue'

export interface EditorKeyboardConfig {
  save: () => Promise<void> | void
  history?: { undo: () => void; redo: () => void } | null
}

/**
 * Unified keyboard shortcut handler for editor modules.
 * Registers Ctrl+S (save), Ctrl+Z (undo), Ctrl+Shift+Z / Ctrl+Y (redo).
 *
 * @param getConfig - Returns the current config based on active instance, or null to disable.
 */
export function useEditorKeyboard(getConfig: () => EditorKeyboardConfig | null): void {
  function onKeyDown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl) return

    const cfg = getConfig()
    if (!cfg) return

    if (e.key === 's') {
      e.preventDefault()
      void cfg.save()
    } else if (e.key === 'z' && !e.shiftKey) {
      if (cfg.history) {
        e.preventDefault()
        cfg.history.undo()
      }
    } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
      if (cfg.history) {
        e.preventDefault()
        cfg.history.redo()
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
}
