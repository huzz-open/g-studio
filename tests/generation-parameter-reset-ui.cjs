const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(process.env.G_STUDIO_TEST_URL || 'http://localhost:5173')
    await page.locator('.module-card').first().waitFor()
    async function openPart(id, customDefaults) {
      await page.evaluate(async ({ id, customDefaults }) => {
        const { generationSettings } = await import('/src/shared/generation/settings.ts')
        const { generationConnection } = await import('/src/shared/generation/connection.ts')
        const { loadPartLibrary } = await import('/src/shared/parts/library.ts')
        const { openPartEditor } = await import('/src/shared/parts/editor-session.ts')
        if (customDefaults) Object.assign(generationSettings, {
          targetFaces: 24000, seed: 87844, providerId: 'hunyuan-mini',
          parametersByProvider: { 'hunyuan-mini': { steps: 10, resolution: 256 } },
        })
        generationConnection.capabilities = { providers: [{ providerId: 'hunyuan-mini', state: 'ready', parameters: {
          steps: { min: 1, max: 10, default: 5, integer: true },
          resolution: { min: 64, max: 384, default: 256, integer: true },
        } }] }
        await loadPartLibrary(); openPartEditor({ assetId: id, origin: 'scene' })
      }, { id, customDefaults })
      await page.locator('.geometry-trigger').click()
      await page.getByRole('menuitem', { name: '生成模型', exact: true }).click()
    }
    await openPart('example:bonsai', true)
    const overlay = page.locator('.generation-overlay')
    const resets = overlay.locator('.parameter-reset:not(.unchanged)')
    const fields = [ ['目标三角面数', '24000', '18000', '12000'], ['随机种子', '87844', '42', '12345'], ['采样步数', '10', '7', '5'], ['网格提取分辨率', '256', '128', '256'] ]
    assert.equal(await resets.count(), 3, 'custom initial values differ from original defaults')
    for (const [name, initial, changed] of fields) {
      const input = overlay.getByRole('spinbutton', { name, exact: true })
      assert.equal(await input.inputValue(), initial)
      await input.fill(changed); await input.blur()
    }
    assert.equal(await resets.count(), 4)
    for (const [name, , , original] of fields) {
      const reset = overlay.getByRole('button', { name: `重置${name}`, exact: true })
      assert.equal(await reset.getAttribute('title'), `${name}：恢复默认值（${original}）`)
      await reset.click()
      assert.equal(await overlay.getByRole('spinbutton', { name, exact: true }).inputValue(), original)
    }
    assert.equal(await resets.count(), 0)
    await overlay.getByRole('spinbutton', { name: '目标三角面数', exact: true }).fill('18000')
    await overlay.getByRole('spinbutton', { name: '目标三角面数', exact: true }).blur()
    await overlay.getByRole('spinbutton', { name: '采样步数', exact: true }).fill('7')
    await overlay.getByRole('spinbutton', { name: '采样步数', exact: true }).blur()
    await page.evaluate(async () => {
      const { generationSettings } = await import('/src/shared/generation/settings.ts')
      generationSettings.targetFaces = 30000; generationSettings.seed = 333
      generationSettings.parametersByProvider['hunyuan-mini'].steps = 8
    })
    await page.reload(); await page.locator('.module-card').first().waitFor()
    await openPart('example:bonsai', false)
    assert.equal(await resets.count(), 2, 'reopening still compares against original defaults')
    await overlay.getByRole('button', { name: '重置目标三角面数', exact: true }).click()
    await overlay.getByRole('button', { name: '重置采样步数', exact: true }).click()
    assert.equal(await overlay.getByRole('spinbutton', { name: '目标三角面数', exact: true }).inputValue(), '12000')
    assert.equal(await overlay.getByRole('spinbutton', { name: '采样步数', exact: true }).inputValue(), '5')
    assert.equal(await resets.count(), 0)
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    await openPart('example:chair', false)
    assert.equal(await overlay.getByRole('spinbutton', { name: '目标三角面数', exact: true }).inputValue(), '30000')
    assert.equal(await resets.count(), 3, 'a different source inherits custom inputs but uses original reset targets')
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    await openPart('example:bonsai', false)
    assert.equal(await resets.count(), 0)
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    // Regression: default-valued legacy drafts must ignore a different saved baseline.
    await page.evaluate(() => localStorage.setItem('g-studio-generation-parameters-v1:example:vase', JSON.stringify({
      targetFaces: 12000, seed: 12345, parametersByProvider: { 'hunyuan-mini': { steps: 5, resolution: 256 } },
      baseline: { targetFaces: 24000, seed: 87844, parametersByProvider: { 'hunyuan-mini': { steps: 10, resolution: 256 } } },
    })))
    await openPart('example:vase', false)
    assert.equal(await resets.count(), 0, 'original defaults never show reset even with a legacy baseline')
    assert.equal(await page.evaluate(() => 'baseline' in JSON.parse(localStorage.getItem('g-studio-generation-parameters-v1:example:vase'))), false)
    // Algorithm-specific targets come from its declared defaults, not hardcoded 5/256.
    await page.evaluate(async () => {
      const { generationConnection } = await import('/src/shared/generation/connection.ts')
      const parameters = generationConnection.capabilities.providers[0].parameters
      parameters.steps.default = 8; parameters.resolution.default = 128
    })
    assert.equal(await resets.count(), 2)
    await overlay.getByRole('button', { name: '重置采样步数', exact: true }).click()
    await overlay.getByRole('button', { name: '重置网格提取分辨率', exact: true }).click()
    assert.equal(await overlay.getByRole('spinbutton', { name: '采样步数', exact: true }).inputValue(), '8')
    assert.equal(await overlay.getByRole('spinbutton', { name: '网格提取分辨率', exact: true }).inputValue(), '128')
    assert.equal(await resets.count(), 0)
    assert.deepEqual(errors, [])
    console.log('PASS: original reset targets and tooltips, custom input isolation, reload, legacy baseline migration, provider defaults')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
