import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope } from 'vue'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} })
const { generationSettings } = await import('../src/shared/generation/settings.ts')
const { generationParametersFor, modelParametersFor } = await import('../src/shared/generation/parameters.ts')
const { snapshotGenerationConnection } = await import('../src/shared/generation/request-snapshot.ts')
const { generationConnection } = await import('../src/shared/generation/connection.ts')

test('saved million-face preferences survive reload and new requests use advertised 128 default', () => {
  storage.set('g-studio-generation-parameters-v1:large-model', JSON.stringify({
    targetFaces: 1_000_000, seed: 77, parametersByProvider: {},
  }))
  const parameters = generationParametersFor('large-model')
  assert.equal(parameters.targetFaces, 1_000_000)
  const previous = generationConnection.capabilities
  generationConnection.capabilities = { protocolVersion: 1, providers: [{
    providerId: 'hunyuan-mini', name: 'Mini', parameters: {
      resolution: { min: 128, max: 512, default: 128, integer: true },
    },
  }], targetFaces: { min: 1000, max: 1_000_000, default: 40000 },
  limits: { inputBytes: 100, inputDimension: 100, outputBytes: 100, concurrency: 1, queue: 1 } }
  try {
    assert.equal(snapshotGenerationConnection(parameters).parametersByProvider['hunyuan-mini']!.resolution, 128)
  } finally {
    generationConnection.capabilities = previous
  }
})

test('part edits are isolated from other sources, global defaults and submitted snapshots', () => {
  generationSettings.parametersByProvider = { 'hunyuan-mini': { steps: 5, resolution: 256 } }
  const chair = generationParametersFor('chair'), barrel = generationParametersFor('barrel')
  chair.targetFaces = 24000; chair.seed = 77
  chair.parametersByProvider['hunyuan-mini']!.steps = 10
  chair.parametersByProvider['hunyuan-mini']!.resolution = 128
  assert.equal(barrel.targetFaces, 40000)
  assert.equal(barrel.seed, 12345)
  assert.deepEqual(barrel.parametersByProvider['hunyuan-mini'], { steps: 5, resolution: 256 })
  assert.equal(generationSettings.targetFaces, 40000)
  assert.equal(generationSettings.seed, 12345)
  assert.equal(generationSettings.parametersByProvider['hunyuan-mini']!.steps, 5)
  const submitted = snapshotGenerationConnection(chair)
  assert.equal(submitted.targetFaces, 24000)
  assert.equal(submitted.seed, 77)
  assert.equal(submitted.parametersByProvider['hunyuan-mini']!.steps, 10)
  chair.seed = 88; chair.parametersByProvider['hunyuan-mini']!.steps = 7
  assert.equal(submitted.seed, 77)
  assert.equal(submitted.parametersByProvider['hunyuan-mini']!.steps, 10)
  assert.equal(generationParametersFor('chair'), chair)
  assert.equal(generationParametersFor('new-image').seed, 12345)
})

test('draft persistence survives the panel effect scope, and stores no credentials', () => {
  const scope = effectScope()
  const draft = scope.run(() => generationParametersFor('reopened'))!
  draft.seed = 101
  scope.stop()
  generationParametersFor('reopened').seed = 202
  const saved = JSON.parse(storage.get('g-studio-generation-parameters-v1:reopened')!)
  assert.equal(saved.seed, 202)
  assert.deepEqual(Object.keys(saved).sort(), ['optimizeModel', 'parametersByProvider', 'seed', 'targetFaces'])
  storage.set('g-studio-generation-parameters-v1:restored', JSON.stringify(saved))
  assert.equal(generationParametersFor('restored').seed, 202)
})

test('global default changes seed only new drafts and malformed storage falls back safely', () => {
  generationSettings.seed = 303
  assert.equal(generationParametersFor('reopened').seed, 202)
  assert.equal(generationParametersFor('fresh').seed, 303)
  storage.set('g-studio-generation-parameters-v1:broken', '{')
  storage.set('g-studio-generation-parameters-v1:invalid', JSON.stringify({ targetFaces: -1, seed: 2, parametersByProvider: {} }))
  assert.equal(generationParametersFor('broken').seed, 303)
  assert.equal(generationParametersFor('invalid').targetFaces, 40000)
})

