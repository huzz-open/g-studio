const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { buildItem, buildRoom, createScene, DEFINITIONS, PITCH, YAW, ROOM, movementLimits, rayHit, spriteBounds } = require('../src/modules/scene-lighting/model.ts')
const { camera, transform } = require('../src/modules/experiments/umbrella/math.ts')
const { meshShadowSamples, roomShadowSamples } = require('../src/modules/scene-lighting/shadow-samples.ts')

test('landing samples stay on receiver surfaces after room resizing and environment changes', () => {
  const state = createScene()
  state.room = { width: 2.3, depth: 3.7, height: 1.1 }
  const open = roomShadowSamples(state)
  for (let i = 0; i < open.length; i += 6) {
    assert.equal(open[i + 1], 0)
    assert.deepEqual([...open.slice(i + 3, i + 6)], [0, 1, 0])
    assert.ok(open[i] > -5.5 && open[i] < -3.2 && open[i + 2] > -4 && open[i + 2] < -.3)
  }
  state.scene = 'corner'
  const corner = roomShadowSamples(state)
  assert.ok(corner.length > open.length)
  assert.deepEqual(corner.slice(0, open.length), open)
  for (let i = open.length; i < corner.length; i += 6) {
    assert.ok(corner[i + 1] > 0 && corner[i + 1] < state.room.height)
    assert.ok(corner[i] === -5.5 || corner[i + 2] === -4)
  }
})

test('asset landing points lie inside triangles with the matching surface normal', () => {
  for (const { id } of DEFINITIONS) {
    const mesh = buildItem(id), samples = meshShadowSamples(mesh)
    assert.equal(samples.length / 6, mesh.triangles.length)
    for (let i = 0; i < samples.length; i += 6) {
      const triangle = mesh.triangles[i / 6]
      for (let axis = 0; axis < 3; axis++) {
        const centroid = triangle.reduce((sum, p) => sum + p[axis], 0) / 3
        assert.ok(Math.abs(samples[i + axis] - centroid) < 1e-6)
      }
      assert.ok(Math.abs(Math.hypot(...samples.slice(i + 3, i + 6)) - 1) < 1e-5)
    }
  }
})

test('fixed 20-degree orthographic camera picks the ground at varied aspect ratios', () => {
  assert.equal(PITCH, 20)
  for (const aspect of [.7, 1.4, 2]) {
    const view = camera({ yaw: YAW, pitch: PITCH, distance: 14, projection: 'orthographic' }, aspect)
    for (const point of [[0, 0, 0], [-3, 0, 2], [4, 0, -2]]) {
      const clip = transform(view.matrix, point), actual = view.pickGround(clip[0] / clip[3], clip[1] / clip[3])
      assert.ok(actual && Math.hypot(...actual.map((n, i) => n - point[i])) < 1e-4)
    }
  }
})

test('all six meshes and paired original assets are finite and have valid dimensions', () => {
  for (const d of DEFINITIONS) {
    const mesh = buildItem(d.id), bounds = spriteBounds(mesh, d.width / d.height)
    assert.ok(mesh.triangles.length > 4)
    assert.equal(mesh.vertices.length, mesh.triangles.length * 27)
    assert.ok([...mesh.vertices].every(Number.isFinite))
    for (let i = 0; i < mesh.vertices.length; i += 9) {
      assert.ok(mesh.vertices[i + 1] >= -1e-5, `${d.id} below ground`)
      assert.ok(Math.abs(Math.hypot(...mesh.vertices.slice(i + 3, i + 6)) - 1) < 1e-5)
    }
    assert.ok(bounds.height > 0 && bounds.width > 0)
    assert.ok(Math.abs(bounds.width / bounds.height - d.width / d.height) < 1e-6)
    for (const suffix of ['', '-normal']) {
      const data = fs.readFileSync(path.join(__dirname, '../public/scene-lighting', d.id + suffix + '.png'))
      assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [d.width, d.height])
    }
  }
})

test('umbrella shades an elevated receiver but leaves air below its canopy open', () => {
  const triangles = buildItem('umbrella').triangles
  assert.notEqual(rayHit([.7, 5, 0], [.7, 1.5, 0], triangles), null, 'canopy shades another elevated object')
  assert.notEqual(rayHit([.7, 5, 0], [.7, 0, 0], triangles), null, 'canopy shades ground')
  assert.equal(rayHit([-4, .8, .6], [.6, .4, .6], triangles), null, 'light can travel beneath the canopy')
})

test('chair slat and leg gaps pass light while the solid back blocks it', () => {
  const triangles = buildItem('chair').triangles
  assert.equal(rayHit([.32, 1.55, 3], [.32, 1.55, -3], triangles), null)
  assert.notEqual(rayHit([0, 1.55, 3], [0, 1.55, -3], triangles), null)
  assert.equal(rayHit([.3, .5, 3], [.3, .5, -3], triangles), null)
})

test('the barrel casts on a wall receiver independently of the ground', () => {
  const triangles = buildItem('barrel').triangles
  assert.notEqual(rayHit([0, 2, 3], [0, .5, -4], triangles), null)
  assert.equal(rayHit([0, 2, 3], [4, .5, -4], triangles), null)
  assert.equal(buildRoom('open').triangles.length, 2)
  assert.equal(buildRoom('corner').triangles.length, 6)
})

test('mutual preset shades a vase with the umbrella without putting the pole inside the vase', () => {
  const state = createScene('mutual'), umbrella = state.items.find(i => i.id === 'umbrella'), vase = state.items.find(i => i.id === 'vase')
  const triangles = buildItem('umbrella').triangles.map(tri => tri.map(([x, y, z]) => [x + umbrella.x, y, z + umbrella.z]))
  assert.ok(Math.hypot(vase.x - umbrella.x, vase.z - umbrella.z) > .6)
  assert.notEqual(rayHit(state.light, [vase.x, 1.78, vase.z], triangles), null)
})

test('movement limits keep every proxy on the ground and inside both walls', () => {
  for (const d of DEFINITIONS) {
    const limits = movementLimits(d.id), vertices = buildItem(d.id).vertices
    for (const x of [limits.minX, limits.maxX]) for (const z of [limits.minZ, limits.maxZ]) {
      for (let i = 0; i < vertices.length; i += 9) {
        assert.ok(vertices[i] + x >= ROOM.minX + .049 && vertices[i] + x <= ROOM.maxX - .049)
        assert.ok(vertices[i + 2] + z >= ROOM.minZ + .049 && vertices[i + 2] + z <= ROOM.maxZ - .049)
      }
    }
  }
})

test('preset state is independent and contains only known props', () => {
  const first = createScene(), second = createScene()
  first.items[0].x = 99; first.light[0] = 99
  assert.notEqual(second.items[0].x, 99); assert.notEqual(second.light[0], 99)
  assert.deepEqual(second.items.map(i => i.id), DEFINITIONS.map(d => d.id))
})
