import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generationDistribution } from '../scripts/generation/distribution.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const shell = process.env.GENERATION_TEST_BASH || (process.platform === 'win32'
  ? resolve(spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).stdout.trim(), '../../../bin/bash.exe')
  : '/bin/bash');
const options = { skip: !existsSync(shell) && 'Set GENERATION_TEST_BASH to Bash', timeout: 60000 };

async function fixture(run) {
  const folder = mkdtempSync(join(tmpdir(), "g-install with 'quote-"));
  const project = join(folder, 'source');
  for (const file of ['scripts/generation/start.mjs', 'scripts/generation/bootstrap.mjs', 'services/generation-python/server.py', 'services/generation-python/requirements-base.lock', 'services/generation-python/requirements-model.lock']) {
    mkdirSync(dirname(join(project, file)), { recursive: true }); writeFileSync(join(project, file), 'fixture');
  }
  copyFileSync(join(root, 'install-generation.sh'), join(project, 'install-generation.sh'));
  writeFileSync(join(project, 'start-generation.sh'), `#!/bin/sh
set -eu
mkdir -p "$GEN_DATA_HOME"
[ -f "$GEN_DATA_HOME/config.json" ] || printf 'private token' > "$GEN_DATA_HOME/config.json"
printf 'SOURCE_STARTED host=%s port=%s origins=%s\\n' "$GEN_HOST" "$GEN_PORT" "$GEN_ORIGINS"
`);
  const files = generationDistribution(project), requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const file = request.url.startsWith('/custom/app/') ? files.get(request.url.slice('/custom/app/'.length)) : undefined;
    response.writeHead(file ? 200 : 404); response.end(file);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = `http://127.0.0.1:${server.address().port}/custom/app/`;
  const directory = join(folder, "installed backend's files");
  async function install(args = [], piped = false) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GEN_|G_STUDIO_)/.test(key)));
    Object.assign(env, { http_proxy: '', https_proxy: '', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost' });
    return new Promise((resolve, reject) => {
      const child = spawn(shell, [...(piped ? ['-s', '--'] : [join(root, 'install-generation.sh')]), '--site', site, '--dir', directory, ...args], { env, windowsHide: true });
      if (piped) child.stdin.end(readFileSync(join(root, 'install-generation.sh')));
      let stdout = '', stderr = '';
      child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
      const timer = setTimeout(() => { child.kill(); reject(Error('Installer timed out')); }, 40000);
      child.on('error', reject);
      child.on('exit', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    });
  }
  try { await run({ project, directory, files, requests, install, site }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(folder, { recursive: true, force: true }); }
}

test('installer downloads verified sources from a subpath, preserves private data and reuses a completed installation', options, () => fixture(async ({ directory, requests, install, site }) => {
  const first = await install(['--host', '0.0.0.0', '--port', '9876'], true);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /SOURCE_STARTED host=0\.0\.0\.0 port=9876/);
  assert.ok(first.stdout.includes(new URL(site).origin));
  assert.equal(readFileSync(join(directory, 'data/config.json'), 'utf8'), 'private token');
  assert.equal(existsSync(join(directory, 'start.sh')), true);
  const second = await install(['--host', '0.0.0.0', '--port', '9876']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /SOURCE_STARTED/);
  assert.equal(requests.filter(value => value.endsWith('.tar.gz')).length, 1);
  assert.equal(readdirSync(join(directory, 'versions')).length, 1);
  assert.equal(readFileSync(join(directory, 'data/config.json'), 'utf8'), 'private token');
  assert.equal(readdirSync(directory).filter(value => value.startsWith('.install.')).length, 0);
}));

test('a failed source checksum leaves the previous installation and credentials intact', options, () => fixture(async ({ directory, files, install }) => {
  assert.equal((await install()).status, 0);
  const previous = readFileSync(join(directory, 'start.sh'), 'utf8');
  const hash = 'a'.repeat(64);
  files.set('generation-source.sha256', Buffer.from(`${hash}  source\n`));
  files.set(`generation-source-${hash}.tar.gz`, Buffer.from('corrupt source'));
  const result = await install();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source checksum mismatch/);
  assert.equal(readFileSync(join(directory, 'start.sh'), 'utf8'), previous);
  assert.equal(readFileSync(join(directory, 'data/config.json'), 'utf8'), 'private token');
}));

test('published source distribution excludes installed environments and credentials', () => {
  const files = generationDistribution(root);
  const archive = [...files.keys()].find(name => name.endsWith('.tar.gz'));
  const entries = spawnSync('tar', ['-tzf', '-'], { input: files.get(archive), encoding: 'utf8', windowsHide: true });
  assert.equal(entries.status, 0, entries.stderr);
  assert.match(entries.stdout, /services\/generation-python\/bundled\/wheels\/.+\.whl/);
  assert.doesNotMatch(entries.stdout, /node_modules|runtime\/generation|__pycache__|config\.json|\.venv/);
});
