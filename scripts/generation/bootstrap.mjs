import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync, unlinkSync, copyFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { cp } from 'node:fs/promises';
import { root, resourcePaths, platformInfo, runtimePaths } from './paths.mjs';
import { applyMirrorProfile, torchIndexArgs } from './mirrors.mjs';
import { withProgress } from './progress.mjs';
import { installUv } from './uv-download.mjs';
import { chooseProfile } from './profiles.mjs';
import { downloadTorchWheels } from './torch-download.mjs';
import { downloadDependencies } from './dependency-download.mjs';
export { root };
export const { home, dataHome } = resourcePaths();
export const managedChildren = new Set();
const info = platformInfo();
const mirrorProfile = applyMirrorProfile(root);
Object.assign(process.env, { GEN_HOME: home, GEN_DATA_HOME: dataHome, PYTHONIOENCODING: 'utf-8', PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', UV_CACHE_DIR: join(home, 'cache', info.tag), UV_LINK_MODE: 'copy' });
if (mirrorProfile === 'cn') console.log('[generation] China preset: Tsinghua PyPI, NJU PyTorch, ModelScope weights (explicit overrides take precedence). uv prefers Tsinghua with GitHub fallback. Node/Python runtime downloads may still use official sources.');
export function run(command, args, options = {}) {
  const { progressLabel, ...spawnOptions } = options;
  if (progressLabel) return withProgress(progressLabel, () => run(command, args, spawnOptions));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32', ...spawnOptions });
    managedChildren.add(child);
    child.on('error', error => { managedChildren.delete(child); reject(error); });
    child.on('exit', code => { managedChildren.delete(child); code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)); });
  });
}
function works(command, args = ['--version']) { return spawnSync(command, args, { stdio: 'ignore', windowsHide: true, timeout: 15000 }).status === 0; }
function assertOnline(resource) { if (process.env.GEN_OFFLINE === '1') throw Error(`Offline: ${resource} is missing or incompatible. Prepare resources on a connected machine first.`); }
function pythonIn(directory) { return join(directory, info.windows ? 'python.exe' : 'bin/python3'); }
function interpreters(directory) {
  const found = existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => pythonIn(join(directory, e.name))).filter(existsSync) : [];
  if (!info.windows) for (const python of found) chmodSync(python, 0o755);
  return found;
}
function inspect(python, requirements, variant) {
  const result = spawnSync(python, ['-I', join(root, 'services/generation-python/check_environment.py'), requirements, variant], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  try { return JSON.parse(result.stdout.trim().split('\n').at(-1)); }
  catch { return { ok: false, issues: [{ package: 'python', reason: result.error?.message || result.stderr?.trim() || 'Runtime probe failed' }] }; }
}
function ready(python, requirements, variant) {
  if (!existsSync(python)) return false;
  const report = inspect(python, requirements, variant);
  return report.ok && resolve(report.base) === resolve(report.prefix);
}
export function selectRuntime() {
  const profile = chooseProfile({ platform: info.tag, requested: process.env.GEN_DEVICE || 'auto', skip: process.env.GEN_SKIP_MODEL === '1',
    nvidia: process.platform !== 'darwin' && works('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']) });
  process.env.GEN_DEVICE = profile.requested;
  if (profile.reason) process.env.GEN_DEVICE_REASON = profile.reason;
  else delete process.env.GEN_DEVICE_REASON;
  if (profile.variant === 'base') process.env.GEN_SKIP_MODEL = '1';
  if (profile.reason) console.log(`[generation] ${profile.reason}`);
  return { ...profile, gpu: ['cuda', 'mps'].includes(profile.requested), info, ...runtimePaths(home, profile.variant, info) };
}
async function uvBinary(layout) {
  if (!info.windows && existsSync(layout.uv)) chmodSync(layout.uv, 0o755);
  if (existsSync(layout.uv) && works(layout.uv)) return layout.uv;
  mkdirSync(dirname(layout.uv), { recursive: true });
  for (const candidate of [join(home, 'tools', info.windows ? 'uv.exe' : 'uv'), join(root, '.generation-test/bootstrap-clean/tools', info.windows ? 'uv.exe' : 'uv')]) {
    if (existsSync(candidate) && works(candidate)) { copyFileSync(candidate, layout.uv); return layout.uv; }
  }
  if (works('uv')) return 'uv';
  assertOnline('uv');
  return installUv({ info, home, destination: layout.uv, run, validate: path => works(path) });
}
async function importLegacy(layout, requirements) {
  for (const directory of [join(home, 'venv'), join(root, '.generation-test/bootstrap-clean/venv'), join(homedir(), '.g-studio/generation/venv')]) {
    const python = join(directory, info.windows ? 'Scripts/python.exe' : 'bin/python');
    if (!existsSync(python)) continue;
    const report = inspect(python, requirements, layout.variant);
    if (!report.ok) continue;
    const destination = join(layout.pythonRoot, 'imported-cpython-3.12');
    console.log(`[generation] Importing local Python and dependencies from ${directory}`);
    await withProgress('Copying portable Python', () => cp(report.base, destination, { recursive: true, dereference: true }));
    const packages = info.windows ? 'Lib/site-packages' : 'lib/python3.12/site-packages';
    await withProgress('Copying verified Python dependencies', () => cp(join(directory, packages), join(destination, packages), { recursive: true, dereference: true }));
    const imported = pythonIn(destination);
    if (ready(imported, requirements, layout.variant)) return imported;
  }
}
export async function preparePython() {
  console.log(`[generation] Resources: ${home}\n[generation] Private data: ${dataHome}`);
  if (process.env.GEN_PYTHON) return resolve(process.env.GEN_PYTHON);
  const layout = selectRuntime();
  mkdirSync(layout.runtime, { recursive: true }); mkdirSync(dataHome, { recursive: true });
  const lock = join(layout.runtime, 'environment.lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8')); let alive = false;
    if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch {} }
    if (alive) throw Error('Another environment setup is running; retry after it completes.');
    unlinkSync(lock);
  }
  const fd = openSync(lock, 'wx'); writeFileSync(fd, String(process.pid)); closeSync(fd);
  try {
    const requirements = join(root, 'services/generation-python', layout.variant === 'base' ? 'requirements-base.lock' : 'requirements-model.lock');
    const stamp = createHash('sha256').update(readFileSync(requirements)).update(`portable-v1:${info.tag}:${layout.variant}:torch2.6.0:vision0.21.0`).digest('hex');
    const mark = python => {
      const path = relative(layout.runtime, python);
      if (path.startsWith('..') || isAbsolute(path)) throw Error('Python must be inside the portable runtime');
      writeFileSync(layout.marker, JSON.stringify({ version: 1, platform: info.tag, variant: layout.variant, stamp, python: path.split('\\').join('/') }, null, 2));
      return python;
    };
    let python = interpreters(layout.pythonRoot).find(p => ready(p, requirements, layout.variant));
    if (python) { console.log('[generation] Complete local runtime verified; no dependency downloads'); return mark(python); }
    python = await importLegacy(layout, requirements);
    if (python) return mark(python);
    // Reuse a local interpreter and common dependencies; replace only the torch
    // distribution in this separate destination, never mutate the CPU environment.
    if (!interpreters(layout.pythonRoot).length && layout.variant !== 'cpu') {
      const source = interpreters(runtimePaths(home, 'cpu', info).pythonRoot)[0];
      if (source && ready(source, requirements, 'cpu')) {
        const sourceRoot = info.windows ? dirname(source) : dirname(dirname(source));
        await withProgress('Reusing local Python and common dependencies', () => cp(sourceRoot, join(layout.pythonRoot, 'portable-cpython-3.12'), {
          recursive: true, dereference: true,
          filter: path => !/[/\\]site-packages[/\\](torch[^/\\]*|functorch)([/\\]|$)/.test(path),
        }));
      }
    }
    const uv = await uvBinary(layout);
    const env = { ...process.env, UV_PYTHON_INSTALL_DIR: layout.pythonRoot, RUST_LOG: 'error' };
    const uvRun = (args, label, torchIndex = false, timeout) => {
      const childEnv = { ...env };
      if (torchIndex) for (const name of ['UV_DEFAULT_INDEX', 'UV_INDEX_URL', 'UV_INDEX', 'UV_EXTRA_INDEX_URL']) delete childEnv[name];
      return run(uv, ['--no-config', ...(process.env.GEN_OFFLINE === '1' ? ['--offline'] : []), ...args], { env: childEnv, progressLabel: label, ...(timeout ? { timeout } : {}) });
    };
    python = interpreters(layout.pythonRoot).find(p => works(p, ['-I', '-c', 'import sys; assert sys.version_info[:2] == (3,12)']));
    if (!python) {
      assertOnline('Python 3.12');
      await uvRun(['python', 'install', '3.12.12', '--no-bin', ...(info.windows ? ['--no-registry'] : [])], 'Preparing portable Python 3.12');
      python = interpreters(layout.pythonRoot).find(p => works(p));
      if (!python) throw Error('Python installation did not produce a working interpreter');
    }
    const issues = inspect(python, requirements, layout.variant).issues || [];
    if (issues.length) {
      console.log('[generation] Local runtime needs repair:');
      for (const issue of issues) console.log(`[generation]   ${issue.package}: ${issue.reason}`);
    }
    const broken = [...new Set(issues.filter(i => !['python', 'torch', 'torchvision'].includes(i.package)).map(i => i.package))];
    const needsTorch = layout.variant !== 'base' && issues.some(i => ['torch', 'torchvision'].includes(i.package));
    if (process.env.GEN_OFFLINE !== '1' && (needsTorch || broken.length)) {
      const indexes = torchIndexArgs(root, layout.variant);
      const wheels = layout.variant === 'base' ? [] : await downloadTorchWheels(indexes[1], home, info.tag, layout.variant);
      const dependencies = await downloadDependencies({ root, home, python, platform: info.tag, requirements, torchWheels: wheels, repairPackages: broken, uvRun });
      await uvRun(['pip', 'install', '--python', python, '--break-system-packages', '--offline', '--no-index', '--no-deps', ...(needsTorch ? wheels : []), ...dependencies, ...[...broken, ...(needsTorch ? ['torch', 'torchvision'] : [])].flatMap(p => ['--reinstall-package', p])], 'Installing verified local dependencies');
    } else {
      if (needsTorch) await uvRun(['pip', 'install', '--python', python, '--break-system-packages', 'torch==2.6.0', 'torchvision==0.21.0', ...torchIndexArgs(root, layout.variant), '--reinstall-package', 'torch', '--reinstall-package', 'torchvision'], 'Preparing cached PyTorch', true);
      if (broken.length) await uvRun(['pip', 'install', '--python', python, '--break-system-packages', '-r', requirements, ...broken.flatMap(p => ['--reinstall-package', p])], 'Preparing cached Python dependencies');
    }
    if (!ready(python, requirements, layout.variant)) throw Error('Python dependency validation failed after repair');
    return mark(python);
  } finally { unlinkSync(lock); }
}
