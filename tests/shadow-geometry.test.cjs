const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { buildShadowGeometry, projectOntoGround } = require('../src/modules/sprite-slicer/core/normal/shadow-geometry.ts')
test('point-light projection changes with light elevation, not an arbitrary shadow offset', () => {
  const low = projectOntoGround(10, 5, 2, { x: 0, y: 0, z: 4 })
  const high = projectOntoGround(10, 5, 2, { x: 0, y: 0, z: 10 })
  assert.deepEqual(low, { x: 20, y: 10 })
  assert.deepEqual(high, { x: 12.5, y: 6.25 })
  assert.equal(projectOntoGround(10, 5, 2, { x: 0, y: 0, z: 2 }), null)
})
test('a rectangle merges into four walls, with a hole adding four inward walls', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4)
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) pixels[(y * 8 + x) * 4 + 3] = 255
  assert.equal(buildShadowGeometry(pixels, 8, 8).edgeCount, 4)
  for (let y = 3; y < 5; y++) for (let x = 3; x < 5; x++) pixels[(y * 8 + x) * 4 + 3] = 0
  const geometry = buildShadowGeometry(pixels, 8, 8)
  assert.equal(geometry.edgeCount, 8)
  assert.equal(geometry.vertices.length, 8 * 6 * 3)
})
test('hidden color and nearly transparent remnants cannot become solid shadow walls', () => {
  const pixels = new Uint8ClampedArray([255, 255, 0, 1, 255, 0, 255, 127])
  assert.equal(buildShadowGeometry(pixels, 2, 1).edgeCount, 0)
  pixels[7] = 128
  assert.equal(buildShadowGeometry(pixels, 2, 1).edgeCount, 4)
})
