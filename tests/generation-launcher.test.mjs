import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { platformInfo, runtimePaths } from '../scripts/generation/paths.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const shell = process.env.GENERATION_TEST_BASH || (process.platform === 'win32'
  ? resolve(spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).stdout.trim(), '../../../bin/bash.exe')
  : '/bin/sh');
const shellOptions = { skip: !existsSync(shell) && 'Set GENERATION_TEST_BASH to a working POSIX shell' };
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const posix = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'g-launcher with spaces-'));
  try { return run(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

function executable(path, source) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '#!/bin/sh\n' + source + '\n');
  chmodSync(path, 0o755);
}

// Like a package-manager build, this launcher depends on an adjacent file. It
// works in its installation directory but cannot be copied as one executable.
function installedNode(path) {
  executable(path, `test -f "$(dirname -- "$0")/node-library" || { echo 'missing adjacent Node library' >&2; exit 134; }
exec ${quote(process.execPath.replaceAll('\\', '/'))} "$@"`);
  writeFileSync(join(dirname(path), 'node-library'), 'fixture dependency');
}

function runLauncher(directory, { system = true, cached = 'broken', args = ['--offline', '--cpu'], platform = 'Darwin', arch = 'arm64' } = {}) {
  const bin = join(directory, 'installed node', 'bin');
  mkdirSync(bin, { recursive: true });
  executable(join(bin, 'uname'), `case "$1" in -s) echo ${quote(platform)} ;; -m) echo ${quote(arch)} ;; esac`);
  if (system === 'incompatible') executable(join(bin, 'node'), 'exit 1');
  else if (system) installedNode(join(bin, 'node'));
  const windows = /^(MINGW|MSYS|CYGWIN)/.test(platform);
  const tag = `${platform === 'Darwin' ? 'darwin' : windows ? 'win32' : 'linux'}-${['aarch64', 'arm64'].includes(arch) ? 'arm64' : 'x64'}`;
  const cachedNode = join(directory, 'runtime/generation/platforms', tag, 'node', windows ? 'node.exe' : 'node');
  const touched = join(directory, 'stale-node-was-executed');
  if (cached === 'broken') executable(cachedNode, `echo touched > ${quote(posix(touched))}; echo 'stale Node missing libnode' >&2; exit 134`);
  if (cached === 'working') installedNode(cachedNode);
  copyFileSync(join(root, 'start-generation.sh'), join(directory, 'start-generation.sh'));
  mkdirSync(join(directory, 'scripts/generation'), { recursive: true });
  for (const required of ['scripts/generation/bootstrap.mjs', 'services/generation-python/server.py', 'services/generation-python/requirements-base.lock', 'services/generation-python/requirements-model.lock']) {
    mkdirSync(dirname(join(directory, required)), { recursive: true });
    writeFileSync(join(directory, required), 'fixture');
  }
  writeFileSync(join(directory, 'scripts/generation/start.mjs'), 'console.log(JSON.stringify({ node: process.execPath, args: process.argv.slice(2), offline: process.env.GEN_OFFLINE }));');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GEN_')));
  const result = spawnSync(shell, ['-c', 'export PATH="$1:/usr/bin:/bin"; shift; exec /bin/sh "$@"', 'launcher-test', posix(bin), posix(join(directory, 'start-generation.sh')), ...args], {
    cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  return { result, cachedNode, touched };
}

for (const [platform, arch] of [['Darwin', 'arm64'], ['Linux', 'aarch64'], ['MINGW64_NT', 'x86_64']]) {
  test(`${platform} launcher uses installed Node in place and never probes a broken old cache`, shellOptions, () => fixture(directory => {
    const { result, cachedNode, touched } = runLauncher(directory, { platform, arch });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.node, process.execPath);
    assert.deepEqual(output.args, ['start', '--offline', '--cpu']);
    assert.equal(output.offline, '1');
    assert.equal(existsSync(touched), false, 'a stale cached Node must not be executed');
    assert.match(readFileSync(cachedNode, 'utf8'), /stale Node missing libnode/);
  }));
}

test('installed Node starts without creating a project Node cache and preserves explicit modes', shellOptions, () => fixture(directory => {
  const { result, cachedNode } = runLauncher(directory, { cached: false, args: ['doctor', '--cpu'] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()).args, ['doctor', '--cpu']);
  assert.equal(existsSync(dirname(cachedNode)), false);
}));

test('without an installed Node, offline startup can reuse the launcher download cache', shellOptions, () => fixture(directory => {
  const { result } = runLauncher(directory, { system: false, cached: 'working', args: ['--offline', '--base'] });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()).args, ['start', '--offline', '--base']);
}));

test('an incompatible installed Node falls back to the launcher cache', shellOptions, () => fixture(directory => {
  const { result } = runLauncher(directory, { system: 'incompatible', cached: 'working' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()).args, ['start', '--offline', '--cpu']);
}));

test('offline startup without any Node fails before preparing resources', shellOptions, () => fixture(directory => {
  const { result, cachedNode } = runLauncher(directory, { system: false, cached: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Offline: a working bundled Node runtime is missing/);
  assert.equal(existsSync(dirname(cachedNode)), false);
}));

test('a standalone start script reports missing source before creating resources or downloading anything', shellOptions, () => fixture(directory => {
  const script = join(directory, 'start-generation.sh');
  copyFileSync(join(root, 'start-generation.sh'), script);
  const result = spawnSync(shell, [script], { cwd: directory, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing project file: scripts\/generation\/start.mjs/);
  assert.match(result.stderr, /Use install-generation.sh/);
  assert.equal(existsSync(join(directory, 'runtime')), false);
}));

for (const stale of [false, true]) {
  test(`Python setup reaches its environment lock without ${stale ? 'touching stale' : 'creating'} Node files or fetching licenses`, () => fixture(directory => {
    const home = join(directory, 'resources'), dataHome = join(directory, 'private');
    const layout = runtimePaths(home, 'base');
    mkdirSync(layout.runtime, { recursive: true });
    writeFileSync(join(layout.runtime, 'environment.lock'), String(process.pid));
    const nodeDirectory = join(layout.platformHome, 'node');
    const oldNode = join(nodeDirectory, platformInfo().windows ? 'node.exe' : 'node');
    if (stale) {
      mkdirSync(nodeDirectory, { recursive: true });
      writeFileSync(oldNode, 'old broken Node with missing libraries');
    }
    const script = `
      globalThis.fetch = () => { throw Error('unexpected network access'); };
      const { preparePython } = await import(${JSON.stringify(new URL('../scripts/generation/bootstrap.mjs', import.meta.url).href)});
      try { await preparePython(); process.exitCode = 2; }
      catch (error) {
        if (!error.message.includes('Another environment setup is running')) throw error;
        console.log('Python environment lock reached');
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, GEN_HOME: home, GEN_DATA_HOME: dataHome, GEN_OFFLINE: '1', GEN_SKIP_MODEL: '1', GEN_DEVICE: 'cpu', GEN_PYTHON: '' },
      encoding: 'utf8', windowsHide: true, timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Python environment lock reached/);
    if (stale) assert.equal(readFileSync(oldNode, 'utf8'), 'old broken Node with missing libraries');
    else assert.equal(existsSync(nodeDirectory), false);
    assert.equal(existsSync(join(nodeDirectory, 'LICENSE')), false);
    assert.equal(existsSync(join(nodeDirectory, 'license-version.txt')), false);
  }));
}
