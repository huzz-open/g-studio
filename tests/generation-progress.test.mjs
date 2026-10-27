import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { withProgress, fitProgress, formatDuration } from '../scripts/generation/progress.mjs';

test('narrow terminals retain measurements before decorative bars', () => {
  const detail = '[#####-----------] 25.0% | 600.00/2400.00 MiB | 8.32 MiB/s | ETA 3m 36s';
  const line = fitProgress(detail, 70);
  assert.ok(line.length < 70);
  assert.ok(line.includes('8.32 MiB/s'));
  assert.ok(line.includes('ETA 3m 36s'));
  assert.ok(!line.includes('[#####'));
  assert.equal(formatDuration(409), '6m 49s');
});

test('child stages and redirected logs do not emit periodic output', async (t) => {
  const messages = [];
  t.mock.method(console, 'log', message => messages.push(message));
  const stream = { isTTY: false, write() { assert.fail('Must not animate redirected output'); } };
  assert.equal(await withProgress('install', async () => { await delay(25); return 42; }, undefined, 5, stream), 42);
  await withProgress('download', () => delay(25), () => '10 MiB/s', 5, stream);
  assert.equal(messages.length, 4);
  assert.ok(messages.every(message => /starting|complete/.test(message)));
});

test('interactive progress updates in place and stops on completion and failure', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  for (const fail of [false, true]) {
    const writes = [];
    let rendered;
    const seen = new Promise(resolve => { rendered = resolve; });
    const stream = { isTTY: true, columns: 120, write(text) { writes.push(text); if (text.includes('MiB/s')) rendered(); } };
    const action = withProgress('download', async () => {
      await Promise.race([seen, delay(1000).then(() => { throw Error('No progress'); })]);
      if (fail) throw Error('download failed');
    }, () => '[#####---------------] 25% | 2 MiB/s', 5, stream);
    if (fail) await assert.rejects(action, /download failed/); else await action;
    assert.ok(writes.some(text => text.includes('25%')));
    assert.ok(writes.every(text => !text.includes('\n')));
    assert.equal(writes.at(-1), '\r\x1b[2K');
    const count = writes.length;
    await delay(25);
    assert.equal(writes.length, count);
  }
});
