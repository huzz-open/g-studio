import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

export function useRouteResource(loadFn: (resourceId: string) => void) {
  const route = useRoute()

  const hasRouteResource = computed(() => !!route.query.resource)

  onMounted(() => {
    const id = route.query.resource
    if (id && typeof id === 'string') loadFn(id)
  })

  watch(() => route.query.resource, (newId) => {
    if (newId && typeof newId === 'string') loadFn(newId)
  })

  return { hasRouteResource }
}
