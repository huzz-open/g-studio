import type { Ref } from 'vue'

export interface HistoryController {
  canUndo: boolean | Readonly<Ref<boolean>>
  canRedo: boolean | Readonly<Ref<boolean>>
  undo(): void
  redo(): void
  begin?(): void
  end?(): void
  cancel?(): void
}

export function historyShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  const key = event.key.toLowerCase()
  return key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' ? 'redo' : null
}

export function isTextInput(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('textarea, [contenteditable="true"], [contenteditable=""]')) return true
  return target instanceof HTMLInputElement && !['range','checkbox','radio','button','submit','color','file'].includes(target.type)
}

export function modalBlocksEditor(root?: HTMLElement) {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], dialog[open]')].filter(el=>el.getClientRects().length)
  return dialogs.length > 0 && (!root || !dialogs[dialogs.length - 1].contains(root))
}
