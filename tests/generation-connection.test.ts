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
  settings.token = 'test-token'
  let finish!: (value: Capabilities) => void
  let calls=0
  t.mock.method(GenerationClient.prototype,'capabilities',function(this: GenerationClient) {
    calls++
    assert.equal(this.config.baseUrl,'http://127.0.0.1:8765')
    return new Promise(resolve=>{finish=resolve})
  })
  t.mock.method(GenerationClient.prototype,'info',async()=>({deviceType:'cpu'}))
  const manual = checkGenerationConnection()
  assert.equal(state.checking,true)
  const background = checkGenerationConnection({background:true})
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
  assert.equal(snapshot.providerName, 'Hunyuan')
  assert.deepEqual(snapshot.parametersByProvider['hunyuan-mini'], { steps: 7, resolution: 256 })
  assert.equal(JSON.stringify(settings), before)
  settings.seed = 99
  settings.parametersByProvider['hunyuan-mini']!.steps = 9
  assert.equal(snapshot.seed, 42)
  state.capabilities!.providers[1]!.name = 'Changed service name'
  assert.equal(snapshot.providerName, 'Hunyuan', 'the submitted name does not follow current service metadata')
  assert.equal(JSON.parse(JSON.stringify(snapshot)).providerName, 'Hunyuan')
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

test('connected but failed models show the real failure at the generation entry', async t => {
  const { locale } = await import('../src/shared/i18n/index.ts')
  locale.value = 'zh-CN'
  const { generationReadinessMessage, modelPreparationError } = await import('../src/shared/generation/readiness.ts')
  const { registerToast } = await import('../src/shared/components/toast.ts')
  const { needsGenerationSetup, settingsDialog } = await import('../src/shared/settings-dialog.ts')
  settings.providerId = 'hunyuan-mini'
  const caps = capabilities()
  caps.providers[1]!.state = 'failed'
  caps.providers[1]!.acceptsJobs = false
  caps.providers[1]!.error = 'Insufficient startup capacity even for staged inference; free memory or explicitly configure a smaller enabled set/precision and restart.'
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => caps)
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'gpu', backend: 'cuda' }))
  assert.equal(await checkGenerationConnection(), false)
  assert.equal(state.connected, true)
  assert.match(generationReadinessMessage.value, /服务连接成功.*内存或显存不足/)
  assert.match(generationReadinessMessage.value, /重启生成服务/)
  assert.doesNotMatch(generationReadinessMessage.value, /配置并测试连接/)
  let notice = ''
  registerToast({ show: message => { notice = message; return 1 }, dismiss: () => {} })
  assert.equal(needsGenerationSetup('/model-generation'), true)
  assert.equal(settingsDialog.category, 'generation.connection')
  assert.equal(notice, generationReadinessMessage.value)
  assert.equal(modelPreparationError('Missing checkpoint: mini'), 'Missing checkpoint: mini')

  locale.value = 'en-US'
  assert.match(generationReadinessMessage.value, /Service connected.*Available RAM or GPU memory/)
  locale.value = 'zh-CN'
})

test('readiness feedback distinguishes loading, ready, disabled, missing and disconnected models', async () => {
  const { generationReadinessMessage } = await import('../src/shared/generation/readiness.ts')
  state.connected = true
  const caps = capabilities('preparing')
  state.capabilities = caps
  assert.match(generationReadinessMessage.value, /服务连接成功.*准备模型中/)
  state.capabilities!.providers[1]!.acceptsJobs = true
  assert.equal(canGenerateModels.value, true)
  assert.match(generationReadinessMessage.value, /可提交任务排队/)
  state.capabilities!.providers[1]!.state = 'warming'
  assert.match(generationReadinessMessage.value, /Hunyuan.*预热中.*可提交任务排队/)
  state.capabilities!.providers[1]!.state = 'ready'
  assert.match(generationReadinessMessage.value, /当前模型可生成/)
  state.capabilities!.providers[1]!.state = 'disabled'
  state.capabilities!.providers[1]!.acceptsJobs = false
  assert.match(generationReadinessMessage.value, /未启用/)
  state.capabilities!.providers = []
  assert.match(generationReadinessMessage.value, /未启用任何模型/)
  state.connected = false
  assert.match(generationReadinessMessage.value, /配置并测试连接/)
})

