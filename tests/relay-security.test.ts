import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairFailureGuard, clientAddress } from '../services/generation-relay/pair-security.ts';
import { EphemeralFiles } from '../services/generation-relay/ephemeral-files.ts';

test('five failed pairing attempts ban only that IP for 15 minutes', () => {
  let now = 1000;
  const guard = new PairFailureGuard(() => now);
  for (let i=0; i<4; i++) guard.failed('192.0.2.1');
  assert.throws(() => guard.failed('192.0.2.1'), { code:'PAIR_BLOCKED', status:429, retryAfter:900 });
  assert.throws(() => guard.check('192.0.2.1'), { code:'PAIR_BLOCKED' });
  guard.check('192.0.2.2');
  now += 900001;
  guard.check('192.0.2.1');
  guard.failed('192.0.2.1');
});

test('forwarded client IPs require trusted proxies and cannot be bypassed with leftmost spoofing', () => {
  assert.equal(clientAddress('192.0.2.1','198.51.100.7',[]),'192.0.2.1');
  assert.equal(clientAddress('::ffff:127.0.0.1','198.51.100.7',['127.0.0.1']),'198.51.100.7');
  assert.equal(clientAddress('127.0.0.1','203.0.113.9, 198.51.100.7',['127.0.0.1']),'198.51.100.7');
  assert.equal(clientAddress('127.0.0.1','garbage',['127.0.0.1']),'127.0.0.1');
});

test('transfer buffers release on completion and expiry, with live leases counted against quota', () => {
  let now=0;
  const files=new EphemeralFiles(100,()=>now);
  files.set('input',Buffer.alloc(40),1000);
  const lease=files.acquire('input')!;
  files.delete('input');
  assert.equal(files.has('input'),false);
  assert.equal(files.used,40);
  assert.throws(()=>files.reserve(61),{code:'STORAGE_FULL'});
  lease.release();lease.release();
  assert.equal(files.used,0);
  const release=files.reserve(80);
  assert.throws(()=>files.set('output',Buffer.alloc(21)),{code:'STORAGE_FULL'});
  release();release();
  files.set('output',Buffer.alloc(60),1000);
  now=1001; files.sweep();
  assert.equal(files.used,0);
  assert.equal(files.acquire('output'),undefined);
});
