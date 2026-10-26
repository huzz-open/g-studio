import { onMounted, onUnmounted } from 'vue'
import { isTextInput, modalBlocksEditor, historyShortcut } from '../../history/interaction'

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

    if (e.defaultPrevented || modalBlocksEditor()) return
    if (e.key.toLowerCase() === 's') {
      e.preventDefault(); void cfg.save()
    } else {
      const command=historyShortcut(e)
      if(command && cfg.history && !isTextInput(e.target)){e.preventDefault();cfg.history[command]()}
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
}
