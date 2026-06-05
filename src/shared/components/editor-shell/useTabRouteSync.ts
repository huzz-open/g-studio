import { onMounted, onUnmounted, watch, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkspace } from '../../workspace'

interface TabsWithRouteSync {
  handleRouteIntent: (gsPath: string) => Promise<void>
  saveSession: () => void
  ready: Promise<void>
  activeGsPath: ComputedRef<string | null>
  loadPendingTabs?: () => Promise<void>
}

export function useTabRouteSync(tabs: TabsWithRouteSync) {
  const route = useRoute()
  const router = useRouter()
  const { isOpen: wsOpen } = useWorkspace()

  onMounted(async () => {
    await tabs.ready
    const gsPath = route.query.gs as string | undefined
    if (gsPath && wsOpen.value) {
      await tabs.handleRouteIntent(gsPath)
    }
    if (wsOpen.value && tabs.loadPendingTabs) {
      await tabs.loadPendingTabs()
    }
  })

  watch(tabs.activeGsPath, (gsPath) => {
    const current = route.query.gs as string | undefined
    if (gsPath && gsPath !== current) {
      router.replace({ query: { ...route.query, gs: gsPath } })
    } else if (!gsPath && current) {
      const { gs: _, ...rest } = route.query
      router.replace({ query: rest })
    }
  })

  if (tabs.loadPendingTabs) {
    const stopWatch = watch(wsOpen, async (open) => {
      if (open) {
        await tabs.ready
        await tabs.loadPendingTabs!()
        stopWatch()
      }
    })
  }

  onUnmounted(() => {
    tabs.saveSession()
  })
}
