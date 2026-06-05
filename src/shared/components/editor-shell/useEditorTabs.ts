import { ref, computed, type Ref, type ComputedRef } from 'vue'

export interface TabPersistConfig<T extends { id: string }, D> {
  key: string
  serialize: (instance: T) => D | null
  restore: (descriptor: D) => Promise<T>
  getIdentifier: (instance: T) => string | null
  descriptorFromGsPath: (path: string) => D
}

export interface UseEditorTabsOptions<T extends { id: string }> {
  prefix: string
  factory: (id: string) => T
  destroy?: (id: string) => void
  persist?: TabPersistConfig<T, any>
  autoEmptyTab?: boolean
}

export interface UseEditorTabsReturn<T extends { id: string }> {
  instances: Ref<T[]>
  activeTabId: Ref<string | null>
  activeInstance: ComputedRef<T | null>
  createTab: () => T
  switchTab: (id: string) => void
  closeTab: (id: string) => void
  restoring: Ref<boolean>
  saveSession: () => void
  handleRouteIntent: (gsPath: string) => Promise<void>
}

export function useEditorTabs<T extends { id: string }>(
  options: UseEditorTabsOptions<T>,
): UseEditorTabsReturn<T> {
  const instances = ref<T[]>([]) as Ref<T[]>
  const activeTabId = ref<string | null>(null)
  const restoring = ref(false)
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
    saveSession()
    return inst
  }

  function switchTab(id: string) {
    activeTabId.value = id
    saveSession()
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
    saveSession()
  }

  function saveSession() {
    if (!options.persist) return
    const descriptors = instances.value
      .map(inst => options.persist!.serialize(inst))
      .filter(d => d !== null)
    const activeInst = instances.value.find(i => i.id === activeTabId.value)
    const activeId = activeInst ? options.persist!.getIdentifier(activeInst) : null
    sessionStorage.setItem(options.persist!.key, JSON.stringify({ tabs: descriptors, activeId }))
  }

  async function _init(): Promise<void> {
    if (!options.persist) {
      if (options.autoEmptyTab && instances.value.length === 0) createTab()
      return
    }
    if (instances.value.length > 0) return

    restoring.value = true
    try {
      const raw = sessionStorage.getItem(options.persist.key)
      if (raw) {
        let data: { tabs: unknown[]; activeId: string | null }
        try {
          data = JSON.parse(raw)
        } catch {
          sessionStorage.removeItem(options.persist.key)
          return
        }

        for (const desc of data.tabs) {
          try {
            const inst = await options.persist.restore(desc as any)
            instances.value.push(inst)
          } catch { /* restore failed, skip */ }
        }

        if (data.activeId && instances.value.length > 0) {
          const target = instances.value.find(
            inst => options.persist!.getIdentifier(inst) === data.activeId
          )
          activeTabId.value = target ? target.id : instances.value[0].id
        } else if (instances.value.length > 0) {
          activeTabId.value = instances.value[0].id
        }
      }
    } finally {
      restoring.value = false
      if (options.autoEmptyTab && instances.value.length === 0) {
        createTab()
      }
      saveSession()
    }
  }

  async function handleRouteIntent(gsPath: string): Promise<void> {
    if (!options.persist) return
    const existing = instances.value.find(
      inst => options.persist!.getIdentifier(inst) === gsPath
    )
    if (existing) {
      activeTabId.value = existing.id
    } else {
      const desc = options.persist!.descriptorFromGsPath(gsPath)
      const inst = await options.persist!.restore(desc)
      instances.value.push(inst)
      activeTabId.value = inst.id
    }
    saveSession()
  }

  _init()

  return { instances, activeTabId, activeInstance, createTab, switchTab, closeTab, restoring, saveSession, handleRouteIntent }
}
