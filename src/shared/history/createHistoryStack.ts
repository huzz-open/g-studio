import { ref, computed } from 'vue'
import type { HistoryOptions, HistoryStack, Transaction } from './types'

export function createHistoryStack<T>(options: HistoryOptions<T>): HistoryStack<T> {
  const { capture, restore, maxSize = 50 } = options
  const isEqual = options.isEqual ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b))

  const undoStack: T[] = []
  const redoStack: T[] = []
  const isRestoring = ref(false)
  let activeTransaction: T | null = null

  const _undoLen = ref(0)
  const _redoLen = ref(0)
  const canUndo = computed(() => _undoLen.value > 0)
  const canRedo = computed(() => _redoLen.value > 0)

  function pushUndo(snapshot: T) {
    undoStack.push(snapshot)
    if (undoStack.length > maxSize) undoStack.shift()
    redoStack.length = 0
    _undoLen.value = undoStack.length
    _redoLen.value = 0
  }

  function record() {
    if (isRestoring.value) return
    pushUndo(capture())
  }

  function batch(fn: () => void) {
    if (isRestoring.value) return
    const before = capture()
    fn()
    const after = capture()
    if (!isEqual(before, after)) {
      undoStack.push(before)
      if (undoStack.length > maxSize) undoStack.shift()
      redoStack.length = 0
      _undoLen.value = undoStack.length
      _redoLen.value = 0
    }
  }

  function transaction(): Transaction {
    const startSnapshot = capture()
    activeTransaction = startSnapshot
    let settled = false

    return {
      commit() {
        if (settled) return
        settled = true
        activeTransaction = null
        const current = capture()
        if (!isEqual(startSnapshot, current)) {
          undoStack.push(startSnapshot)
          if (undoStack.length > maxSize) undoStack.shift()
          redoStack.length = 0
          _undoLen.value = undoStack.length
          _redoLen.value = 0
        }
      },
      cancel() {
        if (settled) return
        settled = true
        activeTransaction = null
        isRestoring.value = true
        restore(startSnapshot)
        isRestoring.value = false
      },
    }
  }

  function undo() {
    if (activeTransaction) {
      isRestoring.value = true
      restore(activeTransaction)
      isRestoring.value = false
      activeTransaction = null
      return
    }
    if (undoStack.length === 0) return
    const current = capture()
    const prev = undoStack.pop()!
    redoStack.push(current)
    _undoLen.value = undoStack.length
    _redoLen.value = redoStack.length
    isRestoring.value = true
    restore(prev)
    isRestoring.value = false
  }

  function redo() {
    if (activeTransaction) {
      activeTransaction = null
    }
    if (redoStack.length === 0) return
    const current = capture()
    const next = redoStack.pop()!
    undoStack.push(current)
    _undoLen.value = undoStack.length
    _redoLen.value = redoStack.length
    isRestoring.value = true
    restore(next)
    isRestoring.value = false
  }

  function clear() {
    undoStack.length = 0
    redoStack.length = 0
    activeTransaction = null
    _undoLen.value = 0
    _redoLen.value = 0
  }

  return { canUndo, canRedo, isRestoring, record, batch, transaction, undo, redo, clear }
}
