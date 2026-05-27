import { ref, computed } from 'vue'
import zhCN from './zh-CN'
import enUS from './en-US'

export type MessageKeys = keyof typeof zhCN

const messages: Record<string, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

const STORAGE_KEY = 'g-studio-locale'

function loadLocale(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'zh-CN'
  } catch (e) {
    console.warn('[i18n] localStorage read failed:', e)
    return 'zh-CN'
  }
}

export const locale = ref(loadLocale())

export const availableLocales = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'English' },
] as const

export function setLocale(code: string) {
  locale.value = code
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch (e) { console.warn('[i18n] localStorage write failed:', e) }
}

export function translate(key: string, params?: Record<string, string | number>): string {
  const dict = messages[locale.value] ?? messages['zh-CN']
  let text = dict[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}

export function useI18n() {
  const t = computed(() => {
    const dict = messages[locale.value] ?? messages['zh-CN']
    return (key: string, params?: Record<string, string | number>): string => {
      let text = dict[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v))
        }
      }
      return text
    }
  })

  return {
    t: (key: string, params?: Record<string, string | number>) => t.value(key, params),
    locale,
    setLocale,
    availableLocales,
  }
}
