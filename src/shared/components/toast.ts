import { ref, type Ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastRef {
  show: (message: string, type?: ToastType, duration?: number, action?: ToastAction) => number
  dismiss: (id: number) => void
}

const toastRef: Ref<ToastRef | null> = ref(null)

export function registerToast(instance: ToastRef) {
  toastRef.value = instance
}

export function showToast(message: string, type: ToastType = 'info', duration = 3000, action?: ToastAction): number {
  return toastRef.value?.show(message, type, duration, action) ?? 0
}

export function dismissToast(id: number) {
  toastRef.value?.dismiss(id)
}

export async function withProgress<T>(
  loadingMsg: string,
  successMsg: string,
  errorMsg: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const loadingId = showToast(loadingMsg, 'info', 60000)
  try {
    const result = await fn()
    dismissToast(loadingId)
    showToast(successMsg, 'success')
    return result
  } catch (e) {
    dismissToast(loadingId)
    showToast(errorMsg, 'error')
    return undefined
  }
}

export function useToast() {
  return { showToast, withProgress }
}
