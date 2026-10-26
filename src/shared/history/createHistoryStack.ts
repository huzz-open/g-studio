import { ref, computed } from 'vue'
import type { HistoryOptions, HistoryStack, Transaction } from './types'

export function createHistoryStack<T>(options: HistoryOptions<T>): HistoryStack<T> {
  const { capture, restore, maxSize = 50 } = options
  const equal = options.isEqual ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b))
  const past: T[] = [], future: T[] = []
  const isRestoring = ref(false), undoLength = ref(0), redoLength = ref(0)
  let active: { snapshot: T } | null = null
  const canUndo = computed(() => undoLength.value > 0), canRedo = computed(() => redoLength.value > 0)
  function lengths() { undoLength.value = past.length; redoLength.value = future.length }
  function apply(snapshot: T) { isRestoring.value = true; try { restore(snapshot) } finally { isRestoring.value = false } }
  function push(snapshot: T) { past.push(snapshot); if (past.length > maxSize) past.shift(); future.length = 0; lengths() }
  function recordSnapshot(snapshot: T) { if (!isRestoring.value && !active) push(snapshot) }
  function record() { recordSnapshot(capture()) }
  function batch(fn: () => void) {
    if (isRestoring.value) return
    if (active) { fn(); return }
    const tx=transaction()
    try { fn(); tx.commit() } catch(error) { tx.cancel(); throw error }
  }
  function finish() {
    if (!active) return
    const before = active.snapshot; active = null
    if (!equal(before, capture())) push(before)
  }
  function transaction(): Transaction {
    // Settle a previous owner before starting another gesture. Its late commit
    // must never overwrite the new transaction or duplicate an undo entry.
    finish()
    const token = { snapshot: capture() }; active = token
    return {
      commit() { if (active === token) finish() },
      cancel() { if (active === token) { active = null; apply(token.snapshot) } },
    }
  }
  function undo() {
    finish()
    if (!past.length) return
    future.push(capture()); const previous = past.pop()!; lengths(); apply(previous)
  }
  function redo() {
    finish()
    if (!future.length) return
    past.push(capture()); const next = future.pop()!; lengths(); apply(next)
  }
  function clear() { active = null; past.length = 0; future.length = 0; lengths() }
  return { canUndo, canRedo, isRestoring, record, recordSnapshot, batch, transaction, undo, redo, clear }
}
