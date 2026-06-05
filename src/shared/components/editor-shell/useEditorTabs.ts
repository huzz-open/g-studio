import { ref, shallowRef, computed, type Ref, type ShallowRef, type ComputedRef } from 'vue'

export interface TabPersistConfig<T extends { id: string }> {
  key: string
  serialize: (instance: T) => { gsPath: string } | null
  restore: (descriptor: { gsPath: string }) => Promise<T>
  getIdentifier: (instance: T) => string | null
}

export interface UseEditorTabsOptions<T extends { id: string }> {
  prefix: string
  factory: (id: string) => T
  destroy?: (id: string) => void
  persist?: TabPersistConfig<T>
  autoEmptyTab?: boolean
}

export interface UseEditorTabsReturn<T extends { id: string }> {
  instances: ShallowRef<T[]>
  activeTabId: Ref<string | null>
  activeInstance: ComputedRef<T | null>
  createTab: () => T
  switchTab: (id: string) => void
  closeTab: (id: string) => void
  restoring: Ref<boolean>
  ready: Promise<void>
  saveSession: () => void
  handleRouteIntent: (gsPath: string) => Promise<void>
}

export function useEditorTabs<T extends { id: string }>(
  options: UseEditorTabsOptions<T>,
): UseEditorTabsReturn<T> {
  const instances = shallowRef<T[]>([])
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
    instances.value = [...instances.value, inst]
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
    const arr = [...instances.value]
    arr.splice(idx, 1)
    instances.value = arr
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
        let data: { tabs: Array<{ gsPath: string }>; activeId: string | null }
        try {
          data = JSON.parse(raw)
        } catch {
          sessionStorage.removeItem(options.persist.key)
          return
        }

        const restored: T[] = []
        for (const desc of data.tabs) {
          if (!desc || !desc.gsPath) continue
          try {
            const inst = await options.persist.restore(desc)
            restored.push(inst)
          } catch { /* restore failed for this tab, skip */ }
        }
        if (restored.length > 0) {
          instances.value = restored
        }

        if (data.activeId && instances.value.length > 0) {
          const target = instances.value.find(
            inst => options.persist!.getIdentifier(inst) === data.activeId,
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
    if (!options.persist) {
      throw new Error(`[useEditorTabs:${options.prefix}] persist config required for handleRouteIntent`)
    }
    await ready
    const existing = instances.value.find(
      inst => options.persist!.getIdentifier(inst) === gsPath,
    )
    if (existing) {
      activeTabId.value = existing.id
    } else {
      const inst = await options.persist!.restore({ gsPath })
      instances.value = [...instances.value, inst]
      activeTabId.value = inst.id
    }
    saveSession()
  }

  const ready = _init()

  return { instances, activeTabId, activeInstance, createTab, switchTab, closeTab, restoring, ready, saveSession, handleRouteIntent }
}
