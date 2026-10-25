export interface LatestTaskOptions<T, R> {
  run: (input: T, signal: AbortSignal) => Promise<R>
  apply: (result: R, input: T) => void
  onError?: (error: unknown) => void
  onBusy?: (busy: boolean) => void
  mode?: 'immediate' | 'throttle' | 'debounce' | 'commit'
  interval?: number
  adaptive?: { min: number; max: number }
  acceptIntermediate?: boolean
}

/** One running task plus one replaceable pending snapshot. No queues of obsolete work. */
export function createLatestTask<T, R>(options: LatestTaskOptions<T, R>) {
  let pending: { input: T; version: number } | undefined
  let running: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0, lastStart = -Infinity, lastRequest = 0, average = 0
  let urgent = false, disposed = false, busy = false
  const waiters: (() => void)[] = []
  function setBusy(value: boolean) {
    if (busy !== value) { busy = value; options.onBusy?.(value) }
    if (!value) waiters.splice(0).forEach(resolve => resolve())
  }
  function interval() {
    const base = options.interval ?? 100
    return options.adaptive
      ? Math.min(options.adaptive.max, Math.max(options.adaptive.min, average ? average * 0.5 : base)) : base
  }
  function schedule() {
    clearTimeout(timer)
    if (disposed || running || !pending) return
    const mode = options.mode ?? 'throttle'
    if (mode === 'commit' && !urgent) return
    const delay = urgent || mode === 'immediate' ? 0
      : Math.max(0, (mode === 'debounce' ? lastRequest : lastStart) + interval() - performance.now())
    // Yield even for immediate work so controls paint their new value first.
    timer = setTimeout(start, delay)
  }
  async function start() {
    if (disposed || running || !pending) return
    const job = pending; pending = undefined; urgent = false
    const controller = new AbortController(); running = controller
    lastStart = performance.now()
    try {
      const result = await options.run(job.input, controller.signal)
      if (!disposed && running === controller && !controller.signal.aborted
        && (options.acceptIntermediate || job.version === version)) options.apply(result, job.input)
    } catch (error) {
      if (!disposed && running === controller && !controller.signal.aborted && job.version === version) options.onError?.(error)
    } finally {
      if (running === controller) {
        const elapsed = performance.now() - lastStart
        average = average ? average * 0.75 + elapsed * 0.25 : elapsed
        running = undefined
        if (pending) schedule()
        else setBusy(false)
      }
    }
  }
  function cancel() {
    version++; pending = undefined; urgent = false; clearTimeout(timer)
    running?.abort(); running = undefined; setBusy(false)
  }
  return {
    request(input: T, immediate = false) {
      if (disposed) return
      pending = { input, version: ++version }; lastRequest = performance.now(); urgent ||= immediate
      setBusy(true); schedule()
    },
    flush() { if (pending && !disposed) { urgent = true; schedule() } },
    whenIdle(): Promise<void> { return busy ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve() },
    cancel,
    dispose() { disposed = true; cancel() },
    getState: () => ({ busy, running: !!running, pending: !!pending, interval: interval() }),
  }
}
