const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

// Compile the pure generator in memory; no browser or additional test dependency.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
}
const { generateNormals, distanceTransform } = require('../src/modules/sprite-slicer/core/normal/generator.ts')
const { DEFAULT_NORMAL_SETTINGS, normalSettings } = require('../src/shared/types/normal-settings.ts')
const variants = [{}, { detailStrength: 0, shapeRadius: 2, normalFormat: 'directx' },
  { shapeStrength: 0, detailScale: 1.4, detailStrength: 3, invertX: true, invertY: true }]

for (let i = 0; i < variants.length; i++) test(`matches pinned Rust reference, variant ${i}`, () => {
  const fixture = require(`./fixtures/normal-${i}.json`)
  const image = { width: fixture.width, height: fixture.height, data: new Uint8ClampedArray(fixture.input) }
  const actual = generateNormals(image, variants[i])
  let maxDifference = 0
  for (let p = 0; p < actual.data.length; p++) {
    const difference = Math.abs(actual.data[p] - fixture.normal[p])
    maxDifference = Math.max(maxDifference, difference)
    assert.ok(difference <= (p % 4 === 3 ? 0 : 1), `pixel channel ${p}: ${actual.data[p]} vs ${fixture.normal[p]}`)
  }
  assert.deepEqual([...image.data], fixture.input, 'source remains unmodified')
  console.log(`reference ${i}: max channel difference ${maxDifference}`)
})

test('distance transform matches exhaustive distances', () => {
  for (let h = 1; h < 9; h++) for (let w = 1; w < 11; w++) {
    const mask = Uint8Array.from({ length: w * h }, (_, i) => (i * 17 + w + h) % 7 !== 0 ? 1 : 0)
    const actual = distanceTransform(mask, w, h)
    for (let i = 0; i < mask.length; i++) {
      let expected = Infinity
      for (let j = 0; j < mask.length; j++) if (!mask[j]) expected = Math.min(expected, Math.hypot(i % w - j % w, Math.floor(i / w) - Math.floor(j / w)))
      assert.ok(actual[i] === expected || Math.abs(actual[i] - expected) < 1e-5)
    }
  }
})

test('hidden colors cannot affect visible normals; alpha is retained', () => {
  const data = new Uint8ClampedArray(8 * 8 * 4)
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) data.set([x * 35, y * 30, 100, x === 2 ? 80 : 255], (y * 8 + x) * 4)
  const baseline = generateNormals({ width: 8, height: 8, data })
  const modified = data.slice()
  for (let i = 0; i < modified.length; i += 4) if (!modified[i + 3]) modified.set([255, 0, 255], i)
  assert.deepEqual(generateNormals({ width: 8, height: 8, data: modified }).data, baseline.data)
  for (let i = 3; i < data.length; i += 4) assert.equal(baseline.data[i], data[i])
})

test('separate islands do not influence one another', () => {
  const data = new Uint8ClampedArray(12 * 7 * 4)
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 3; x++) data.set([100, 90, 80, 255], (y * 12 + x) * 4)
  const baseline = generateNormals({ width: 12, height: 7, data })
  for (let y = 1; y <= 5; y++) for (let x = 7; x <= 10; x++) data.set([250, 240, 220, 255], (y * 12 + x) * 4)
  const actual = generateNormals({ width: 12, height: 7, data })
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 3; x++) {
    const i = (y * 12 + x) * 4
    assert.deepEqual(actual.data.slice(i, i + 4), baseline.data.slice(i, i + 4))
  }
})

test('zero strength is neutral and invalid settings fail before allocation', () => {
  const image = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) }
  assert.deepEqual([...generateNormals(image, { normalStrength: 0 }).data], [128, 128, 255, 255])
  assert.throws(() => generateNormals(image, { detailScale: NaN }))
  assert.throws(() => generateNormals(image, { shapeRadius: 513 }))
  assert.throws(() => generateNormals({ ...image, width: 100000 }))
  assert.deepEqual(normalSettings(), DEFAULT_NORMAL_SETTINGS)
})
