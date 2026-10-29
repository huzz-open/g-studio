import { computed } from 'vue'
import type { Provider } from '../../../packages/generation-protocol/types'
import { translate } from '../i18n'
import { canGenerateModels, generationConnection, modelProviders, providerIsEnabled } from './connection'
import { generationSettings } from './settings'

export const selectedModelProvider = computed(() => modelProviders.value.find(p => p.providerId === generationSettings.providerId))

export function connectionFailureMessage(error: unknown) {
  const message = String(error)
  if (/Failed to fetch|NetworkError|fetch failed|Load failed|TimeoutError|AbortError|aborted|OFFLINE|ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(message)) return translate('generation.connectionFailedHint')
  if (/401|Access token|UNAUTHORIZED/i.test(message)) return translate('generation.credentialsInvalid')
  if (/Invalid URL|Invalid service URL/i.test(message)) return translate('generation.invalidAddress')
  if (/Public services require HTTPS/i.test(message)) return translate('generation.httpsRequired')
  return translate('generation.connectionFailedHint')
}

export function modelPreparationError(error: string) {
  if (error.startsWith('Insufficient startup capacity even for staged inference')) {
    return translate('generation.insufficientCapacity')
  }
  return error
}

function providerReason(provider: Provider | undefined) {
  if (!provider) return translate('generation.modelUnavailable')
  if (provider.error) return modelPreparationError(provider.error)
  const key = 'generation.providerState.' + provider.state
  const state = translate(key)
  return state === key ? translate('generation.modelUnavailable') : state
}

/** API reachability and model readiness are independent, including for old services. */
export const generationReadinessMessage = computed(() => {
  if (!generationConnection.connected) return generationConnection.error
    ? connectionFailureMessage(generationConnection.error) : translate('generation.openingSettings')
  if (!modelProviders.value.some(providerIsEnabled)) return translate('generation.noEnabledModels')
  if (selectedModelProvider.value && !providerIsEnabled(selectedModelProvider.value)) return translate('generation.selectEnabledModel')
  if (!canGenerateModels.value) return translate('generation.connectedModelUnavailable', {
    reason: providerReason(selectedModelProvider.value),
  })
  const provider = selectedModelProvider.value
  return translate(provider?.state === 'ready' ? 'generation.connectedReady' : 'generation.connectedQueueReady')
})

/** One user-facing service result for the badge, generation entry and manual test. */
export const generationServiceStatus = computed(() => {
  const provider = selectedModelProvider.value
  const preparing = provider && ['preparing', 'loading', 'warming'].includes(provider.state)
  const state = generationConnection.checking ? 'checking'
    : !generationConnection.connected ? (generationConnection.error ? 'failed' : 'idle')
    : !modelProviders.value.some(providerIsEnabled) || (provider && !providerIsEnabled(provider)) ? 'disabled'
    : provider?.state === 'failed' || provider?.error ? 'failed'
    : preparing ? 'preparing'
    : canGenerateModels.value ? 'connected' : 'failed'
  const label = translate(state === 'checking' ? 'common.loading'
    : state === 'disabled' ? 'generation.providerState.disabled'
    : state === 'connected' ? 'generation.providerState.ready'
    : state === 'preparing' ? 'generation.providerState.' + provider!.state
    : 'generation.providerState.failed')
  const type = state === 'connected' ? 'success' : state === 'failed' ? 'error' : 'info'
  return { state, label, type, detail: generationReadinessMessage.value } as const
})
