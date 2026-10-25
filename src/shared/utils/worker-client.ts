/** A lazy, persistent worker. Callers serialize tasks with createLatestTask. */
export function createWorkerClient<I, O>(factory: () => Worker) {
  let worker: Worker | undefined
  let sequence = 0
  let activeReject: ((error: Error) => void) | undefined
  function dispose() {
    worker?.terminate(); worker = undefined
    activeReject?.(new DOMException('Cancelled', 'AbortError')); activeReject = undefined
  }
  return {
    run(input: I, signal?: AbortSignal): Promise<O> {
      if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
      if (activeReject) return Promise.reject(new Error('Worker task already running'))
      return new Promise((resolve, reject) => {
        worker ??= factory()
        const target = worker, id = ++sequence
        const cleanup = () => { signal?.removeEventListener('abort', abort); target.onmessage = null; target.onerror = null; activeReject = undefined }
        const fail = (error: Error) => { cleanup(); reject(error) }
        const abort = () => { target.terminate(); worker = undefined; fail(new DOMException('Cancelled', 'AbortError')) }
        activeReject = fail
        signal?.addEventListener('abort', abort, { once: true })
        target.onmessage = (event: MessageEvent<{ id: number; result?: O; error?: string }>) => {
          if (event.data.id !== id) return
          cleanup()
          if (event.data.error) reject(new Error(event.data.error))
          else resolve(event.data.result as O)
        }
        target.onerror = event => { target.terminate(); worker = undefined; fail(new Error(event.message || 'Worker failed')) }
        try { target.postMessage({ id, input }) } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
      })
    },
    dispose,
  }
}
