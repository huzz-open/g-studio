import { readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { downloadFile, checksumText } from './download-file.mjs';

export const uvManifest = JSON.parse(readFileSync(new URL('./uv-wheels.json', import.meta.url), 'utf8'));

/** Extract only uv's pinned native executables; no Python installation is needed. */
export function uvExecutables(zip, windows, version = uvManifest.version) {
  let end = -1;
  for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) {
    if (zip.readUInt32LE(p) === 0x06054b50 && p + 22 + zip.readUInt16LE(p + 20) === zip.length) { end = p; break; }
  }
  if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) throw Error('Invalid uv wheel ZIP');
  const count = zip.readUInt16LE(end + 10);
  if (count > 256) throw Error('Unexpected uv wheel directory size');
  let cursor = zip.readUInt32LE(end + 16);
  const output = new Map(), names = windows ? ['uv.exe', 'uvw.exe', 'uvx.exe'] : ['uv', 'uvx'];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50) throw Error('Invalid ZIP directory');
    const size = zip.readUInt32LE(cursor + 24), compressed = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28), extra = zip.readUInt16LE(cursor + 30), comment = zip.readUInt16LE(cursor + 32);
    const filename = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const name = names.find(n => filename === `uv-${version}.data/scripts/${n}`);
    if (name) {
      const local = zip.readUInt32LE(cursor + 42), method = zip.readUInt16LE(cursor + 10);
      if (output.has(name) || zip.readUInt16LE(cursor + 8) & 1 || size > 160 * 1024 ** 2 || local + 30 > cursor || zip.readUInt32LE(local) !== 0x04034b50) throw Error('Invalid uv executable entry');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      if (start + compressed > cursor) throw Error('Invalid compressed executable bounds');
      const data = zip.subarray(start, start + compressed);
      const binary = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 160 * 1024 ** 2 }) : null;
      if (!binary || binary.length !== size) throw Error('Invalid uv executable size');
      output.set(name, binary);
    }
    cursor += 46 + nameLength + extra + comment;
  }
  if (!output.has(windows ? 'uv.exe' : 'uv')) throw Error('uv executable missing from wheel');
  return output;
}

export async function installUv({ info, home, destination, run, validate }, deps = {}) {
  const download = deps.download || downloadFile, checksum = deps.checksum || checksumText;
  mkdirSync(dirname(destination), { recursive: true });
  const entry = uvManifest.platforms[info.tag];
  try {
    if (!entry) throw Error(`No pinned uv wheel for ${info.tag}`);
    const wheel = join(home, 'downloads', entry.filename);
    console.log('[generation] uv source: Tsinghua mirror (official PyPI wheel, pinned SHA256)');
    await download(entry.mirror, wheel, entry.sha256, { attempts: 2 });
    const bytes = readFileSync(wheel);
    if (bytes.length !== entry.size) throw Error('uv wheel size mismatch');
    for (const [name, binary] of uvExecutables(bytes, info.windows)) {
      const path = join(dirname(destination), name);
      writeFileSync(path + '.part', binary); renameSync(path + '.part', path);
      if (!info.windows) chmodSync(path, 0o755);
    }
    if (!validate(destination)) throw Error('Mirrored uv failed its runtime check');
    return destination;
  } catch (error) {
    if (process.env.GEN_OFFLINE === '1') throw error;
    console.warn(`[generation] uv mirror unavailable: ${error.message}; falling back to GitHub`);
  }
  const name = `uv-${info.uvTarget}.${info.windows ? 'zip' : 'tar.gz'}`;
  const url = `https://github.com/astral-sh/uv/releases/download/${uvManifest.version}/${name}`;
  const archive = join(home, 'downloads', name), hashPath = archive + '.sha256';
  mkdirSync(dirname(archive), { recursive: true });
  const hash = existsSync(hashPath) ? readFileSync(hashPath, 'utf8').trim() : await checksum(url + '.sha256');
  writeFileSync(hashPath, hash);
  await download(url, archive, hash);
  if (info.windows) await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${dirname(destination).replaceAll("'", "''")}' -Force`]);
  else { await run('tar', ['-xzf', archive, '-C', dirname(destination), '--strip-components=1']); chmodSync(destination, 0o755); }
  if (!validate(destination)) throw Error('GitHub uv failed its runtime check');
  return destination;
}