test('generation entry, service badge and test agree when API is reachable but model failed', async t => {
  const { registerToast } = await import('../src/shared/components/toast.ts')
  const { clearGenerationFeedback, showConnectionTestFeedback } = await import('../src/shared/generation/feedback.ts')
  const { needsGenerationSetup } = await import('../src/shared/settings-dialog.ts')
  const { generationServiceStatus } = await import('../src/shared/generation/readiness.ts')
  clearGenerationFeedback()
  const active = new Map<number, { message: string; type?: string }>()
  let next = 0
  registerToast({
    show: (message, type) => { const id = ++next; active.set(id, { message, type }); return id },
    dismiss: id => { active.delete(id) },
  })
  const caps = capabilities()
  Object.assign(caps.providers[1]!, { state: 'failed', acceptsJobs: false, error: 'Model load failed' })
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => caps)
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'gpu' }))
  await checkGenerationConnection()
  assert.equal(state.connected, true)
  assert.equal(canGenerateModels.value, false)
  assert.equal(needsGenerationSetup('/model-generation'), true)
  assert.equal([...active.values()][0]!.type, 'error')
  const entryFeedback = [...active.values()][0]!
  assert.equal(generationServiceStatus.value.state, 'failed')
  assert.equal(generationServiceStatus.value.label, '失败')
  showConnectionTestFeedback()
  assert.deepEqual([...active.values()], [entryFeedback])
  assert.equal(entryFeedback.message, generationServiceStatus.value.detail)
  showConnectionTestFeedback()
  assert.equal(active.size, 1)
  assert.equal(state.capabilities!.providers[1]!.state, 'failed')
  for (const acceptsJobs of [false, true]) {
    Object.assign(state.capabilities!.providers[1]!, { state: 'loading', error: null, acceptsJobs })
    showConnectionTestFeedback()
    assert.equal(generationServiceStatus.value.state, 'preparing')
    assert.equal([...active.values()][0]!.type, 'info')
  }
  Object.assign(state.capabilities!.providers[1]!, { state: 'ready', acceptsJobs: true })
  showConnectionTestFeedback()
  assert.equal(generationServiceStatus.value.label, '可生成')
  assert.equal([...active.values()][0]!.type, 'success')
  assert.match([...active.values()][0]!.message, /当前模型可生成/)
  state.connected = false
  state.error = 'Unauthorized'
  showConnectionTestFeedback()
  assert.equal([...active.values()][0]!.type, 'error')
  assert.match([...active.values()][0]!.message, /访问凭证无效/)
  clearGenerationFeedback()
  assert.equal(active.size, 0)
})

test('offline service shows the same actionable message in entry, hover and connection test', async t => {
  const { locale, translate } = await import('../src/shared/i18n/index.ts')
  const { registerToast } = await import('../src/shared/components/toast.ts')
  const { clearGenerationFeedback, showConnectionTestFeedback } = await import('../src/shared/generation/feedback.ts')
  const { generationServiceStatus, generationReadinessMessage, connectionFailureMessage } = await import('../src/shared/generation/readiness.ts')
  const { needsGenerationSetup } = await import('../src/shared/settings-dialog.ts')
  locale.value = 'zh-CN'
  let notice = ''
  registerToast({ show: message => { notice = message; return 1 }, dismiss: () => {} })
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => { throw new TypeError('Failed to fetch') })
  assert.equal(await checkGenerationConnection(), false)
  assert.equal(state.error, 'TypeError: Failed to fetch') // Preserve diagnostics internally.
  const expected = translate('generation.connectionFailedHint')
  assert.equal(generationServiceStatus.value.label, '失败')
  assert.equal(generationServiceStatus.value.detail, expected)
  assert.equal(generationReadinessMessage.value, expected)
  assert.equal(needsGenerationSetup('/model-generation'), true)
  assert.equal(notice, expected)
  showConnectionTestFeedback()
  assert.equal(notice, expected)
  assert.doesNotMatch(notice, /TypeError|Failed to fetch/)
  for (const error of ['NetworkError', 'TypeError: Load failed', 'TimeoutError', 'AbortError', 'ECONNREFUSED']) {
    assert.equal(connectionFailureMessage(error), expected)
  }
  assert.match(connectionFailureMessage('401 Unauthorized'), /访问凭证无效/)
  assert.match(connectionFailureMessage('Invalid service URL'), /API 地址格式不正确/)
  assert.match(connectionFailureMessage('Public services require HTTPS'), /公网 API 需要 HTTPS/)
  locale.value = 'en-US'
  assert.match(generationServiceStatus.value.detail, /Cannot reach the generation service/)
  locale.value = 'zh-CN'
  clearGenerationFeedback()
})

