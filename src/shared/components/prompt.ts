import { ref, type Ref } from 'vue'

export interface PromptOptions {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  suggestions?: string[]
}

interface PromptRef {
  open: (options: PromptOptions) => Promise<string | null>
}

const promptRef: Ref<PromptRef | null> = ref(null)

export function registerPrompt(instance: PromptRef) {
  promptRef.value = instance
}

export function prompt(options: PromptOptions): Promise<string | null> {
  if (!promptRef.value) return Promise.resolve(null)
  return promptRef.value.open(options)
}
