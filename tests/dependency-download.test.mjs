import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadDependency, indexWheels } from '../scripts/generation/dependency-download.mjs';

test('failed mirrors fall back without changing the wheel, then successful mirror is preferred', async () => {
  const sources = ['https://slow.example/simple', 'https://fast.example/simple'];
  const wheel = { name: 'demo', filename: 'demo-1-py3-none-any.whl', url: 'https://slow.example/demo.whl', hash: 'a'.repeat(64) };
  const attempts = [];
  const options = {
    lookup: async source => [{ ...wheel, url: `${new URL(source).origin}/demo.whl` }],
    download: async (url, path, hash) => { attempts.push(url); assert.equal(hash, wheel.hash); if (url.includes('slow')) throw Error('timeout'); },
  };
  await downloadDependency(wheel, sources, 'fixture', options);
  assert.equal(sources[0], 'https://fast.example/simple');
  attempts.length = 0;
  await downloadDependency(wheel, sources, 'fixture', options);
  assert.deepEqual(attempts, ['https://fast.example/demo.whl']);
});

test('a fallback with different bytes is rejected', async () => {
  const wheel = { name: 'demo', filename: 'demo-1-py3-none-any.whl', url: 'https://slow.example/demo.whl', hash: 'a'.repeat(64) };
  let downloads = 0;
  await assert.rejects(downloadDependency(wheel, ['https://fast.example/simple'], 'fixture', {
    lookup: async () => [{ ...wheel, hash: 'b'.repeat(64) }],
    download: async () => { downloads++; throw Error('unavailable'); },
  }));
  assert.equal(downloads, 1);
});

test('index discovery keeps relative links, decodes names, and requires hashes', async () => {
  const wheels = await indexWheels('https://mirror.example/simple', 'demo', async () => ({
    ok: true, text: async () => `<a href="../../demo-1%2Bcpu-py3-none-any.whl#sha256=${'a'.repeat(64)}">ok</a><a href="bad.whl">bad</a>`,
  }));
  assert.equal(wheels.length, 1);
  assert.equal(wheels[0].filename, 'demo-1+cpu-py3-none-any.whl');
  assert.equal(wheels[0].url, 'https://mirror.example/demo-1%2Bcpu-py3-none-any.whl');
});
