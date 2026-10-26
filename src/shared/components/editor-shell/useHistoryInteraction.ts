import { nextTick, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { historyShortcut, isTextInput, modalBlocksEditor, type HistoryController } from '../../history/interaction'

export function useHistoryInteraction(root: Ref<HTMLElement | undefined>, current: () => HistoryController | null | undefined, resolve?: (event: Event) => HistoryController | null | undefined) {
  let gesture: HistoryController | undefined
  function begin(event: Event) {
    if ((event.target as HTMLElement)?.closest('.shell-tab-bar') || modalBlocksEditor(root.value)) return
    if (event instanceof PointerEvent && event.button !== 0) return
    if (event instanceof KeyboardEvent && (isTextInput(event.target) || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))) return
    const history = resolve?.(event) ?? current()
    if (history?.begin && !gesture) { gesture = history; history.begin() }
  }
  function finish() { const history = gesture; gesture = undefined; if (history) void nextTick(() => history.end?.()) }
  function cancel() { gesture?.cancel?.(); gesture = undefined }
  function shortcut(event: KeyboardEvent) {
    if (event.defaultPrevented || isTextInput(event.target) || modalBlocksEditor(root.value)) return
    const command = historyShortcut(event), history = current()
    if (command && history) { event.preventDefault(); history[command]() }
  }
  watch(current, (next, previous) => {
    if (previous !== next) previous?.end?.()
    if (gesture !== next) { gesture?.end?.(); gesture = undefined }
  }, { flush: 'sync' })
  onMounted(() => {
    window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel)
    window.addEventListener('keyup', finish); window.addEventListener('blur', finish)
    window.addEventListener('keydown', shortcut)
  })
  onUnmounted(() => {
    gesture?.end?.()
    window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keyup', finish); window.removeEventListener('blur', finish)
    window.removeEventListener('keydown', shortcut)
  })
  return { begin }
}
