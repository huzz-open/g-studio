// Run against dev:web with PLAYWRIGHT_MODULE pointing to an installed Playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(process.env.G_STUDIO_TEST_URL || 'http://localhost:5173')
    await page.locator('.module-card').first().waitFor()
    await page.evaluate(async () => {
      const { loadPartLibrary } = await import('/src/shared/parts/library.ts')
      const { openPartEditor } = await import('/src/shared/parts/editor-session.ts')
      await loadPartLibrary(); openPartEditor({ assetId: 'example:chair', origin: 'scene' })
    })
    const single = page.locator('.preview-stage > .lighting-viewport')
    await single.locator('.viewport-stage[aria-busy="false"] .light-guide').waitFor()

    async function delayUpdates() {
      await single.evaluate(element => {
        const renderer = element.__vueParentComponent.setupState.renderer
        const sync = renderer.syncAssets
        renderer.syncAssets = async (...args) => {
          await new Promise(resolve => setTimeout(resolve, 600))
          return sync(...args)
        }
        window.previewCanvas = element.querySelector('canvas')
        const editor = document.querySelector('.part-editor').__vueParentComponent.setupState
        window.cameraBefore = JSON.stringify({ zoom: editor.preview.zoom, target: editor.preview.target })
        window.draftBefore = JSON.stringify(editor.draft)
      })
    }
    async function assertStable() {
      assert.equal(await single.locator('canvas').evaluate(canvas => canvas === window.previewCanvas), true)
      assert.equal(await page.evaluate(() => {
        const editor = document.querySelector('.part-editor').__vueParentComponent.setupState
        return JSON.stringify({ zoom: editor.preview.zoom, target: editor.preview.target }) === window.cameraBefore
          && JSON.stringify(editor.draft) === window.draftBefore
      }), true, 'hover keeps the camera and authored part unchanged')
    }
    await delayUpdates()
    const baseline = await single.locator('canvas').evaluate(canvas => canvas.toDataURL())
    await page.locator('.geometry-trigger').click()
    await page.getByRole('menuitemradio', { name: '轮廓近似', exact: true }).hover()
    await single.locator('.viewport-stage[aria-busy="true"]').waitFor()
    assert.equal(await single.locator('canvas').evaluate(canvas => canvas.toDataURL()), baseline, 'keep the old frame during a slow update')
    await single.locator('.viewport-stage[aria-busy="false"]').waitFor()
    await assertStable()
    await page.keyboard.press('Escape')
    await single.locator('.viewport-stage[aria-busy="false"]').waitFor()

    // Add a valid mesh and optimization candidate to exercise comparison → hover → comparison.
    await page.evaluate(async () => {
      const { meshDataUri } = await import('/src/shared/parts/mesh.ts')
      const { initializeComparison, storeCandidate } = await import('/src/shared/parts/model-comparison.ts')
      const { clonePart } = await import('/src/shared/parts/schema.ts')
      const state = document.querySelector('.part-editor').__vueParentComponent.setupState
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 1])
      const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }
      const json = JSON.stringify(doc), encoded = new TextEncoder().encode(json + ' '.repeat((4 - json.length % 4) % 4))
      const bytes = new ArrayBuffer(28 + encoded.length + 36), view = new DataView(bytes)
      for (const [offset, value] of [[0, 0x46546c67], [4, 2], [8, bytes.byteLength], [12, encoded.length], [16, 0x4e4f534a], [20 + encoded.length, 36], [24 + encoded.length, 0x004e4942]]) view.setUint32(offset, value, true)
      new Uint8Array(bytes, 20, encoded.length).set(encoded); new Uint8Array(bytes, 28 + encoded.length).set(new Uint8Array(positions.buffer))
      const part = clonePart(state.draft)
      part.version = 2; part.geometry = { kind: 'mesh', size: [1, 2, 1], mesh: { uri: meshDataUri(bytes), sha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), providerId: 'fixture', warnings: [] } }
      const initialized = initializeComparison(part, true), candidate = clonePart(initialized)
      candidate.geometry.size = [.8, 1.8, .8]; storeCandidate(initialized, candidate)
      state.draft = initialized
    })
    const comparison = page.locator('.model-comparison')
    await comparison.locator('.comparison-loading').waitFor({ state: 'detached' })
    await single.locator('.viewport-stage[aria-busy="false"]').waitFor({ state: 'attached' })
    await page.waitForTimeout(100)
    await delayUpdates()
    await comparison.evaluate(element => { window.comparisonElement = element; window.comparisonFrame = element.querySelector('canvas').toDataURL() })
    await page.locator('.geometry-trigger').click()
    await page.getByRole('menuitemradio', { name: '轮廓近似', exact: true }).hover()
    await single.locator('.viewport-stage[aria-busy="true"]').waitFor({ state: 'attached' })
    assert.equal(await comparison.isVisible(), true, 'comparison stays visible until the hover frame is drawn')
    assert.equal(await comparison.locator('canvas').first().evaluate(canvas => canvas.toDataURL() === window.comparisonFrame), true)
    await single.locator('.viewport-stage[aria-busy="false"]').waitFor()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.preview-stage > .lighting-viewport')).visibility === 'visible')
    await assertStable()
    await page.keyboard.press('Escape')
    assert.equal(await comparison.isVisible(), true)
    assert.equal(await comparison.evaluate(element => element === window.comparisonElement), true, 'returning never remounts comparison canvases')
    assert.equal(await comparison.locator('.comparison-loading').count(), 0)
    await assertStable()
    assert.deepEqual(errors, [])
    console.log('PASS: slow hover updates preserve frames, camera and draft; comparison handoffs retain mounted canvases')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
