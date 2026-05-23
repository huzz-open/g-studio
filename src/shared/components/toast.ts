import { ref, type Ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastRef {
  show: (message: string, type?: ToastType, duration?: number, action?: ToastAction) => void
}

const toastRef: Ref<ToastRef | null> = ref(null)

export function registerToast(instance: ToastRef) {
  toastRef.value = instance
}

export function showToast(message: string, type: ToastType = 'info', duration = 3000, action?: ToastAction) {
  toastRef.value?.show(message, type, duration, action)
}

export function useToast() {
  return { showToast }
}
