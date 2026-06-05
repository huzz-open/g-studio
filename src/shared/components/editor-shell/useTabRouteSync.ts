import { onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getWorkspaceHandle } from '../../workspace'

interface TabsWithRouteSync {
  handleRouteIntent: (gsPath: string) => Promise<void>
  saveSession: () => void
}

export function useTabRouteSync(tabs: TabsWithRouteSync) {
  const route = useRoute()
  const router = useRouter()

  onMounted(async () => {
    const gsPath = route.query.gs as string | undefined
    if (gsPath && getWorkspaceHandle()) {
      await tabs.handleRouteIntent(gsPath)
      router.replace({ query: {} })
    }
  })

  onUnmounted(() => {
    tabs.saveSession()
  })
}
