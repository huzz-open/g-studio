import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GenerationClient } from '../src/shared/generation/client.ts'
import type { Capabilities } from '../packages/generation-protocol/types.ts'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: () => JSON.stringify({ mode: 'silhouette', providerId: 'silhouette', baseUrl: 'http://127.0.0.1:8765', token: 'test-token' }),
  setItem: () => {},
} })
const { generationSettings: settings } = await import('../src/shared/generation/settings.ts')
const { generationConnection: state, canGenerateModels, checkGenerationConnection, modelProviders } = await import('../src/shared/generation/connection.ts')
const capabilities = (state: 'ready' | 'preparing' = 'ready') => ({ providers: [
  { providerId: 'silhouette', name: 'Silhouette', state: 'ready', parameters: {} },
  { providerId: 'hunyuan-mini', name: 'Hunyuan', state, parameters: {} },
] }) as Capabilities

test('old silhouette settings migrate to a real service and model', () => {
  assert.equal(settings.mode, 'direct')
  assert.equal(settings.providerId, 'hunyuan-mini')
})

test('only a ready model unlocks generation, and connection edits immediately invalidate it', async t => {
  let caps = capabilities('preparing')
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => caps)
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'gpu', backend: 'cuda' }))
  assert.equal(await checkGenerationConnection(), false)
  assert.equal(state.connected, true)
  assert.equal(canGenerateModels.value, false)
  caps = capabilities()
  assert.equal(await checkGenerationConnection(), true)
  assert.deepEqual(modelProviders.value.map(p => p.providerId), ['hunyuan-mini'])
  settings.token = 'changed-token'
  assert.equal(canGenerateModels.value, false)
  assert.equal(state.connected, false)
})

test('a response to old credentials cannot restore the connection badge', async t => {
  let finish!: (value: Capabilities) => void
  t.mock.method(GenerationClient.prototype, 'capabilities', () => new Promise(resolve => { finish = resolve }))
  const request = checkGenerationConnection()
  settings.baseUrl = 'http://127.0.0.1:9876'
  finish(capabilities())
  assert.equal(await request, false)
  assert.equal(state.connected, false)
  assert.equal(canGenerateModels.value, false)
})

test('an unconfigured API is idle and makes no requests, including background polling', async t => {
  settings.baseUrl = '  '
  const request = t.mock.method(GenerationClient.prototype, 'capabilities', async () => capabilities())
  assert.equal(await checkGenerationConnection({ background: true }), false)
  assert.equal(await checkGenerationConnection(), false)
  assert.equal(request.mock.callCount(), 0)
  assert.equal(settings.baseUrl, '  ')
  assert.equal(state.checking, false)
  assert.equal(state.error, '')
})

test('repeated checks of a configured API share one request', async t => {
  settings.baseUrl = 'http://127.0.0.1:8765'
  let finish!: (value: Capabilities) => void
  let calls=0
  t.mock.method(GenerationClient.prototype,'capabilities',function(this: GenerationClient) {
    calls++
    assert.equal(this.config.baseUrl,'http://127.0.0.1:8765')
    return new Promise(resolve=>{finish=resolve})
  })
  t.mock.method(GenerationClient.prototype,'info',async()=>({deviceType:'cpu'}))
  const background = checkGenerationConnection({background:true})
  assert.equal(state.checking,false)
  const manual = checkGenerationConnection()
  assert.equal(state.checking,true)
  finish(capabilities())
  assert.equal(await background,true)
  assert.equal(await manual,true)
  assert.equal(calls,1)
  assert.equal(state.checking,false)
})

test('background polling leaves the failure badge stable until a response arrives', async t => {
  state.error='Service offline'
  state.connected=false
  let reject!: (reason: Error) => void
  t.mock.method(GenerationClient.prototype,'capabilities',()=>new Promise((_,fail)=>{reject=fail}))
  const request=checkGenerationConnection({background:true})
  assert.equal(state.checking,false)
  assert.equal(state.error,'Service offline')
  reject(Error('Still offline'))
  assert.equal(await request,false)
  assert.equal(state.checking,false)
  assert.match(state.error,/Still offline/)
})

test('task snapshots record provider defaults and keep input preferences independent', async () => {
  const { snapshotGenerationConnection } = await import('../src/shared/generation/request-snapshot.ts')
  const caps = capabilities()
  caps.providers[1]!.parameters = {
    steps: { min: 1, max: 10, default: 5, integer: true },
    resolution: { min: 64, max: 384, default: 256, integer: true },
  }
  state.capabilities = caps
  settings.seed = 42
  settings.parametersByProvider = { 'hunyuan-mini': { steps: 7 } }
  const before = JSON.stringify(settings)
  const snapshot = snapshotGenerationConnection()
  assert.deepEqual(snapshot.parametersByProvider['hunyuan-mini'], { steps: 7, resolution: 256 })
  assert.equal(JSON.stringify(settings), before)
  settings.seed = 99
  settings.parametersByProvider['hunyuan-mini']!.steps = 9
  assert.equal(snapshot.seed, 42)
  assert.equal(snapshot.parametersByProvider['hunyuan-mini']!.steps, 7)
  snapshot.parametersByProvider['hunyuan-mini']!.resolution = 128
  assert.equal(settings.parametersByProvider['hunyuan-mini']!.resolution, undefined)
})


test('new loading services accept queued requests while old preparing services remain disabled', async t => {
  settings.baseUrl = 'http://127.0.0.1:8765'; settings.token = 'queue-test';
  let caps = capabilities('preparing'); caps.providers[1]!.acceptsJobs = true;
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => caps);
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'gpu' }));
  assert.equal(await checkGenerationConnection(), true);
  caps = {...caps,providers:caps.providers.map(p => ({...p,acceptsJobs:false}))};
  assert.equal(await checkGenerationConnection(), false);
});
