import { ref, onUnmounted } from 'vue'

export interface ResizablePanelOptions {
  defaultWidth: number
  minWidth: number
  maxWidth: number
  side?: 'left' | 'right'
  persistKey?: string
}

export function useResizablePanel(options: ResizablePanelOptions) {
  const side = options.side ?? 'left'
  const stored = options.persistKey
    ? parseInt(localStorage.getItem(options.persistKey) ?? '', 10)
    : NaN
  const width = ref(Number.isFinite(stored) ? clampWidth(stored) : options.defaultWidth)

  let onMove: ((e: MouseEvent) => void) | null = null
  let onUp: (() => void) | null = null

  function clampWidth(v: number) {
    return Math.min(options.maxWidth, Math.max(options.minWidth, v))
  }

  function onResizeStart(e: MouseEvent) {
    e.preventDefault()
    onMove = (ev: MouseEvent) => {
      const raw = side === 'left'
        ? ev.clientX
        : window.innerWidth - ev.clientX
      width.value = clampWidth(raw)
    }
    onUp = () => {
      document.removeEventListener('mousemove', onMove!)
      document.removeEventListener('mouseup', onUp!)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      onMove = null
      onUp = null
      if (options.persistKey) {
        localStorage.setItem(options.persistKey, String(width.value))
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function cleanup() {
    if (onMove) document.removeEventListener('mousemove', onMove)
    if (onUp) document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  onUnmounted(cleanup)

  return { width, onResizeStart }
}
