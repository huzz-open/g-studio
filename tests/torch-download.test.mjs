import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { selectTorchWheel, downloadTorchWheels } from '../scripts/generation/torch-download.mjs';
import { downloadFile } from '../scripts/generation/download-file.mjs';

test('wheel selection requires the pinned version, platform, CUDA channel and checksum', () => {
  const index = 'https://mirror.example/cu124/torch/';
  const wheel = 'torch-2.6.0%2Bcu124-cp312-cp312-win_amd64.whl';
  const html = `<a href="../${wheel}#sha256=${'a'.repeat(64)}">torch</a>`;
  assert.equal(selectTorchWheel(html, index, 'torch', '2.6.0', 'win32-x64', 'cu124').url, `https://mirror.example/cu124/${wheel}`);
  for (const [platform, variant] of [['linux-x64', 'cu124'], ['win32-x64', 'cpu']]) {
    assert.throws(() => selectTorchWheel(html, index, 'torch', '2.6.0', platform, variant), /No pinned/);
  }
  assert.throws(() => selectTorchWheel(html.replace(`#sha256=${'a'.repeat(64)}`, ''), index, 'torch', '2.6.0', 'win32-x64', 'cu124'), /Missing SHA256/);
});

test('both wheels are downloaded to local wheel filenames with index checksums', async () => {
  const downloads = [];
  const result = await downloadTorchWheels('https://mirror.example/cu124', 'fixture', 'win32-x64', 'cu124', {
    fetchIndex: async url => {
      const name = url.includes('/torchvision/') ? 'torchvision' : 'torch';
      const version = name === 'torch' ? '2.6.0' : '0.21.0';
      return { ok: true, url, text: async () => `<a href="../${name}-${version}%2Bcu124-cp312-cp312-win_amd64.whl#sha256=${'a'.repeat(64)}">wheel</a>` };
    },
    download: async (...args) => downloads.push(args),
  });
  assert.equal(result.length, 2);
  assert.equal(downloads.length, 2);
  assert.ok(downloads.every(([url, path, hash]) => url.startsWith('https://mirror.example/') && result.includes(path) && hash === 'a'.repeat(64)));
});

test('a failed PyTorch source switches and the working source is reused for torchvision', async () => {
  const requests = [];
  await downloadTorchWheels('https://unavailable.example/cu124', 'fixture', 'win32-x64', 'cu124', {
    fetchIndex: async url => {
      requests.push(url);
      if (url.includes('unavailable')) throw Error('timeout');
      const name = url.includes('/torchvision/') ? 'torchvision' : 'torch';
      return { ok: true, url, text: async () => `<a href="../${name}-${name === 'torch' ? '2.6.0' : '0.21.0'}%2Bcu124-cp312-cp312-win_amd64.whl#sha256=${'a'.repeat(64)}">wheel</a>` };
    },
    download: async () => {},
  });
  assert.equal(requests.filter(url => url.includes('unavailable')).length, 1);
  assert.ok(requests.at(-1).startsWith('https://mirrors.nju.edu.cn/'));
});

test('a real resumed HTTP transfer displays measured speed and percentage on one line', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'torch-progress-'));
  const payload = Buffer.alloc(1024 * 1024, 42);
  const hash = createHash('sha256').update(payload).digest('hex');
  let range;
  const server = createServer(async (req, res) => {
    range = req.headers.range;
    const offset = Number(range?.match(/bytes=(\d+)-/)?.[1] || 0);
    res.writeHead(206, { 'Content-Length': payload.length - offset, 'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}` });
    for (let i = offset; i < payload.length; i += 65536) {
      res.write(payload.subarray(i, i + 65536));
      await delay(75);
    }
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const path = join(folder, 'test.whl');
    await writeFile(path + '.part', payload.subarray(0, 262144));
    const output = [];
    await downloadFile(`http://127.0.0.1:${server.address().port}/test.whl`, path, hash, {
      offline: false, attempts: 1,
      progressStream: { isTTY: true, columns: 120, write: text => output.push(text) },
    });
    assert.equal(range, 'bytes=262144-');
    const samples = output.filter(text => text.includes('MiB/s'));
    assert.ok(samples.length >= 2);
    assert.ok(samples.some(text => /[1-9]\d*\.\d%/.test(text)));
    assert.ok(samples.some(text => /0\.[1-9]\d MiB\/s/.test(text)), 'speed reflects newly transferred bytes, not cached bytes');
    assert.ok(output.every(text => !text.includes('\n')));
    const count = output.length;
    await delay(250);
    assert.equal(output.length, count);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
