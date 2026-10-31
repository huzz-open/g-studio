// Reproduces old persisted defaults in the real generation panel.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

async function main() {
  const config = JSON.parse(fs.readFileSync('runtime/generation-data/config.json', 'utf8'))
  const response = await fetch('http://127.0.0.1:8765/v1/capabilities', { headers: { Authorization: 'Bearer ' + config.token } })
  assert.equal(response.status, 200)
  const caps = await response.json()
  assert.equal(caps.targetFaces.default, 40000)
  assert.equal(caps.providers.find(p => p.providerId === 'hunyuan-mini').parameters.resolution.default, 128)
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.addInitScript(() => {
      window.mod = path => import(performance.getEntriesByType('resource').find(e => e.name.includes(path))?.name || path)
      if (localStorage.getItem('defaults-fixture-seeded')) return
      const values = { targetFaces: 12000, seed: 12345, parametersByProvider: { 'hunyuan-mini': { steps: 5, resolution: 384 } } }
      localStorage.setItem('g-studio-generation-device-v1', JSON.stringify({ ...values, providerId: 'hunyuan-mini' }))
      localStorage.setItem('g-studio-generation-parameters-v1:example:chair', JSON.stringify(values))
      localStorage.setItem('defaults-fixture-seeded', 'yes')
    })
    async function open() {
      await page.goto(process.env.G_STUDIO_TEST_URL || 'http://localhost:5173')
      await page.locator('.module-card').first().waitFor()
      await page.evaluate(async caps => {
        const { generationConnection } = await window.mod('/src/shared/generation/connection.ts')
        const { loadPartLibrary } = await window.mod('/src/shared/parts/library.ts')
        const { openPartEditor } = await window.mod('/src/shared/parts/editor-session.ts')
        generationConnection.capabilities = caps
        await loadPartLibrary()
        openPartEditor({ assetId: 'example:chair', origin: 'scene' })
      }, caps)
      const model = page.locator('.sidebar-section').filter({ has: page.locator('.model-trigger') })
      if (await model.locator('.section-header').getAttribute('aria-expanded') === 'false') await model.locator('.section-header').click()
      await page.locator('.model-trigger').click()
      await page.getByRole('menuitem', { name: '生成模型', exact: true }).click()
    }
    await open()
    const panel = page.locator('.generation-overlay')
    const faces = panel.getByRole('spinbutton', { name: '目标三角面数', exact: true })
    const resolution = panel.getByRole('spinbutton', { name: '网格提取分辨率', exact: true })
    assert.equal(await faces.inputValue(), '40000')
    assert.equal(await resolution.inputValue(), '128')
    assert.equal(await resolution.getAttribute('max'), '512')
    assert.equal(await panel.locator('.parameter-reset:not(.unchanged)').count(), 0)
    fs.mkdirSync('.generation-test/defaults-refresh', { recursive: true })
    await panel.screenshot({ path: '.generation-test/defaults-refresh/migrated.png' })
    await faces.fill('12000'); await faces.blur()
    await resolution.fill('384'); await resolution.blur()
    await open()
    assert.equal(await faces.inputValue(), '12000', 'deliberate old values survive reload after migration')
    assert.equal(await resolution.inputValue(), '384')
    await panel.getByRole('button', { name: '重置目标三角面数', exact: true }).click()
    await panel.getByRole('button', { name: '重置网格提取分辨率', exact: true }).click()
    assert.equal(await faces.inputValue(), '40000')
    assert.equal(await resolution.inputValue(), '128')
    const snapshot = await page.evaluate(async () => {
      const { generationParametersFor } = await window.mod('/src/shared/generation/parameters.ts')
      const { snapshotGenerationConnection } = await window.mod('/src/shared/generation/request-snapshot.ts')
      const value = snapshotGenerationConnection(generationParametersFor('example:chair'))
      return { targetFaces: value.targetFaces, parameters: value.parametersByProvider['hunyuan-mini'] }
    })
    assert.equal(snapshot.targetFaces, 40000)
    assert.equal(snapshot.parameters.resolution, 128)
    assert.deepEqual(errors, [])
    console.log('PASS: old preferences migrate; panel, reset and request agree; custom values persist')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
