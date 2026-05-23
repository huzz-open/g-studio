import { ref, type Ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmRef {
  open: (options: ConfirmOptions) => Promise<boolean>
}

const confirmRef: Ref<ConfirmRef | null> = ref(null)

export function registerConfirm(instance: ConfirmRef) {
  confirmRef.value = instance
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (!confirmRef.value) return Promise.resolve(false)
  return confirmRef.value.open(options)
}