test('disabled saved selection switches to an enabled model and never unlocks jobs itself', async t => {
  const { providerIsEnabled, providerAcceptsJobs } = await import('../src/shared/generation/connection.ts')
  const caps = capabilities()
  caps.providers.push({ providerId: 'hunyuan-turbo', name: 'Turbo', state: 'disabled', acceptsJobs: true, parameters: {} })
  settings.providerId = 'hunyuan-turbo'
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => caps)
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'gpu' }))
  assert.equal(providerIsEnabled(caps.providers[2]!), false)
  assert.equal(providerAcceptsJobs(caps.providers[2]!), false)
  assert.equal(await checkGenerationConnection(), true)
  assert.equal(settings.providerId, 'hunyuan-mini')
  assert.equal(state.connected, true)
})

test('enabled failed selection stays selected instead of silently substituting a working model', async t => {
  const caps = capabilities()
  caps.providers.push({ providerId: 'hunyuan-turbo', name: 'Turbo', state: 'failed', acceptsJobs: false, error: 'OOM', parameters: {} })
  settings.providerId = 'hunyuan-turbo'
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => caps)
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'gpu' }))
  assert.equal(await checkGenerationConnection(), false)
  assert.equal(settings.providerId, 'hunyuan-turbo')
  const { generationServiceStatus } = await import('../src/shared/generation/readiness.ts')
  assert.equal(generationServiceStatus.value.state, 'failed')
  settings.providerId = 'hunyuan-mini'
  assert.equal(state.connected, true, 'choosing a model does not invalidate the API connection')
  assert.equal(canGenerateModels.value, true)
})

test('no enabled models clears the selection and reports a neutral disabled state', async t => {
  const caps = capabilities()
  caps.providers[1]!.state = 'disabled'
  t.mock.method(GenerationClient.prototype, 'capabilities', async () => caps)
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'gpu' }))
  assert.equal(await checkGenerationConnection(), false)
  assert.equal(settings.providerId, '')
  const { generationServiceStatus } = await import('../src/shared/generation/readiness.ts')
  assert.equal(generationServiceStatus.value.state, 'disabled')
  assert.equal(generationServiceStatus.value.type, 'info')
  assert.match(generationServiceStatus.value.detail, /未启用任何模型/)
  caps.providers[1]!.state = 'preparing'
  caps.providers[1]!.acceptsJobs = true
  assert.equal(await checkGenerationConnection(), true)
  assert.equal(settings.providerId, 'hunyuan-mini')
})

test('local addresses never discover credentials or contact an API without a token', async t => {
  settings.baseUrl = 'http://localhost:8765'
  settings.token = ''
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected credential discovery') })
  const request = t.mock.method(GenerationClient.prototype, 'capabilities', async () => capabilities())
  assert.equal(await checkGenerationConnection({ background: true }), false)
  assert.equal(await checkGenerationConnection(), false)
  assert.equal(settings.token, '')
  assert.equal(settings.baseUrl, 'http://localhost:8765')
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(request.mock.callCount(), 0)
})

test('switching APIs clears credentials immediately and polling waits for a manual test', async t => {
  const requests: { url: string; token: string }[] = []
  t.mock.method(GenerationClient.prototype, 'capabilities', async function(this: GenerationClient) {
    requests.push({ url: this.config.baseUrl, token: this.config.token })
    return capabilities()
  })
  t.mock.method(GenerationClient.prototype, 'info', async () => ({ deviceType: 'cpu' }))
  settings.baseUrl = 'http://127.0.0.1:8765'
  settings.token = 'local-token'
  assert.equal(await checkGenerationConnection(), true)
  const original = (await import('../src/shared/generation/settings.ts')).snapshotConnection()
  settings.baseUrl = 'https://other.example/api'
  assert.equal(settings.token, '', 'the old token must be cleared in the same turn')
  assert.equal(state.connected, false)
  assert.equal(await checkGenerationConnection({ background: true }), false)
  settings.token = 'other-token'
  assert.equal(await checkGenerationConnection({ background: true }), false)
  assert.equal(requests.length, 1)
  assert.equal(await checkGenerationConnection(), true)
  assert.equal(await checkGenerationConnection({ background: true }), true)
  assert.deepEqual(requests, [
    { url: 'http://127.0.0.1:8765', token: 'local-token' },
    { url: 'https://other.example/api', token: 'other-token' },
    { url: 'https://other.example/api', token: 'other-token' },
  ])
  settings.token = 'edited-token'
  assert.equal(await checkGenerationConnection({ background: true }), false)
  assert.equal(requests.length, 3)
  assert.equal(original.baseUrl, 'http://127.0.0.1:8765')
  assert.equal(original.token, 'local-token', 'existing job snapshots retain their original address/token pair')
  settings.baseUrl = 'http://127.0.0.1:8765'
  assert.equal(settings.token, '', 'returning to an earlier address must not restore its old token')
})
