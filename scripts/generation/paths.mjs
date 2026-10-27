import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export function resourcePaths(env = process.env, project = root) {
  const home = resolve(env.GEN_HOME || join(project, 'runtime/generation'));
  const dataHome = resolve(env.GEN_DATA_HOME || (env.GEN_HOME ? home : join(project, 'runtime/generation-data')));
  return { home, dataHome };
}
export function platformInfo(platform = process.platform, arch = process.arch) {
  const targets = {
    'win32-x64': 'x86_64-pc-windows-msvc',
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
  };
  const tag = `${platform}-${arch}`;
  if (!targets[tag]) throw Error(`Unsupported generation platform: ${tag}`);
  return { tag, uvTarget: targets[tag], windows: platform === 'win32' };
}
export function runtimePaths(home, variant, info = platformInfo()) {
  if (!['cpu', 'cu124', 'mps', 'base'].includes(variant)) throw Error('Invalid runtime variant');
  const platformHome = join(home, 'platforms', info.tag);
  const runtime = join(platformHome, `python-${variant}`);
  return { platformHome, runtime, pythonRoot: join(runtime, 'python'), marker: join(runtime, 'environment.json'),
    uv: join(platformHome, 'tools', info.windows ? 'uv.exe' : 'uv'),
    node: join(platformHome, 'node', info.windows ? 'node.exe' : 'node') };
}
