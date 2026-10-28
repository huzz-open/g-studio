// Run against npm run dev:web; PLAYWRIGHT_MODULE may point to a bundled runtime.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

;(async () => {
  const browser = await chromium.launch({ channel: process.env.G_STUDIO_TEST_BROWSER_CHANNEL || 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(String(error)))
    let apiRequests = 0, lookups = 0, ready = false
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }
    const caps = { protocolVersion: 1, providers: [{ providerId: 'hunyuan-mini', name: 'Hunyuan', state: 'loading', acceptsJobs: true, tags: ['推荐','快速'], strategy: 'resident', parameters: {} }], limits: { inputBytes: 10485760, inputDimension: 2048, outputBytes: 134217728, concurrency: 1, queue: 8 }, targetFaces: { min: 1000, max: 40000, default: 12000 } }
    await page.route('**/__generation/connection', route => { lookups++; return route.fulfill({ json: { baseUrl: 'http://127.0.0.1:8765', token: 'local-only' } }) })
    await page.route('http://192.168.1.20:8765/**', async route => {
      apiRequests++
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      if (!ready) return route.abort()
      assert.equal(route.request().headers().authorization, 'Bearer direct-test-token')
      return route.fulfill({ headers, json: route.request().url().includes('capabilities') ? caps : { deviceType: 'gpu', backend: 'mps' } })
    })
    const base = process.env.G_STUDIO_TEST_URL || 'http://localhost:5173'
    await page.goto(base + '/#/sprite-slicer')
    await page.locator('.nav-link').filter({ hasText: '模型生成' }).click()
    await page.locator('#generation-url').waitFor()
    assert.equal(await page.locator('#generation-url').inputValue(), '')
    assert.equal(await page.locator('.generation-settings .seg-control').count(), 0)
    assert.equal(await page.locator('#generation-relay, #generation-pair').count(), 0)
    assert.equal(apiRequests, 0)
    assert.equal(lookups, 0)
    assert.equal(await page.locator('.generation-install').getAttribute('open'), '')
    let command = await page.locator('.install-command').innerText()
    assert.ok(command.includes(`G_STUDIO_SITE='${base}/'`))
    assert.ok(!command.includes('--host'))
    await page.locator('.install-scope input').check()
    command = await page.locator('.install-command').innerText()
    assert.ok(command.endsWith('--host 0.0.0.0'))
    const help = page.locator('.gs-row').filter({ has: page.locator('#generation-url') }).locator('.info-hint-button')
    await help.hover()
    await page.getByRole('tooltip').filter({ hasText: '浏览器直接调用' }).waitFor()
    await help.focus()
    await page.keyboard.press('Escape')
    await page.getByRole('tooltip').waitFor({ state: 'hidden' })
    fs.mkdirSync('.generation-test/connection-ui', { recursive: true })
    await page.screenshot({ path: '.generation-test/connection-ui/direct-setup.png' })
    await page.locator('.test-connection').click()
    await page.getByText('请先填写生成服务的 API 地址。', { exact: true }).waitFor()
    assert.equal(await page.locator('#generation-url').inputValue(), '')
    assert.equal(apiRequests, 0)
    await page.locator('#generation-url').fill('http://192.168.1.20:8765')
    await page.locator('#generation-token').fill('direct-test-token')
    await page.locator('.test-connection').click()
    await page.locator('.connection-status.failed').waitFor()
    await page.getByText(/无法连接生成服务/).waitFor()
    ready = true
    await page.locator('.test-connection').click()
    await page.locator('.connection-status.connected').waitFor()
    await page.locator('.device-tag').filter({ hasText: 'GPU · Apple MPS' }).waitFor()
    assert.match(await page.locator('#generation-provider option').innerText(), /推荐.*快速/);
    assert.doesNotMatch(await page.locator('#generation-provider option').innerText(), /加载/);
    assert.match(await page.locator('.provider-status').innerText(), /加载中.*可提交排队/);
    assert.equal(lookups, 0, 'a remote API must never use local development credentials')
    await page.locator('#generation-url').fill('http://public.example.com:8765')
    await page.locator('.test-connection').click()
    await page.getByText('公网 API 需要 HTTPS。本机或内网直连可使用 HTTP。', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    // Migrating a saved relay connection leaves an unconfigured direct API.
    await page.evaluate(() => localStorage.setItem('g-studio-generation-device-v1', JSON.stringify({ mode: 'relay', relayUrl: 'https://old.example', relayToken: 'old-token', deviceId: 'old-device', baseUrl: 'http://127.0.0.1:8765', token: 'old-direct' })))
    await page.reload()
    const migrated = await page.evaluate(async () => (await import('/src/shared/generation/settings.ts')).generationSettings)
    assert.equal(migrated.mode, 'direct')
    assert.equal(migrated.baseUrl, '')
    assert.equal(migrated.token, '')
    assert.equal(migrated.relayToken, '')
    console.log('PASS: unconfigured API makes no requests, direct-only settings, install command, hover/keyboard help, private HTTP API with explicit token, public HTTPS requirement and relay migration')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
