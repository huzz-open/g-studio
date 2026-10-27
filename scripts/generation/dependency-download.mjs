import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { downloadFile } from './download-file.mjs';
import { readMirrorProfile, CN_MIRRORS } from './mirrors.mjs';

export function pythonSources(root, env = process.env) {
  const domestic = [CN_MIRRORS.pythonIndex, 'https://mirrors.aliyun.com/pypi/simple'];
  return [...new Set([env.UV_DEFAULT_INDEX || env.UV_INDEX_URL, ...(readMirrorProfile(root) === 'cn' ? domestic : []), 'https://pypi.org/simple'].filter(Boolean))];
}

export async function indexWheels(index, name, fetchIndex = fetch) {
  const page = `${index.replace(/\/$/, '')}/${name.replaceAll('_', '-')}/`;
  const response = await fetchIndex(page, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Index HTTP ${response.status}`);
  const html = await response.text();
  return [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(match => {
    const url = new URL(match[1].replaceAll('&amp;', '&'), response.url || page);
    const hash = /^#sha256=([a-f0-9]{64})$/i.exec(url.hash)?.[1];
    const filename = decodeURIComponent(url.pathname.split('/').at(-1));
    url.hash = '';
    return { url: url.href, filename, hash };
  }).filter(wheel => wheel.filename.endsWith('.whl') && wheel.hash);
}

export async function downloadDependency(wheel, sources, directory, { download = downloadFile, lookup = indexWheels } = {}) {
  let failure;
  // Try the resolver's URL first. Fallback must match both filename and hash.
  const preferred = sources[0];
  const alternatives = sources.filter(source => new URL(source).host !== new URL(wheel.url).host);
  const order = preferred && new URL(preferred).host !== new URL(wheel.url).host ? [preferred, null, ...alternatives.filter(source => source !== preferred)] : [null, ...alternatives];
  for (const source of order) {
    try {
      const candidate = source ? (await lookup(source, wheel.name)).find(item => item.filename === wheel.filename && item.hash === wheel.hash) : wheel;
      if (!candidate) throw Error('Exact wheel/checksum absent from mirror');
      console.log(`[generation] ${wheel.filename}: ${new URL(candidate.url).host}`);
      const path = join(directory, wheel.filename);
      await download(candidate.url, path, wheel.hash, { attempts: 1, timeoutMs: 15000 });
      if (source) sources.splice(0, sources.length, source, ...sources.filter(item => item !== source));
      return path;
    } catch (error) {
      failure = error;
      console.warn(`[generation] ${wheel.name}: source unavailable (${error.message}); trying next source`);
    }
  }
  throw failure;
}

export async function downloadDependencies({ root, home, python, platform, requirements, torchWheels = [], uvRun }) {
  const sources = pythonSources(root);
  const directory = join(home, 'downloads', 'wheels');
  const work = join(home, 'platforms', platform, 'dependency-plan');
  await mkdir(work, { recursive: true });
  // Bootstrap the tag parser as a pure Python wheel, also through the measured downloader.
  let packaging, failure;
  for (const source of sources) {
    try {
      console.log(`[generation] Resolving wheel compatibility helper: ${source}`);
      const wheel = (await indexWheels(source, 'packaging')).find(item => item.filename === 'packaging-26.3-py3-none-any.whl');
      if (!wheel) throw Error('Pinned packaging wheel unavailable');
      packaging = await downloadDependency({ ...wheel, name: 'packaging' }, sources, directory);
      break;
    } catch (error) { failure = error; console.warn(`[generation] Compatibility helper source failed: ${error.message}`); }
  }
  if (!packaging) throw failure;
  const input = join(work, 'requirements.in'), lock = join(work, 'pylock.toml');
  await writeFile(input, [`-r ${requirements.replaceAll('\\', '/')}`, ...torchWheels.map(path => path.replaceAll('\\', '/'))].join('\n') + '\n');
  let resolved = false;
  for (const source of sources) {
    try {
      console.log(`[generation] Resolving complete dependency list: ${source} (60s limit)`);
      await uvRun(['pip', 'compile', input, '--python', python, '--python-version', '3.12', ...(platform === 'darwin-arm64' ? ['--python-platform', 'aarch64-apple-darwin'] : []), '--only-binary', ':all:', '--format', 'pylock.toml', '-o', lock, '--default-index', source, '--quiet'], 'Resolving Python dependencies', true, 60000);
      sources.splice(0, sources.length, source, ...sources.filter(item => item !== source));
      resolved = true; break;
    } catch (error) { failure = error; console.warn(`[generation] Resolver source failed: ${error.message}; trying next source`); }
  }
  if (!resolved) throw failure;
  const selection = spawnSync(python, ['-I', join(root, 'scripts/generation/select-wheels.py'), packaging, lock, platform], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 ** 2 });
  if (selection.status !== 0) throw Error(selection.stderr || selection.error?.message || 'Wheel selection failed');
  const wheels = JSON.parse(selection.stdout), paths = [];
  console.log(`[generation] Downloading ${wheels.length} dependencies with byte progress and MiB/s`);
  for (let i = 0; i < wheels.length; i++) {
    console.log(`[generation] Dependency ${i + 1}/${wheels.length}: ${wheels[i].name}`);
    paths.push(await downloadDependency(wheels[i], sources, directory));
  }
  return paths;
}