test('provider defaults are filled in the snapshot without leaking global overrides', () => {
  generationConnection.capabilities = { providers: [{ providerId: 'hunyuan-mini', state: 'ready', parameters: {
    steps: { min: 1, max: 10, default: 5 }, resolution: { min: 64, max: 384, default: 256 },
  } }] } as any
  const draft = generationParametersFor('provider-defaults')
  draft.parametersByProvider = { 'hunyuan-mini': { steps: 9 } }
  generationSettings.parametersByProvider['hunyuan-mini']!.resolution = 384
  const snapshot = snapshotGenerationConnection(draft)
  assert.deepEqual(snapshot.parametersByProvider['hunyuan-mini'], { steps: 9, resolution: 256 })
  assert.deepEqual(draft.parametersByProvider['hunyuan-mini'], { steps: 9 })
})

test('custom initial values remain independent inputs without becoming reset baselines', () => {
  generationSettings.targetFaces = 24000; generationSettings.seed = 87844
  generationSettings.parametersByProvider = { 'hunyuan-mini': { steps: 10, resolution: 256 } }
  const draft = generationParametersFor('custom-initial')
  assert.equal(draft.targetFaces, 24000)
  assert.equal(draft.seed, 87844)
  assert.equal(draft.parametersByProvider['hunyuan-mini']!.steps, 10)
  assert.equal('baseline' in draft, false)
  draft.targetFaces = 18000; draft.seed = 42
  draft.parametersByProvider['hunyuan-mini']!.steps = 7
  generationSettings.targetFaces = 12000; generationSettings.seed = 12345
  generationSettings.parametersByProvider['hunyuan-mini']!.steps = 5
  storage.set('g-studio-generation-parameters-v1:custom-restored', storage.get('g-studio-generation-parameters-v1:custom-initial')!)
  const restored = generationParametersFor('custom-restored')
  assert.equal(restored.targetFaces, 18000)
  assert.equal(restored.seed, 42)
  assert.equal(restored.parametersByProvider['hunyuan-mini']!.steps, 7)
  assert.equal('baseline' in restored, false)
  assert.equal('baseline' in snapshotGenerationConnection(restored), false)
})

test('legacy drafts discard only obsolete baselines while preserving all saved inputs', () => {
  const inputs = { optimizeModel:true, targetFaces: 16000, seed: 99, parametersByProvider: { 'hunyuan-mini': { steps: 9, resolution: 128 } } }
  storage.set('g-studio-generation-parameters-v1:legacy', JSON.stringify({ ...inputs, baseline: { targetFaces: 24000, seed: 87844, parametersByProvider: {} } }))
  const draft = generationParametersFor('legacy')
  assert.equal(draft.targetFaces, 16000)
  assert.equal(draft.seed, 99)
  assert.deepEqual(draft, inputs)
  assert.deepEqual(JSON.parse(storage.get('g-studio-generation-parameters-v1:legacy')!), inputs)
})

test('model request values seed editable inputs without rewriting the job or defining a baseline', () => {
  const job = { localId: 'model-reset-fixture', modelId: 'reset-model', request: {
    providerId: 'hunyuan-mini', targetFaces: 24000, seed: 87844, parameters: { steps: 10, resolution: 256 },
  }, connection: { targetFaces: 12000, seed: 12345 } } as any
  const before = JSON.stringify(job)
  const draft = modelParametersFor(job)
  assert.equal(draft.targetFaces, 24000)
  assert.equal('baseline' in draft, false)
  draft.targetFaces = 12000; draft.seed = 12345; draft.parametersByProvider['hunyuan-mini']!.steps = 5
  assert.equal(JSON.stringify(job), before)
})

test('generation optimization defaults on and is captured independently for each submitted job',()=>{
 const params=generationParametersFor('optimization-step')
 assert.equal(params.optimizeModel,true)
 params.optimizeModel=false
 const submitted=snapshotGenerationConnection(params)
 params.optimizeModel=true
 assert.equal(submitted.optimizeModel,false)
 assert.equal(snapshotGenerationConnection(params).optimizeModel,true)
})
