import { ref, onMounted, onUnmounted, provide, type Ref } from 'vue'
import type { EditorShellContext, ViewportState } from './types'

export const EDITOR_SHELL_KEY = Symbol('editor-shell')

interface ShortcutEntry {
  combo: string
  handler: () => void
}

export function useEditorShell() {
  const dirtyTabs = ref<Set<string>>(new Set())
  const shortcuts: ShortcutEntry[] = []
  const containerWidth = ref(0)
  const containerHeight = ref(0)
  const leftCollapsed = ref(false)
  const rightCollapsed = ref(false)
  const viewportStates = new Map<string, ViewportState>()

  function markDirty(tabId: string) {
    dirtyTabs.value.add(tabId)
  }

  function markClean(tabId: string) {
    dirtyTabs.value.delete(tabId)
  }

  function isDirty(tabId: string): boolean {
    return dirtyTabs.value.has(tabId)
  }

  function registerShortcut(combo: string, handler: () => void): () => void {
    const entry: ShortcutEntry = { combo, handler }
    shortcuts.push(entry)
    return () => {
      const idx = shortcuts.indexOf(entry)
      if (idx !== -1) shortcuts.splice(idx, 1)
    }
  }

  function parseCombo(combo: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string } {
    const parts = combo.toLowerCase().split('+')
    return {
      ctrl: parts.includes('ctrl'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
      key: parts[parts.length - 1],
    }
  }

  function matchesCombo(e: KeyboardEvent, combo: string): boolean {
    const parsed = parseCombo(combo)
    const ctrl = e.ctrlKey || e.metaKey
    if (parsed.ctrl !== ctrl) return false
    if (parsed.shift !== e.shiftKey) return false
    if (parsed.alt !== e.altKey) return false
    return e.key.toLowerCase() === parsed.key
  }

  function onKeyDown(e: KeyboardEvent) {
    for (const entry of shortcuts) {
      if (matchesCombo(e, entry.combo)) {
        e.preventDefault()
        entry.handler()
        return
      }
    }
  }

  function saveViewportState(tabId: string, state: ViewportState) {
    viewportStates.set(tabId, state)
  }

  function getViewportState(tabId: string): ViewportState | undefined {
    return viewportStates.get(tabId)
  }

  function removeViewportState(tabId: string) {
    viewportStates.delete(tabId)
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeyDown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeyDown)
  })

  const context: EditorShellContext = {
    markDirty,
    markClean,
    isDirty,
    registerShortcut,
    containerWidth,
    containerHeight,
    leftCollapsed,
    rightCollapsed,
  }

  provide(EDITOR_SHELL_KEY, context)

  return {
    ...context,
    dirtyTabs,
    saveViewportState,
    getViewportState,
    removeViewportState,
  }
}
