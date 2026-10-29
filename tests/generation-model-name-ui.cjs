// Run against dev:web with PLAYWRIGHT_MODULE pointing to Playwright when needed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

;(async () => {
  const browser = await chromium.launch({ channel: process.env.G_STUDIO_TEST_BROWSER_CHANNEL || 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = [], tasks = new Map()
    page.on('pageerror', error => errors.push(String(error)))
    const caps = { protocolVersion: 1, providers: [
      { providerId: 'hunyuan-mini', name: 'Hunyuan3D-2mini-Turbo', state: 'ready', acceptsJobs: true, parameters: {} },
      { providerId: 'hunyuan-turbo', name: 'Hunyuan3D-2-Turbo', state: 'ready', acceptsJobs: true, parameters: {} },
    ], limits: { inputBytes: 10485760, inputDimension: 2048, outputBytes: 134217728, concurrency: 1, queue: 8 }, targetFaces: { min: 1000, max: 40000, default: 12000 } }
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
    await page.route('http://127.0.0.1:8765/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const reply = json => route.fulfill({ headers, json })
      if (path.endsWith('/capabilities')) return reply(caps)
      if (path.endsWith('/info')) return reply({ deviceType: 'gpu', backend: 'cuda' })
      if (path.endsWith('/jobs') && request.method() === 'POST') {
        const metadata = JSON.parse(request.postDataBuffer().toString().match(/name="request"\r\n\r\n([^\r]+)/)[1])
        const id = `name-test-${tasks.size + 1}`
        tasks.set(id, metadata)
        return reply({ id, status: 'queued', phase: 'queued' })
      }
      const id = path.split('/')[3]
      if (tasks.has(id)) return reply({ id, status: 'queued', phase: 'queued' })
      throw Error('Unexpected request ' + path)
    })
    await page.addInitScript(() => {
      const key = 'g-studio-generation-device-v1'
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ mode: 'direct', baseUrl: 'http://127.0.0.1:8765', token: 'name-test', providerId: 'hunyuan-mini' }))
    })
    await page.goto((process.env.G_STUDIO_TEST_URL || 'http://127.0.0.1:5173') + '/#/model-generation')
    await page.waitForFunction(async () => (await import('/src/shared/generation/connection.ts')).canGenerateModels.value)
    const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16); return c.toDataURL() })
    await page.locator('.generation-sidebar input[type=file]').setInputFiles({ name: 'model-name.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64') })
    const firstSubmit = page.waitForResponse(response => response.url().endsWith('/v1/jobs') && response.request().method() === 'POST')
    await page.locator('#generation-properties').getByRole('button', { name: '生成模型', exact: true }).click()
    await firstSubmit
    const field = page.locator('.generation-task-details').getByRole('textbox', { name: '生成模型', exact: true })
    await page.waitForFunction(() => document.querySelector('.generation-task-details input[aria-label="生成模型"]')?.value === 'Hunyuan3D-2mini-Turbo')
    await page.waitForFunction(async () => (await import('/src/shared/generation/jobs.ts')).generationJobs[0]?.remote?.status === 'queued')
    assert.equal([...tasks.values()][0].providerId, 'hunyuan-mini')
    await page.evaluate(async () => {
      const { generationSettings } = await import('/src/shared/generation/settings.ts')
      generationSettings.providerId = 'hunyuan-turbo'
      const { generationConnection } = await import('/src/shared/generation/connection.ts')
      generationConnection.capabilities.providers[0].name = 'Renamed service metadata'
    })
    assert.equal(await field.inputValue(), 'Hunyuan3D-2mini-Turbo')
    await page.reload()
    await page.locator('.queue-toggle').click()
    await page.locator('.queue-select').first().click()
    await page.waitForFunction(() => document.querySelector('.generation-task-details input[aria-label="生成模型"]')?.value === 'Hunyuan3D-2mini-Turbo')
    const stored = await page.evaluate(async () => {
      const { generationJobs } = await import('/src/shared/generation/jobs.ts')
      return { name: generationJobs[0].providerName, providerId: generationJobs[0].request.providerId }
    })
    assert.deepEqual(stored, { name: 'Hunyuan3D-2mini-Turbo', providerId: 'hunyuan-mini' })
    const secondSubmit = page.waitForResponse(response => response.url().endsWith('/v1/jobs') && response.request().method() === 'POST')
    await page.locator('#generation-properties').getByRole('button', { name: '生成模型', exact: true }).click()
    await secondSubmit
    assert.equal([...tasks.values()][1].providerId, 'hunyuan-turbo')
    assert.equal(await field.inputValue(), 'Hunyuan3D-2-Turbo')
    await page.locator('.queue-select').last().click()
    assert.equal(await field.inputValue(), 'Hunyuan3D-2mini-Turbo')
    assert.deepEqual(errors, [])
    console.log('PASS: task model name is captured on submission, displayed in sidebar and retained after switching models and reloading')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
