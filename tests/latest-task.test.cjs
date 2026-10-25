const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { createLatestTask } = require('../src/shared/utils/latest-task.ts')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await sleep(2) } throw new Error('Timed out') }

test('serializes work, retains only latest pending input, and flushes the final value', async () => {
  const starts = [], applied = [], finishes = []
  let active = 0, maxActive = 0
  const task = createLatestTask({ interval: 40, acceptIntermediate: true,
    run: input => { starts.push(input); maxActive = Math.max(maxActive, ++active); return new Promise(resolve => finishes.push(() => { active--; resolve(input) })) },
    apply: value => applied.push(value),
  })
  task.request(1); await until(() => starts.length === 1)
  task.request(2); task.request(3); task.flush(); finishes.shift()()
  await until(() => starts.length === 2)
  assert.deepEqual(starts, [1, 3]); finishes.shift()(); await task.whenIdle()
  assert.deepEqual(applied, [1, 3]); assert.equal(maxActive, 1); task.dispose()
})
test('cancellation/disposal suppress late results even from uncooperative tasks', async () => {
  const applied = [], finishes = []
  const task = createLatestTask({ interval: 0, run: input => new Promise(resolve => finishes.push(() => resolve(input))), apply: value => applied.push(value) })
  task.request('old'); await until(() => finishes.length === 1); task.cancel()
  task.request('new'); await until(() => finishes.length === 2)
  finishes[0](); finishes[1](); await task.whenIdle(); assert.deepEqual(applied, ['new'])
  task.request('closed'); await until(() => finishes.length === 3); task.dispose(); finishes[2](); await sleep(5)
  assert.deepEqual(applied, ['new'])
})
test('commit-only and debounce policies can be flushed without waiting for a timer', async () => {
  for (const mode of ['commit', 'debounce']) {
    const applied = []
    const task = createLatestTask({ mode, interval: 1000, run: async value => value, apply: value => applied.push(value) })
    task.request(1); task.request(2); await sleep(5); assert.deepEqual(applied, [])
    task.flush(); await task.whenIdle(); assert.deepEqual(applied, [2]); task.dispose()
  }
})
test('adapts within bounds and recovers after a failed task', async () => {
  const errors = [], applied = []
  const task = createLatestTask({ interval: 1, adaptive: { min: 2, max: 10 },
    run: async value => { await sleep(30); if (value === 0) throw new Error('failure'); return value },
    apply: value => applied.push(value), onError: error => errors.push(error.message),
  })
  task.request(0); await task.whenIdle(); assert.deepEqual(errors, ['failure'])
  assert.equal(task.getState().interval, 10)
  task.request(1, true); await task.whenIdle(); assert.deepEqual(applied, [1]); task.dispose()
})
