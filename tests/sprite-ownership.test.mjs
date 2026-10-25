import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restorePixelOwnership, groupNearbyLabels, extractOwnedRegions } from '../src/modules/sprite-slicer/core/detection/pixel-ownership.ts'
import { autoArrangeRects } from '../src/modules/sprite-slicer/core/layout/bin-packer.ts'

function fixture(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  const seeds = new Int32Array(w * h)
  function pixel(x, y, color, alpha = 255, label = 0) {
    const p = y * w + x
    rgba.set([...color, alpha], p * 4)
    seeds[p] = label
  }
  return { rgba, seeds, pixel }
}

test('overlapping bounding boxes keep separate pixels and original positions', () => {
  const { rgba, seeds, pixel } = fixture(18, 18)
  // Red L shape surrounds a blue square: their bounding boxes overlap deeply.
  for (let x = 1; x <= 15; x++) pixel(x, 1, [255, 0, 0], 255, 1)
  for (let y = 1; y <= 15; y++) pixel(1, y, [255, 0, 0], 255, 1)
  for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) pixel(x, y, [0, 0, 255], 255, 2)
  const owners = restorePixelOwnership(rgba, 18, 18, seeds)
  const groups = groupNearbyLabels(owners, 18, 18, 3)
  assert.equal(groups.length, 2)
  const regions = extractOwnedRegions(rgba, 18, owners, groups)
  assert.deepEqual(regions[0].rect, { x: 1, y: 1, w: 15, h: 15 })
  assert.deepEqual(regions[1].rect, { x: 8, y: 8, w: 5, h: 5 })
  assert.equal(regions[0].pixels[((8 - 1) * 15 + 8 - 1) * 4 + 3], 0)
  let covered = 0
  for (const r of regions) for (let i = 3; i < r.pixels.length; i += 4) if (r.pixels[i]) covered++
  assert.equal(covered, 29 + 25)
  const { arranged } = autoArrangeRects(regions.map(r => r.rect))
  const [a, b] = arranged
  assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
  // Layout must not mutate the source bounds or pixel data.
  assert.equal(regions[0].rect.x, 1)
  assert.equal(regions[0].pixels[((8 - 1) * 15 + 8 - 1) * 4 + 3], 0)
})

test('restores eroded tips and translucent edges without duplicating ownership', () => {
  const { rgba, seeds, pixel } = fixture(12, 6)
  for (let x = 1; x <= 5; x++) pixel(x, 2, [10, 20, 30], 255, x === 3 ? 1 : 0)
  pixel(6, 2, [20, 40, 60], 30)
  pixel(8, 2, [0, 0, 255], 255, 2)
  const owners = restorePixelOwnership(rgba, 12, 6, seeds)
  const regions = extractOwnedRegions(rgba, 12, owners, [[1], [2]])
  assert.deepEqual(regions[0].rect, { x: 1, y: 2, w: 6, h: 1 })
  assert.deepEqual([...regions[0].pixels.slice(-4)], [20, 40, 60, 30])
  assert.deepEqual(regions[1].rect, { x: 8, y: 2, w: 1, h: 1 })
})

test('recovers a thin sprite completely removed by erosion', () => {
  const { rgba, seeds, pixel } = fixture(12, 6)
  pixel(1, 1, [255, 0, 0], 255, 1)
  for (let x = 6; x < 10; x++) pixel(x, 4, [0, 0, 255])
  const owners = restorePixelOwnership(rgba, 12, 6, seeds)
  assert.equal(groupNearbyLabels(owners, 12, 6, 0).length, 2)
  assert.ok(owners[4 * 12 + 6] > 1)
})

test('merge gap is based on actual pixel distance, with zero disabling merging', () => {
  const owners = new Int32Array(10 * 3)
  owners[11] = 1; owners[14] = 2; owners[18] = 3
  assert.equal(groupNearbyLabels(owners, 10, 3, 0).length, 3)
  assert.equal(groupNearbyLabels(owners, 10, 3, 2).length, 3)
  assert.deepEqual(groupNearbyLabels(owners, 10, 3, 3), [[1, 2], [3]])
  assert.deepEqual(groupNearbyLabels(owners, 10, 3, 4), [[1, 2, 3]])
})

test('transparent image yields no regions', () => {
  const { rgba, seeds } = fixture(3, 3)
  const owners = restorePixelOwnership(rgba, 3, 3, seeds)
  assert.deepEqual(extractOwnedRegions(rgba, 3, owners, groupNearbyLabels(owners, 3, 3, 3)), [])
})

test('fallback keeps solid components separate across a soft alpha bridge', () => {
  const { rgba, seeds, pixel } = fixture(7, 3)
  pixel(1, 1, [255, 0, 0]); pixel(5, 1, [0, 0, 255])
  for (let x = 2; x <= 4; x++) pixel(x, 1, [80, 80, 80], 20)
  const owners = restorePixelOwnership(rgba, 7, 3, seeds)
  assert.notEqual(owners[8], owners[12])
  assert.ok(owners[10])
})
