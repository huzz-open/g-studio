import { watch, markRaw, effectScope } from 'vue'
import { createHistoryStack } from './createHistoryStack'
import type { HistoryOptions, Transaction } from './types'

/** Observe serializable editable state. Gestures are grouped by EditorShell. */
export function createObservedHistory<T>(options: HistoryOptions<T>) {
  const history = createHistoryStack(options)
  let gesture: Transaction | undefined
  const scope = effectScope(true)
  scope.run(() => watch(options.capture, (next, previous) => {
    const equal = options.isEqual ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b))
    if (!equal(next, previous)) history.recordSnapshot(previous)
  }, { flush: 'sync' }))
  const end = () => { gesture?.commit(); gesture = undefined }
  return markRaw({ ...history,
    begin() { if (!gesture) gesture = history.transaction() },
    end,
    cancel() { gesture?.cancel(); gesture = undefined },
    undo() { end(); history.undo() },
    redo() { end(); history.redo() },
    dispose() { end(); scope.stop() },
  })
}
