const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict'), fs = require('node:fs')
const { tetrahedron } = require('./fixtures/comparison-mesh.cjs')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'warn' && /Teleport/.test(m.text())) errors.push(m.text()) })
    await page.addInitScript(() => { window.mod = path => import(performance.getEntriesByType('resource').find(e => e.name.includes(path))?.name || path) })
    await page.goto((process.env.G_STUDIO_TEST_URL || 'http://localhost:5173') + '/#/model-generation')
    await page.locator('#generation-properties').waitFor()
    await page.evaluate(async uri => {
      const { createPart } = await window.mod('/src/shared/parts/schema.ts')
      const { initializeComparison } = await window.mod('/src/shared/parts/model-comparison.ts')
      const { saveReview } = await window.mod('/src/shared/parts/optimization-storage.ts')
      const { generationTabs, generationQueueExpanded } = await window.mod('/src/modules/model-generation/store.ts')
      const { generationJobs, loadGenerationJobs } = await window.mod('/src/shared/generation/jobs.ts')
      const { snapshotConnection } = await window.mod('/src/shared/generation/settings.ts')
      await loadGenerationJobs()
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 96
      canvas.getContext('2d').fillRect(8, 8, 48, 80)
      const part = createPart('预览布局检查', { uri: canvas.toDataURL(), width: 64, height: 96 })
      part.model = { kind: 'mesh', size: [2, 2, 2], mesh: { uri, sha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), providerId: 'hunyuan-mini', warnings: [] } }
      part.version = 2
      window.layoutPart = part
      const review = initializeComparison(part); review.modelComparison.autoOptimize = false; await saveReview(review)
      const job = { localId: 'layout-job', modelId: 'layout-job', modelRevision: 1, name: part.name, image: part.image.uri, createdAt: Date.now(),
        connection: snapshotConnection(), providerName: 'Mini', model: part.model,
        request: { providerId: 'hunyuan-mini', targetFaces: 40000, seed: 12345, parameters: { steps: 5, resolution: 128 }, inputSha256: 'b'.repeat(64) },
        remote: { id: 'layout-job', status: 'succeeded', phase: 'complete' } }
      generationJobs.unshift(job)
      const tab = generationTabs.activeInstance.value ?? generationTabs.createTab()
      tab.part = part; tab.jobId = job.localId; generationQueueExpanded.value = true
    }, 'data:model/gltf-binary;base64,' + tetrahedron().toString('base64'))
    const controls = page.locator('#generation-properties .model-controls')
    await controls.waitFor()
    async function checkWidth() {
      const outer = await page.locator('.generated-review').boundingBox()
      const inner = await page.locator('.generated-review .model-review').boundingBox()
      assert.ok(Math.abs(outer.x - inner.x) < 2, 'preview must not have an extra left column')
      assert.ok(Math.abs(outer.width - inner.width) < 2, 'preview fills the available width')
    }
    await checkWidth()
    assert.equal(await page.locator('.generated-review > .model-controls').count(), 0)
    const swipe = controls.getByRole('switch', { name: '滑动对比', exact: true })
    await swipe.click(); assert.equal(await swipe.isChecked(), false)
    for (const width of [1125, 1680]) { await page.setViewportSize({ width, height: 1000 }); await checkWidth() }
    fs.mkdirSync('.generation-test/viewer-layout', { recursive: true })
    await page.screenshot({ path: '.generation-test/viewer-layout/fixed.png' })
    await page.evaluate(async () => {
      const { loadPartLibrary, partLibrary } = await window.mod('/src/shared/parts/library.ts')
      const { openPartEditor } = await window.mod('/src/shared/parts/editor-session.ts')
      await loadPartLibrary(); partLibrary[window.layoutPart.id] = window.layoutPart
      openPartEditor({ assetId: window.layoutPart.id, origin: 'scene' })
    })
    const section = page.locator('.part-editor .sidebar-section').filter({ has: page.locator('.model-trigger') })
    if (await section.locator('.section-header').getAttribute('aria-expanded') === 'false') await section.locator('.section-header').click()
    await page.locator('.part-editor .model-trigger').click()
    await page.getByRole('menuitem', { name: '生成模型', exact: true }).click()
    const dialog = page.locator('.generation-overlay')
    await dialog.locator('.generation-properties .model-controls').waitFor()
    const dialogOuter = await dialog.locator('.generated-review').boundingBox()
    const dialogInner = await dialog.locator('.model-review').boundingBox()
    assert.ok(Math.abs(dialogOuter.x - dialogInner.x) < 2)
    assert.ok(Math.abs(dialogOuter.width - dialogInner.width) < 2)
    assert.equal(await dialog.locator('.generation-properties').getByRole('switch', { name: '滑动对比', exact: true }).count(), 1)
    assert.deepEqual(errors, [])
    console.log('PASS: page and dialog controls stay in existing sidebars; full-width preview and working switches')
  } finally { await browser.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
