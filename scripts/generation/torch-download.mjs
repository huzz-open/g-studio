import { join } from 'node:path';
import { downloadFile } from './download-file.mjs';

// This runtime pins CPython 3.12 and these two package versions. Select only
// the exact ABI/platform/channel, never a generic PyPI or different CUDA wheel.
export function selectTorchWheel(html, index, name, version, platform, variant) {
  const suffix = {
    'win32-x64': 'cp312-cp312-win_amd64.whl',
    'linux-x64': 'cp312-cp312-linux_x86_64.whl',
    'linux-arm64': name === 'torch' ? 'cp312-cp312-manylinux_2_28_aarch64.whl' : 'cp312-cp312-linux_aarch64.whl',
    'darwin-arm64': name === 'torch' ? 'cp312-none-macosx_11_0_arm64.whl' : 'cp312-cp312-macosx_11_0_arm64.whl',
  }[platform];
  const local = platform.startsWith('darwin-') || (platform === 'linux-arm64' && name === 'torchvision' && variant === 'cpu') ? '' : `+${variant}`;
  const filename = `${name}-${version}${local}-${suffix}`;
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), index);
    if (!suffix || decodeURIComponent(url.pathname.split('/').at(-1)) !== filename) continue;
    const hash = /^#sha256=([a-f0-9]{64})$/i.exec(url.hash)?.[1];
    if (!hash) throw Error(`Missing SHA256 for ${filename}`);
    url.hash = '';
    if (!['https:', 'http:'].includes(url.protocol)) throw Error('Invalid wheel download URL');
    return { url: url.href, filename, hash };
  }
  throw Error(`No pinned ${name} wheel for ${platform}/${variant}/Python 3.12 at ${index}`);
}

export async function downloadTorchWheels(index, home, platform, variant, { fetchIndex = fetch, download = downloadFile } = {}) {
  const paths = [];
  const channel = variant === 'mps' ? 'cpu' : variant;
  const sources = [...new Set([index, `https://mirrors.nju.edu.cn/pytorch/whl/${channel}`, `https://mirror.sjtu.edu.cn/pytorch-wheels/${channel}`, `https://download.pytorch.org/whl/${channel}`])];
  for (const [name, version] of [['torch', '2.6.0'], ['torchvision', '0.21.0']]) {
    let failure, saved;
    for (const source of sources) {
      const page = `${source.replace(/\/$/, '')}/${name}/`;
      console.log(`[generation] Resolving ${name} download: ${page}`);
      try {
        const response = await fetchIndex(page, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error(`${name} index HTTP ${response.status}`);
        const wheel = selectTorchWheel(await response.text(), response.url || page, name, version, platform, variant);
        const path = join(home, 'downloads', 'torch', wheel.filename);
        await download(wheel.url, path, wheel.hash, { timeoutMs: 15000, attempts: 1 });
        paths.push(path);
        sources.splice(0, sources.length, source, ...sources.filter(item => item !== source));
        saved = true;
        break;
      } catch (error) {
        failure = error;
        console.warn(`[generation] ${name}: ${source} failed (${error.message}); trying next source`);
      }
    }
    if (!saved) throw failure;
  }
  return paths;
}
