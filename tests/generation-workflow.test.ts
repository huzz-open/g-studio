import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jobStatus, jobRunning, latestPartJob } from '../src/shared/generation/job-state.ts'
import type { LocalJob } from '../src/shared/generation/jobs.ts'

const job = (overrides: Partial<LocalJob> = {}) => ({ localId: 'a', createdAt: 1, ...overrides }) as LocalJob
test('remote success is not completion until the model is available locally', () => {
  const remote = { id: 'r', status: 'succeeded' as const, phase: 'complete' }
  assert.equal(jobStatus(job({ remote })), 'receiving')
  assert.equal(jobStatus(job({ remote, resultRejected: true })), 'failed')
  assert.equal(jobStatus(job({ remote, model: { kind: 'mesh', size: [1, 1, 1] } })), 'succeeded')
  assert.equal(jobStatus(job()), 'undefined')
  assert.equal(jobStatus(job({ error: 'network unavailable' })), 'failed')
})
test('only active remote jobs can be cancelled; transient poll errors do not stop them', () => {
  for (const status of ['queued', 'running', 'cancel_requested'] as const) {
    assert.equal(jobRunning(job({ remote: { id: 'r', status, phase: 'sample' }, error: 'poll failed' })), true)
  }
  for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
    assert.equal(jobRunning(job({ remote: { id: 'r', status, phase: status } })), false)
  }
  assert.equal(jobRunning(job()), false)
})
test('part editors recover their newest associated job regardless of list order or entry menu', () => {
  const old = job({ source: { assetId: 'part-a', origin: 'scene' } })
  const latest = job({ localId: 'b', createdAt: 3, source: { assetId: 'part-a', origin: 'slicer' } })
  const other = job({ localId: 'c', createdAt: 5, source: { assetId: 'part-b', origin: 'scene' } })
  const standalone = job({ localId: 'd', createdAt: 7 })
  assert.equal(latestPartJob([old, other, latest, standalone], 'part-a'), latest)
  assert.equal(latestPartJob([latest, old, other], 'part-b'), other)
  assert.equal(latestPartJob([old, latest, standalone], 'missing'), undefined)
})

test('local optimization is an active generation stage, not a completed remote result',()=>{
 const remote={id:'r',status:'succeeded' as const,phase:'complete'}
 assert.equal(jobStatus(job({remote,optimizing:true})),'optimizing')
 assert.equal(jobRunning(job({remote,optimizing:true})),true)
 assert.equal(jobStatus(job({remote,postprocessCancelled:true,resultRejected:true})),'cancelled')
})
