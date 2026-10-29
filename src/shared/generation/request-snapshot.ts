import { modelProviders } from './connection'
import { snapshotConnection } from './settings'
import { copyGenerationParameters, type GenerationParameters } from './parameters'

/** Record effective defaults without writing them back into the user's inputs. */
export function snapshotGenerationConnection(parameters?: GenerationParameters) {
  const connection = snapshotConnection()
  if (parameters) Object.assign(connection, copyGenerationParameters(parameters))
  const provider = modelProviders.value.find(provider => provider.providerId === connection.providerId)
  const ranges = provider?.parameters ?? {}
  connection.parametersByProvider[connection.providerId] = {
    ...Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key, range.default])),
    ...connection.parametersByProvider[connection.providerId],
  }
  return { ...connection, providerName: provider?.name ?? connection.providerId }
}

export type GenerationRequestSnapshot = ReturnType<typeof snapshotGenerationConnection>
