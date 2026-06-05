import { ref, type Ref } from 'vue'

export interface InlineChoice {
  id: string
  label: string
  options: { value: string; label: string }[]
  defaultValue: string
}

export interface PromptOptions {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  cancelText?: string
  suggestions?: string[]
  inlineChoices?: InlineChoice[]
}

export interface PromptExtendedResult {
  value: string
  choices: Record<string, string>
}

interface PromptRef {
  open: (options: PromptOptions) => Promise<string | null>
  openExtended: (options: PromptOptions) => Promise<PromptExtendedResult | null>
}

const promptRef: Ref<PromptRef | null> = ref(null)

export function registerPrompt(instance: PromptRef) {
  promptRef.value = instance
}

export function prompt(options: PromptOptions): Promise<string | null> {
  if (!promptRef.value) return Promise.resolve(null)
  return promptRef.value.open(options)
}

export function promptExtended(options: PromptOptions): Promise<PromptExtendedResult | null> {
  if (!promptRef.value) return Promise.resolve(null)
  return promptRef.value.openExtended(options)
}
