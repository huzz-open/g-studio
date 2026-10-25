const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const assert = require('node:assert/strict')
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.NORMAL_TEST_BROWSER || undefined, headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    page.setDefaultTimeout(15000)
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    let workersCreated = 0; page.on('worker', () => workersCreated++)
    const base = process.env.NORMAL_TEST_URL || 'http://127.0.0.1:5178/'
    await page.goto(base)
    const geometryCheck = await page.evaluate(async () => {
      const { buildShadowGeometry, casterHeight, lightElevation } = await import('/src/modules/sprite-slicer/core/normal/shadow-geometry.ts')
      const { createGroundShadow } = await import('/src/modules/sprite-slicer/core/normal/ground-shadow.ts')
      const { previewLight } = await import('/src/modules/sprite-slicer/core/normal/lighting.ts')
      const image = new ImageData(14, 10), cells = []
      for (let y = 2; y < 8; y++) for (let x = 4; x < 10; x++) {
        if (x >= 6 && x < 8 && y >= 4 && y < 6) continue
        image.data.set([100, 160, 60, 255], (y * 14 + x) * 4); cells.push([x, y])
      }
      image.data.set([255, 0, 255, 1], 0)
      const canvas = document.createElement('canvas'), renderer = createGroundShadow(canvas, image, buildShadowGeometry(image.data, image.width, image.height))
      const view = { width: 60, height: 40, scale: 1, panX: 16, panY: 10 }
      const gl = canvas.getContext('webgl')
      // Independent reference: slab intersection of a ground-to-light ray with each solid pixel prism.
      function blocked(px, py, lx, ly, lz) {
        return cells.some(([x, y]) => {
          let near = 0, far = 1
          for (const [origin, direction, min, max] of [[px, lx - px, x, x + 1], [py, ly - py, y, y + 1], [0, lz, 0, casterHeight(14, 10)]]) {
            if (Math.abs(direction) < 1e-10) { if (origin < min || origin > max) return false; continue }
            let a = (min - origin) / direction, b = (max - origin) / direction
            if (a > b) [a, b] = [b, a]
            near = Math.max(near, a); far = Math.min(far, b)
            if (near > far) return false
          }
          return far > 0 && near < 1
        })
      }
      const checks = []
      Object.assign(previewLight, { ambient: 0, brightness: 1, color: '#ffffff' })
      for (const [height, lx, ly] of [[0.15, 0.3, 0.2], [0.3, 0.3, 0.2], [0.8, 0.3, 0.2], [0.05, 0.3, 0.2], [0.3, 20.3, 4.2], [0.05, 5.3, 3.2], [0.1, 0.3, 0.2], [0.3, 6.7, 4.8], [0.05, 6.7, 4.8], [0.05, 6, 4], [0.05, 4, 3.2], [0.05, 5, 3.2]]) {
        previewLight.height = height; renderer.draw(lx, ly, view, previewLight)
        const pixels = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        let mismatches = 0, shadowPixels = 0
        for (let y = 0; y < view.height; y++) for (let x = 0; x < view.width; x++) {
          const actual = pixels[((view.height - 1 - y) * view.width + x) * 4] === 0
          const expected = blocked(x + 0.5 - view.panX, y + 0.5 - view.panY, lx, ly, lightElevation(14, 10, height))
          if (actual) shadowPixels++
          if (actual !== expected) mismatches++
        }
        renderer.draw(lx, ly, { width: 120, height: 80, scale: 2, panX: 32, panY: 20 }, previewLight)
        const zoomed = new Uint8Array(pixels.length)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, zoomed)
        checks.push({ height, lx, mismatches, shadowPixels, zoomMatches: zoomed.every((v, i) => v === pixels[i]), error: gl.getError() })
      }
      renderer.dispose()
      return checks
    })
    console.log('Projected silhouette vs independent ray/prism reference:', geometryCheck)
    for (const check of geometryCheck) { assert.equal(check.error, 0); assert.equal(check.zoomMatches, true); assert.ok(check.mismatches <= 4, `projection mismatch: ${JSON.stringify(check)}`) }
    assert.ok(geometryCheck[0].shadowPixels > geometryCheck[1].shadowPixels)
    assert.ok(geometryCheck[1].shadowPixels > geometryCheck[2].shadowPixels)
    await page.goto(base + '#/sprite-slicer')
    await page.locator('.sidebar-content').waitFor()
    await page.evaluate(async () => {
      const store = document.querySelector('.sidebar-content').__vueParentComponent.props.store
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b3744c'; ctx.fillRect(24, 25, 46, 45); ctx.clearRect(40, 40, 14, 14)
      store.setPendingRestore([{ name: 'shadow-test', rect: [0, 0, 96, 96] }])
      await store.loadFile(new File([await new Promise(resolve => canvas.toBlob(resolve))], 'shadow-test.png', { type: 'image/png' }))
      window.shadowTestStore = store
    })
    await page.locator('.grid-rect').dblclick()
    await page.locator('.ic-overlay .ic-image').waitFor({ state: 'visible' })
    assert.equal(await page.locator('.shadow-canvas').evaluate(c => c.style.visibility), 'hidden')
    const originalSrc = await page.locator('.ic-overlay .ic-image').getAttribute('src')
    const exportPixels = () => page.evaluate(async () => {
      const { buildOutput } = await import('/src/modules/sprite-slicer/core/export/output.ts')
      const files = await buildOutput(window.shadowTestStore.state.sprites, { w: 96, h: 96 }, 'shadow-test', { composite: true, sprites: false, normals: true, meta: false })
      return Promise.all(files.map(async file => ({ name: file.name, bytes: [...new Uint8Array(await file.blob.arrayBuffer())] })))
    })
    const originalExport = await exportPixels()
    await page.getByRole('button', { name: '灯光', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.normal-canvas')?.dataset.mode === 'lighting')
    const help = page.getByRole('button', { name: '投影预览说明', exact: true })
    const shadowSwitch = page.getByRole('switch', { name: '投影预览', exact: true })
    assert.equal(await page.locator('.shadow-settings p').count(), 0)
    assert.equal(await page.getByRole('tooltip').count(), 0)
    await help.hover()
    await page.getByRole('tooltip').waitFor({ state: 'visible' })
    if (process.env.INFO_HINT_SCREENSHOT) await page.screenshot({ path: process.env.INFO_HINT_SCREENSHOT })
    assert.ok((await page.getByRole('tooltip').innerText()).includes('不会修改原图'))
    assert.ok(!(await page.getByRole('tooltip').innerText()).includes('10%'))
    const beforeHelp = await shadowSwitch.isChecked()
    await help.click()
    assert.equal(await shadowSwitch.isChecked(), beforeHelp, 'help must not toggle the checkbox')
    await help.press('Escape')
    assert.equal(await page.getByRole('tooltip').count(), 0)
    await shadowSwitch.focus(); await help.focus()
    await page.getByRole('tooltip').waitFor({ state: 'visible' })
    const tipBox = await page.getByRole('tooltip').boundingBox()
    assert.ok(tipBox.y >= 0 && tipBox.y + tipBox.height <= 1000)
    await shadowSwitch.focus()
    await page.getByRole('switch', { name: '投影预览', exact: true }).check()
    await page.waitForFunction(() => document.querySelector('.shadow-canvas')?.style.visibility === 'visible')
    const shadowWidth = await page.locator('.shadow-canvas').evaluate(c => c.width)
    const preparedWorkers = workersCreated
    const area = await page.locator('.ic-overlay .pzv-container').boundingBox()
    await page.mouse.move(area.x + area.width * 0.25, area.y + area.height * 0.25)
    await page.getByRole('slider', { name: '高度', exact: true }).fill('0.2')
    if (process.env.SHADOW_SCREENSHOT) await page.screenshot({ path: process.env.SHADOW_SCREENSHOT })
    const low = await page.locator('.shadow-canvas').screenshot()
    await page.getByRole('slider', { name: '高度', exact: true }).fill('1.5')
    const high = await page.locator('.shadow-canvas').screenshot()
    assert.ok(!low.equals(high), 'light height must affect the ground receiver')
    await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.2)
    await page.mouse.wheel(0, -120)
    await page.waitForFunction(width => document.querySelector('.shadow-canvas')?.width !== width, shadowWidth)
    assert.equal(workersCreated, preparedWorkers, 'moving the light or changing height/zoom must not regenerate normal maps or silhouette geometry')
    assert.deepEqual(await exportPixels(), originalExport, 'shadow preview must never bake into exported color or normal maps')
    await page.getByRole('button', { name: '法线', exact: true }).click()
    assert.equal(await page.locator('.shadow-canvas').evaluate(c => c.style.visibility), 'hidden')
    await page.getByRole('button', { name: '灯光', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.shadow-canvas')?.style.visibility === 'visible')
    await page.getByRole('switch', { name: '投影预览', exact: true }).uncheck()
    assert.equal(await page.locator('.shadow-canvas').evaluate(c => c.style.visibility), 'hidden')
    await page.getByRole('button', { name: '灯光', exact: true }).click()
    assert.equal(await page.locator('.ic-overlay .ic-image').getAttribute('src'), originalSrc)
    assert.equal(await page.locator('.ic-overlay .ic-image').evaluate(e => getComputedStyle(e).visibility), 'visible')
    assert.deepEqual(errors, [])
    console.log('Shadow toggle, light height, normal view and original restoration passed')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
