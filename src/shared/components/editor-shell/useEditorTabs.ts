import { ref, computed, type Ref, type ComputedRef } from 'vue'

export interface UseEditorTabsOptions<T extends { id: string }> {
  prefix: string
  factory: (id: string) => T
  destroy?: (id: string) => void
}

export interface UseEditorTabsReturn<T extends { id: string }> {
  instances: Ref<T[]>
  activeTabId: Ref<string | null>
  activeInstance: ComputedRef<T | null>
  createTab: () => T
  switchTab: (id: string) => void
  closeTab: (id: string) => void
}

export function useEditorTabs<T extends { id: string }>(
  options: UseEditorTabsOptions<T>,
): UseEditorTabsReturn<T> {
  const instances = ref<T[]>([]) as Ref<T[]>
  const activeTabId = ref<string | null>(null)
  let counter = 0

  const activeInstance = computed<T | null>(() => {
    if (!activeTabId.value) return null
    return instances.value.find(i => i.id === activeTabId.value) ?? null
  })

  function createTab(): T {
    const id = `${options.prefix}-${++counter}-${Date.now()}`
    const inst = options.factory(id)
    instances.value.push(inst)
    activeTabId.value = id
    return inst
  }

  function switchTab(id: string) {
    activeTabId.value = id
  }

  function closeTab(id: string) {
    const idx = instances.value.findIndex(i => i.id === id)
    if (idx === -1) return
    instances.value.splice(idx, 1)
    options.destroy?.(id)
    if (activeTabId.value === id) {
      activeTabId.value =
        instances.value[Math.min(idx, instances.value.length - 1)]?.id ?? null
    }
  }

  return { instances, activeTabId, activeInstance, createTab, switchTab, closeTab }
}
