import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareBundledNode } from '../scripts/generation/node-runtime.mjs';

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'g-node-runtime-'));
  try { return run(join(directory, process.platform === 'win32' ? 'node.exe' : 'node')); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('prepares a missing portable Node from the working host runtime', () => fixture(node => {
  assert.equal(prepareBundledNode(node), process.version);
  const result = spawnSync(node, ['-p', 'process.version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), process.version);
  assert.equal(existsSync(`${node}.${process.pid}.tmp`), false);
}));

test('replaces a broken copied binary and reuses the repaired runtime', () => fixture(node => {
  writeFileSync(node, 'invalid runtime copied from another computer');
  assert.equal(prepareBundledNode(node), process.version);
  const before = statSync(node);
  assert.equal(prepareBundledNode(node), process.version);
  const after = statSync(node);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.ino, before.ino);
}));

test('restores executable permissions without replacing a valid copied Node', { skip: process.platform === 'win32' }, () => fixture(node => {
  copyFileSync(process.execPath, node);
  chmodSync(node, 0o644);
  const before = statSync(node);
  assert.equal(prepareBundledNode(node), process.version);
  assert.equal(statSync(node).ino, before.ino);
  assert.equal(statSync(node).mode & 0o777, 0o755);
}));

test('reuses its own running bundled executable without spawning a version probe', () => fixture(node => {
  prepareBundledNode(node);
  const script = `
    import { syncBuiltinESMExports } from 'node:module';
    import childProcess from 'node:child_process';
    childProcess.spawnSync = () => { throw Error('must not probe the running executable'); };
    syncBuiltinESMExports();
    const { prepareBundledNode } = await import(${JSON.stringify(new URL('../scripts/generation/node-runtime.mjs', import.meta.url).href)});
    console.log(prepareBundledNode(process.execPath));
  `;
  const result = spawnSync(node, ['--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), process.version);
}));

test('reports the binary path and termination signal when the copied runtime cannot start', () => fixture(node => {
  const script = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = () => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: 'runtime blocked' });
    syncBuiltinESMExports();
    const { prepareBundledNode } = await import(${JSON.stringify(new URL('../scripts/generation/node-runtime.mjs', import.meta.url).href)});
    prepareBundledNode(${JSON.stringify(node)});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(node));
  assert.match(result.stderr, /terminated by SIGKILL; runtime blocked/);
  assert.match(result.stderr, /Source Node:/);
}));
