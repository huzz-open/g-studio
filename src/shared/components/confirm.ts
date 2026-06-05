import { ref, type Ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export interface ChoiceOption {
  id: string
  label: string
  danger?: boolean
}

export interface ChoiceOptions {
  title: string
  message: string
  options: ChoiceOption[]
}

interface ConfirmRef {
  open: (options: ConfirmOptions) => Promise<boolean>
  openChoice?: (options: ChoiceOptions) => Promise<string | null>
}

const confirmRef: Ref<ConfirmRef | null> = ref(null)

export function registerConfirm(instance: ConfirmRef) {
  confirmRef.value = instance
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (!confirmRef.value) return Promise.resolve(false)
  return confirmRef.value.open(options)
}

export function confirmChoice(options: ChoiceOptions): Promise<string | null> {
  if (!confirmRef.value?.openChoice) return Promise.resolve(null)
  return confirmRef.value.openChoice(options)
}
