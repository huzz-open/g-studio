import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { platformInfo, resourcePaths, runtimePaths } from '../scripts/generation/paths.mjs';
import { downloadFile } from '../scripts/generation/download-file.mjs';
import { chooseProfile } from '../scripts/generation/profiles.mjs';

test('profiles select CPU, NVIDIA CUDA and Apple MPS without advertising Intel/AMD GPU support', () => {
  assert.equal(chooseProfile({ platform: 'win32-x64', nvidia: true }).variant, 'cu124');
  assert.equal(chooseProfile({ platform: 'win32-x64', nvidia: false }).variant, 'cpu');
  assert.equal(chooseProfile({ platform: 'win32-x64', requested: 'cuda' }).variant, 'cu124');
  assert.equal(chooseProfile({ platform: 'darwin-arm64' }).variant, 'mps');
  assert.deepEqual(chooseProfile({platform:'darwin-arm64',requested:'cpu'}),{variant:'mps',requested:'cpu'});
  for (const requested of ['xpu','rocm']) assert.equal(chooseProfile({ platform: 'win32-x64', requested }).variant, 'cpu');
  assert.throws(() => chooseProfile({ platform: 'win32-x64', requested: 'mps' }));
  assert.throws(() => chooseProfile({ platform: 'darwin-arm64', requested: 'cuda' }));
  assert.deepEqual(chooseProfile({ platform: 'win32-x64', requested: 'cpu', nvidia: true }), { variant:'cpu', requested:'cpu' });
});

test('retired packaging commands fail before preparing resources', () => {
  const folder = mkdtempSync(join(tmpdir(), 'g-retired-commands-'));
  try {
    const home = join(folder, 'resources');
    const entry = fileURLToPath(new URL('../scripts/generation/start.mjs', import.meta.url));
    for (const mode of ['pack', 'pack-mac']) {
      const result = spawnSync(process.execPath, [entry, mode], { env:{...process.env, GEN_HOME:home, GEN_DATA_HOME:join(folder,'private')}, encoding:'utf8', windowsHide:true, timeout:15000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Use start, dev, download, prepare or doctor/);
      assert.equal(existsSync(home), false);
    }
  } finally { rmSync(folder, {recursive:true, force:true}); }
});

test('resources stay project-local, credentials separate, overrides remain explicit', () => {
  const project = resolve('fixture-project');
  assert.deepEqual(resourcePaths({}, project), { home: join(project, 'runtime/generation'), dataHome: join(project, 'runtime/generation-data') });
  assert.equal(resourcePaths({ GEN_HOME: project }).dataHome, project);
  assert.equal(resourcePaths({ GEN_HOME: project, GEN_DATA_HOME: join(project, 'private') }).dataHome, join(project, 'private'));
  const cpu = runtimePaths(project, 'cpu', platformInfo('darwin', 'arm64'));
  const cuda = runtimePaths(project, 'cu124', platformInfo('win32', 'x64'));
  assert.notEqual(cpu.runtime, cuda.runtime);
  assert.match(cpu.pythonRoot, /darwin-arm64/);
  assert.match(platformInfo('linux', 'arm64').uvTarget, /^aarch64-/);
  assert.throws(() => platformInfo('win32', 'arm64'));
});

test('download resumes partial files, checks integrity and makes zero requests for a valid offline cache', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'g-runtime-download-'));
  const payload = Buffer.from('verified portable runtime\n'.repeat(500));
  const hash = createHash('sha256').update(payload).digest('hex');
  let calls = 0, range;
  const server = createServer((req, res) => {
    calls++; range = req.headers.range;
    const offset = Number(range?.match(/bytes=(\d+)-/)?.[1] || 0);
    res.writeHead(offset ? 206 : 200, { 'Content-Length': payload.length - offset, ...(offset ? { 'Content-Range': `bytes ${offset}-${payload.length - 1}/${payload.length}` } : {}) });
    res.end(payload.subarray(offset));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/runtime`, path = join(folder, 'runtime.zip');
    writeFileSync(path + '.part', payload.subarray(0, 37));
    await downloadFile(url, path, hash, { offline: false, attempts: 1 });
    assert.equal(range, 'bytes=37-'); assert.deepEqual(readFileSync(path), payload);
    await downloadFile(url, path, hash, { offline: true });
    assert.equal(calls, 1);
    await assert.rejects(downloadFile(url, join(folder, 'missing'), hash, { offline: true }), /Offline/);
    assert.equal(calls, 1);
    await assert.rejects(downloadFile(url, join(folder, 'bad'), '0'.repeat(64), { offline: false, attempts: 1 }), /checksum/);
    assert.equal(existsSync(join(folder, 'bad')), false);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(folder, { recursive: true, force: true }); }
});

test('a stalled source times out instead of leaving startup waiting indefinitely', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'g-runtime-timeout-'));
  const server = createServer(() => {});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const start = Date.now();
    await assert.rejects(downloadFile(`http://127.0.0.1:${server.address().port}/stall`, join(folder, 'file'), '0'.repeat(64), { attempts: 1, timeoutMs: 80, offline: false }));
    assert.ok(Date.now() - start < 2500);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(folder, { recursive: true, force: true }); }
});
