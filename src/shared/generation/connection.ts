import { computed, reactive, watch } from 'vue'
import type { Capabilities } from '../../../packages/generation-protocol/types'
import { GenerationClient } from './client'
import { generationSettings, snapshotConnection, useDevelopmentConnection } from './settings'

export const generationConnection = reactive({
  connected: false, checking: false, error: '', device: '',
  capabilities: undefined as Capabilities | undefined,
})
export const modelProviders = computed(() => generationConnection.capabilities?.providers.filter(p => p.providerId !== 'silhouette') ?? [])
export const canGenerateModels = computed(() => generationConnection.connected && modelProviders.value.some(p => p.providerId === generationSettings.providerId && p.state === 'ready'))
let epoch = 0
let pending: { key: string; controller: AbortController; promise: Promise<boolean> } | undefined
let developmentLookup: Promise<boolean> | undefined
const connectionKey = () => JSON.stringify([generationSettings.mode, generationSettings.baseUrl, generationSettings.token, generationSettings.relayUrl, generationSettings.relayToken, generationSettings.deviceId, generationSettings.providerId])
watch(connectionKey, () => {
  epoch++
  pending?.controller.abort()
  pending = undefined
  Object.assign(generationConnection, { connected: false, checking: false, capabilities: undefined, device: '', error: '' })
}, { flush: 'sync' })

/** Polls preserve the last badge; only a user-triggered test shows a spinner. */
export async function checkGenerationConnection({ background = false } = {}) {
  // A fresh browser has no API configured. Polling must not probe localhost or
  // read development credentials until the user explicitly supplies an address.
  if (!generationSettings.baseUrl.trim()) return false
  if (generationSettings.mode === 'direct' && !generationSettings.token && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(generationSettings.baseUrl)) {
    developmentLookup ??= useDevelopmentConnection().catch(() => false).finally(() => { developmentLookup = undefined })
    await developmentLookup
  }
  const key = connectionKey()
  if (pending?.key === key) {
    if (!background) generationConnection.checking = true
    return pending.promise
  }
  const controller = new AbortController()
  const record = { key, controller, promise: Promise.resolve(false) }
  pending = record
  let request = ++epoch
  if (!background) generationConnection.checking = true
  const timer = setTimeout(() => controller.abort(), 5000)
  record.promise = (async () => {
    try {
      const caps = await new GenerationClient(snapshotConnection()).capabilities(controller.signal)
      if (request !== epoch) return false
      const models = caps.providers.filter(p => p.providerId !== 'silhouette')
      if (!models.some(p => p.providerId === generationSettings.providerId) && models.length) {
        generationSettings.providerId = (models.find(p => p.state === 'ready') || models[0]!).providerId
        request = ++epoch
      }
      Object.assign(generationConnection, { capabilities: caps, connected: true, error: '', checking: false })
      // Device diagnostics must not delay the connection result or its feedback.
      void new GenerationClient(snapshotConnection()).info(AbortSignal.timeout(5000)).then(info => {
        if (request === epoch) generationConnection.device = info.backend === 'cuda' ? 'GPU · NVIDIA CUDA' : info.backend === 'mps' ? 'GPU · Apple MPS' : info.deviceType.toUpperCase()
      }).catch(() => { if (request === epoch) generationConnection.device = '' })
      return canGenerateModels.value
    } catch (error) {
      if (request === epoch) Object.assign(generationConnection, { connected: false, capabilities: undefined, device: '', error: String(error), checking: false })
      return false
    } finally {
      clearTimeout(timer)
      if (pending === record) pending = undefined
      if (request === epoch) generationConnection.checking = false
    }
  })()
  return record.promise
}
