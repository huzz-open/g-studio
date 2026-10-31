import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairFailureGuard, clientAddress } from '../services/generation-relay/pair-security.ts';
import { PersistentFiles } from '../services/generation-relay/persistent-files.ts';
import { mkdtempSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('persistent results survive time, downloads and reload; only explicit deletion releases them', () => {
  const root=mkdtempSync(join(tmpdir(),'g-studio-retention-'));
  try {
    const files=new PersistentFiles(root,100);
    files.set('job.input',Buffer.alloc(40));files.set('job.output',Buffer.alloc(60,7));
    const lease=files.acquire('job.output')!;lease.release();lease.release();
    assert.equal(files.used,100);assert.ok(files.has('job.output'));
    utimesSync(join(root,'job.output'),new Date('2000-01-01'),new Date('2000-01-01'));
    const reloaded=new PersistentFiles(root,100);
    assert.deepEqual(reloaded.acquire('job.output')!.data,Buffer.alloc(60,7));
    assert.throws(()=>files.set('other.output',Buffer.alloc(1)),{code:'STORAGE_FULL'});
    assert.ok(existsSync(join(root,'job.output')),'capacity does not evict an existing result');
    const active=files.acquire('job.input')!;files.delete('job.input');
    assert.equal(files.has('job.input'),false);assert.equal(files.used,100);
    active.release();assert.equal(files.used,60);
    files.delete('job.output');assert.equal(files.used,0);
    assert.equal(new PersistentFiles(root,100).acquire('job.output'),undefined);
    assert.throws(()=>files.set('../escape.output',Buffer.alloc(1)));
  } finally {rmSync(root,{recursive:true,force:true})}
});
