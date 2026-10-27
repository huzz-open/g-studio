import { effectScope, reactive, watch } from 'vue'
import { generationSettings, type GenerationConnection } from './settings'
import type { LocalJob } from './jobs'

export type GenerationParameters = Pick<GenerationConnection, 'targetFaces' | 'seed' | 'parametersByProvider'>

/** Copy only generation inputs, never service addresses or credentials. */
export function copyGenerationParameters(value: GenerationParameters = generationSettings): GenerationParameters {
  return { targetFaces: value.targetFaces, seed: value.seed, parametersByProvider: JSON.parse(JSON.stringify(value.parametersByProvider)) }
}

const drafts = new Map<string, GenerationParameters>()
const storagePrefix = 'g-studio-generation-parameters-v1:'

function valid(value: unknown): value is GenerationParameters {
  const v = value as GenerationParameters | null
  return !!v && Number.isInteger(v.targetFaces) && v.targetFaces >= 1000 && v.targetFaces <= 40000
    && Number.isInteger(v.seed) && v.seed >= 0 && v.seed <= 2147483647
    && !!v.parametersByProvider && typeof v.parametersByProvider === 'object' && !Array.isArray(v.parametersByProvider)
    && Object.values(v.parametersByProvider).every(parameters => parameters && typeof parameters === 'object'
      && !Array.isArray(parameters) && Object.values(parameters).every(Number.isFinite))
}

/** One independent draft per source asset, retained across panels and reloads. */
export function generationParametersFor(sourceId: string, seed?: GenerationParameters): GenerationParameters {
  const existing = drafts.get(sourceId)
  if (existing) return existing
  const key = storagePrefix + sourceId
  let initial = copyGenerationParameters(seed)
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (valid(saved)) {
      // Keep saved inputs, but discard the obsolete per-source reset baseline.
      initial = copyGenerationParameters(saved)
    }
  } catch { /* An unreadable draft starts from the global defaults. */ }
  const draft = reactive(initial)
  drafts.set(sourceId, draft)
  // Drafts outlive the panel that first opened them, including its effect scope.
  effectScope(true).run(() => watch(draft, () => {
    try { localStorage.setItem(key, JSON.stringify(draft)) } catch { /* Keep the current session usable if storage is full. */ }
  }, { deep: true, flush: 'sync', immediate: true }))
  return draft
}

export function modelParametersFor(job: LocalJob): GenerationParameters {
  return generationParametersFor('model:' + (job.modelId || job.localId), {
    targetFaces:job.request.targetFaces ?? job.connection.targetFaces, seed:job.request.seed ?? job.connection.seed,
    parametersByProvider:{ [job.request.providerId]:{ ...job.request.parameters } },
  })
}
