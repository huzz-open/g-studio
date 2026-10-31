const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.addInitScript(() => { window.mod = path => import(performance.getEntriesByType('resource').find(e => e.name.includes(path))?.name || path) })
    await page.goto(process.env.G_STUDIO_TEST_URL || 'http://localhost:5173')
    await page.locator('.module-card').first().waitFor()
    await page.evaluate(async () => {
      const { generationSettings } = await window.mod('/src/shared/generation/settings.ts')
      const { generationConnection } = await window.mod('/src/shared/generation/connection.ts')
      const { GenerationClient } = await window.mod('/src/shared/generation/client.ts')
      const { loadPartLibrary, partLibrary } = await window.mod('/src/shared/parts/library.ts')
      const { createPart } = await window.mod('/src/shared/parts/schema.ts')
      const { openPartEditor } = await window.mod('/src/shared/parts/editor-session.ts')
      generationSettings.providerId = 'hunyuan-mini'
      generationSettings.parametersByProvider = {}
      generationConnection.capabilities = { providers: [
        { providerId: 'hunyuan-mini', name: 'Hunyuan3D-2mini-Turbo', state: 'ready', parameters: { steps: { min: 1, max: 10, default: 5 }, resolution: { min: 128, max: 512, default: 128 } } },
        { providerId: 'hunyuan-turbo', name: 'Hunyuan3D-2-Turbo', state: 'ready', parameters: { steps: { min: 1, max: 10, default: 5 }, resolution: { min: 128, max: 512, default: 128 } } },
        { providerId: 'hunyuan-2-1', name: 'Hunyuan3D-2.1', state: 'disabled', parameters: {} },
      ] }
      generationConnection.connected = true
      window.submittedRequests = []
      GenerationClient.prototype.submit = async function (request) {
        window.submittedRequests.push(JSON.parse(JSON.stringify(request)))
        await new Promise(resolve => { window.finishSubmission = resolve })
        return { id: request.clientRequestId, status: 'failed', phase: 'failed', error: { message: 'Test result', retryable: true } }
      }
      GenerationClient.prototype.status = async id => ({ id, status: 'failed', phase: 'failed', error: { message: 'Test result', retryable: true } })
      await loadPartLibrary()
      partLibrary['provider-fixture'] = createPart('模型选择测试', partLibrary['example:chair'].image, 'provider-fixture')
      openPartEditor({ assetId: 'provider-fixture', origin: 'scene' })
    })
    const modelSection = page.locator('.sidebar-section').filter({ has: page.locator('.model-trigger') })
    if (await modelSection.locator('.section-header').getAttribute('aria-expanded') === 'false') await modelSection.locator('.section-header').click()
    await page.locator('.model-trigger').click()
    await page.getByRole('menuitem', { name: '生成模型', exact: true }).click()
    const panel = page.locator('.generation-overlay'), select = panel.getByRole('combobox', { name: '生成模型', exact: true })
    const steps = panel.getByRole('spinbutton', { name: '采样步数', exact: true })
    const resolution = panel.getByRole('spinbutton', { name: '网格提取分辨率', exact: true })
    async function choose(name) {
      await select.click()
      assert.equal(await page.getByRole('option', { name: /Hunyuan3D-2.1/ }).isDisabled(), true)
      await page.getByRole('option', { name: new RegExp(name) }).click()
    }
    assert.match(await select.textContent(), /2mini-Turbo/)
    await steps.fill('9'); await steps.blur()
    await resolution.fill('256'); await resolution.blur()
    await choose('Hunyuan3D-2-Turbo')
    assert.equal(await steps.inputValue(), '5')
    assert.equal(await resolution.inputValue(), '128')
    await steps.fill('7'); await steps.blur()
    await choose('Hunyuan3D-2mini-Turbo')
    assert.equal(await steps.inputValue(), '9')
    assert.equal(await resolution.inputValue(), '256')
    await choose('Hunyuan3D-2-Turbo')
    assert.equal(await steps.inputValue(), '7')
    fs.mkdirSync('.generation-test/provider-panel', { recursive: true })
    await panel.locator('.generation-properties').screenshot({ path: '.generation-test/provider-panel/selection.png' })
    await panel.getByRole('button', { name: '生成模型', exact: true }).click()
    await page.waitForFunction(() => window.submittedRequests.length === 1 && window.finishSubmission).catch(async error => {
      console.error(await page.evaluate(async () => {
        const { generationJobs } = await window.mod('/src/shared/generation/jobs.ts')
        return { submitted: window.submittedRequests, jobs: generationJobs.map(j => ({ error: j.error, request: j.request })), alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent) }
      }))
      throw error
    })
    assert.equal(await select.isDisabled(), true)
    const submitted = await page.evaluate(() => window.submittedRequests[0])
    assert.equal(submitted.providerId, 'hunyuan-turbo')
    assert.deepEqual(submitted.parameters, { steps: 7, resolution: 128 })
    await page.evaluate(() => window.finishSubmission())
    await page.waitForFunction(() => !document.querySelector('.generation-overlay .provider-select').disabled)
    await choose('Hunyuan3D-2mini-Turbo')
    assert.equal((await page.evaluate(() => window.submittedRequests[0])).providerId, 'hunyuan-turbo')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('g-studio-generation-device-v1')).providerId), 'hunyuan-mini')
    assert.deepEqual(errors, [])
    console.log('PASS: inline model choice, per-model parameters, disabled options, submission lock and immutable request')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
