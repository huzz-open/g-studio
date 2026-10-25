const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.NORMAL_TEST_BROWSER || undefined, headless: true })
  try {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      window.sliceJobs = []
      const send = Worker.prototype.postMessage
      Worker.prototype.postMessage = function(message, ...args) {
        if (message.input?.detection) {
          if (!this.trackedSliceJobs) {
            this.trackedSliceJobs = new Map()
            this.addEventListener('message', event => { const job = this.trackedSliceJobs.get(event.data.id); if (job) job.finished = performance.now() })
          }
          const job = { started: performance.now(), finished: 0, gap: message.input.detection.mergeGap }
          this.trackedSliceJobs.set(message.id, job); window.sliceJobs.push(job)
        }
        return send.call(this, message, ...args)
      }
    })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.log(message.text()) })
    await page.goto(process.env.NORMAL_TEST_URL || 'http://127.0.0.1:5178/')
    const result = await page.evaluate(async () => {
      const { createWorkerClient } = await import('/src/shared/utils/worker-client.ts')
      const { opencvDetect } = await import('/src/modules/sprite-slicer/core/detection/opencv-detector.ts')
      const { GridDetector } = await import('/src/modules/sprite-slicer/core/detection/grid-detector.ts')
      const { generateTileset } = await import('/src/modules/tileset-maker/core/generator.ts')
      const { getLayout } = await import('/src/modules/tileset-maker/core/layouts.ts')
      const { getProfile } = await import('/src/modules/tileset-maker/core/sdf/profiles.ts')
      const slice = createWorkerClient(() => new Worker('/src/modules/sprite-slicer/core/processing/slice.worker.ts', { type: 'module' }))
      const tile = createWorkerClient(() => new Worker('/src/modules/tileset-maker/core/generate.worker.ts', { type: 'module' }))
      const image = new ImageData(64, 48)
      for (let y = 3; y < 40; y++) for (let x = 3; x < 58; x++) {
        if ((x < 24 || x > 33) && (y < 20 || x % 6 > 1)) image.data.set([x * 4, y * 5, 120, x % 7 === 0 ? 64 : 255], (y * 64 + x) * 4)
      }
      const task = { sourceId: 1, image, background: { id: 'none', options: { bgColor: [255, 0, 255], tolerance: 50, spillStrength: 70 } }, arrange: 'none' }
      const comparisons = []
      const normalized = sprites => sprites.map(s => ({ rect: s.rect, pixels: [...s.imageData.data] }))
      let detector
      for (const detection of [{ mode: 'auto', mergeGap: 0, minArea: 10 }, { mode: 'auto', mergeGap: 14, minArea: 50 },
        { mode: 'grid', cols: 2, rows: 2, gapH: 0, gapV: 0, marginH: 0, marginV: 0 }]) {
        const actual = await slice.run({ ...task, detection })
        const expected = detection.mode === 'auto' ? await opencvDetect(image, image.width, image.height, detection) : new GridDetector().detect(image, image.width, image.height, detection)
        if (detection.mode === 'auto') detector = actual.detector
        comparisons.push(JSON.stringify(normalized(actual.sprites)) === JSON.stringify(normalized(expected)))
      }
      const tileComparisons = []
      const texture = new Uint8ClampedArray(32 * 32 * 4).fill(180)
      for (let i = 3; i < texture.length; i += 4) texture[i] = 255
      for (const input of [
        { mode: 'sdf', texturePixels: texture, tileSize: 32, layout: getLayout('11x5'), profile: getProfile('stone') },
        { mode: 'subtile', sourcePixels: new Uint8ClampedArray(36 * 36 * 4).fill(200), sourceWidth: 36, sourceHeight: 36, layout: getLayout('8x6'), useMagenta: true, magentaTolerance: 30, customSplits: null },
      ]) {
        const actual = await tile.run(input), expected = generateTileset(input)
        tileComparisons.push(actual.width === expected.width && actual.height === expected.height && actual.pixels.every((value, i) => value === expected.pixels[i]))
      }
      // While detection/encoding runs, the browser must still receive animation frames.
      const large = new ImageData(1774, 887)
      for (let y = 20; y < 850; y++) for (let x = 20; x < 1750; x++) if (x % 150 < 90 && y % 150 < 100) large.data.set([80, 150, 60, 255], (y * 1774 + x) * 4)
      let frames = 0, sampling = true
      const tick = () => { if (sampling) { frames++; requestAnimationFrame(tick) } }; requestAnimationFrame(tick)
      const start = performance.now()
      await slice.run({ ...task, sourceId: 2, image: large, detection: { mode: 'auto', mergeGap: 14, minArea: 50 } })
      const elapsed = performance.now() - start
      sampling = false; slice.dispose(); tile.dispose()
      return { comparisons, tileComparisons, detector, frames, elapsed }
    })
    assert.equal(result.detector, 'opencv', 'worker must use the same OpenCV algorithm, not silently fall back')
    assert.ok(result.comparisons.every(Boolean), 'worker slicing differs from existing detector')
    assert.ok(result.tileComparisons.every(Boolean), 'worker tileset output differs from existing generator')
    assert.ok(result.frames >= 2, 'main thread must keep rendering while a large sprite sheet is processed')
    assert.deepEqual(errors, [])
    console.log('Worker parity and responsiveness passed', result)
    const base = process.env.NORMAL_TEST_URL || 'http://127.0.0.1:5178/'
    await page.goto(base + '#/sprite-slicer')
    await page.locator('.sidebar-content').waitFor()
    await page.evaluate(async () => {
      const store = document.querySelector('.sidebar-content').__vueParentComponent.props.store
      window.processingStore = store
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 720
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#75984c'
      for (let y = 0; y < 650; y += 110) for (let x = 0; x < 1100; x += 110) ctx.fillRect(x + 10, y + 10, 80, 80)
      store.state.bgRemoverId = 'none'
      await store.loadFile(new File([await new Promise(resolve => canvas.toBlob(resolve))], 'performance.png', { type: 'image/png' }))
    })
    const drag = await page.evaluate(async () => {
      window.sliceJobs = []
      const input = document.querySelector('input[aria-label="合并间距"]')
      const sliderTop = input.getBoundingClientRect().top
      let shifted = false
      let frames = 0, sampling = true
      const tick = () => { if (sampling) { frames++; requestAnimationFrame(tick) } }; requestAnimationFrame(tick)
      for (let value = 0; value <= 14; value++) {
        input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 30))
        shifted ||= Math.abs(input.getBoundingClientRect().top - sliderTop) > 1
      }
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await window.processingStore.flushProcessing()
      await window.processingStore.waitForProcessing()
      sampling = false
      return { jobs: window.sliceJobs, frames, shifted, error: window.processingStore.state.processingError, gap: window.processingStore.state.mergeGap }
    })
    assert.equal(drag.error, ''); assert.equal(drag.gap, 14)
    assert.equal(drag.shifted, false, 'processing status must not move the slider under the pointer')
    assert.equal(drag.jobs.at(-1).gap, 14)
    assert.ok(drag.jobs.length < 15); assert.ok(drag.frames >= 5)
    for (let i = 1; i < drag.jobs.length; i++) assert.ok(drag.jobs[i].started >= drag.jobs[i - 1].finished)
    console.log('Detection slider stays responsive and computes final value:', { jobs: drag.jobs.length, frames: drag.frames })
    await page.goto(base + '#/tileset-maker')
    await page.locator('.texture-source-panel').waitFor()
    await page.evaluate(() => {
      const store = document.querySelector('.texture-source-panel').__vueParentComponent.props.store
      window.tileProcessingStore = store
      store.setTextureFromPixels(new Uint8ClampedArray(64 * 64 * 4).fill(180), 64, 'texture')
    })
    await page.waitForFunction(() => window.tileProcessingStore.state.atlasPixels && !window.tileProcessingStore.state.isGenerating)
    const retained = await page.evaluate(async () => {
      const old = window.tileProcessingStore.state.atlasPixels
      for (let i = 0; i < 12; i++) window.tileProcessingStore.setProfileParam('edgeOffset', 0.1 + i * 0.01)
      const retained = window.tileProcessingStore.state.atlasPixels === old
      window.tileProcessingStore.flushGeneration()
      return retained
    })
    assert.equal(retained, true)
    await page.waitForFunction(() => !window.tileProcessingStore.state.isGenerating)
    assert.equal(await page.locator('.top-loading').count(), 0)
    await page.evaluate(() => { window.tileProcessingStore.setProfileParam('edgeOffset', 0.4); window.tileProcessingStore.setMode('subtile') })
    assert.equal(await page.evaluate(() => window.tileProcessingStore.state.atlasPixels), null)
    assert.deepEqual(errors, [])
    console.log('Tileset generation preserves the preview and clears obsolete results on mode changes')
  } finally { await browser.close() }
})().catch(e => { console.error(e); process.exit(1) })
