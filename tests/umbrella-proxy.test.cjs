const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { buildUmbrella, DEFAULT_SHAPE } = require('../src/modules/experiments/umbrella/geometry.ts')
const { camera, transform } = require('../src/modules/experiments/umbrella/math.ts')
test('umbrella canopy is elevated, while only its thin pole reaches the ground', () => {
  const mesh = buildUmbrella(DEFAULT_SHAPE)
  const grounded = mesh.casterTriangles.flat().filter(p => p[1] < 1e-6)
  assert.ok(grounded.length > 0)
  assert.ok(grounded.every(p => Math.hypot(p[0], p[2]) <= 0.03501))
  assert.ok(mesh.casterTriangles.flat().some(p => Math.hypot(p[0], p[2]) > 1.1 && p[1] >= 2.07))
  const firstCanopyNormalY = mesh.vertices[mesh.groundVertices * 9 + 4]
  assert.ok(firstCanopyNormalY > 0, 'roof normals face upward')
})
test('ground picking matches projection for both camera modes', () => {
  for (const projection of ['orthographic', 'perspective']) {
    const c = camera({ projection, yaw: 25, pitch: 30, distance: 7 }, 1.4)
    for (const point of [[0, 0, 0], [1.5, 0, -2], [-1, 0, 1]]) {
      const clip = transform(c.matrix, point), picked = c.pickGround(clip[0] / clip[3], clip[1] / clip[3])
      assert.ok(picked)
      assert.ok(Math.hypot(...picked.map((v, i) => v - point[i])) < 1e-5)
    }
  }
})
