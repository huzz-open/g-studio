import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { withProgress, formatDuration } from './progress.mjs';

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Bounded inactivity, resumable staging, and verification before publishing. */
export async function downloadFile(url, path, expected, { timeoutMs = 30000, attempts = 3, offline = process.env.GEN_OFFLINE === '1', progressStream = process.stderr } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(expected)) throw Error('A SHA256 checksum is required');
  if (await stat(path).catch(() => null)) console.log(`[generation] Verifying cached file: ${path}`);
  if (await stat(path).catch(() => null) && await sha256(path) === expected) return;
  if (await stat(path + '.part').catch(() => null) && await sha256(path + '.part') === expected) {
    await rename(path + '.part', path); return;
  }
  if (offline) throw Error(`Offline: missing verified download ${path}`);
  await mkdir(dirname(path), { recursive: true });
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const partial = path + '.part', controller = new AbortController();
    let timer, handle, received = (await stat(partial).catch(() => null))?.size || 0;
    let expectedSize = 0;
    let verifying = false;
    let transferred = 0, updated = performance.now();
    const samples = [[updated, 0]];
    const detail = () => {
      if (verifying) return 'Download complete; verifying SHA256';
      const now = performance.now();
      samples.push([now, transferred]);
      while (samples.length > 2 && samples[1][0] <= now - 2000) samples.shift();
      const speed = (transferred - samples[0][1]) / Math.max(0.001, (now - samples[0][0]) / 1000);
      const mib = bytes => `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
      const fraction = expectedSize ? Math.min(1, received / expectedSize) : 0;
      const filled = Math.floor(fraction * 16);
      const progress = expectedSize ? `[${'#'.repeat(filled)}${'-'.repeat(16 - filled)}] ${(fraction * 100).toFixed(1)}% | ${(received / 1024 ** 2).toFixed(2)}/${mib(expectedSize)}` : `${mib(received)} received`;
      const eta = expectedSize && speed > 0 ? formatDuration((expectedSize - received) / speed) : '--';
      const waiting = now - updated >= 5000 ? ` | waiting ${formatDuration((now - updated) / 1000)}` : '';
      return `${progress} | ${mib(speed)}/s | ETA ${eta}${waiting}`;
    };
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), timeoutMs); };
    try {
      await withProgress(`Downloading ${url.split('/').at(-1)} (${attempt}/${attempts})`, async () => {
        reset();
        const response = await fetch(url, { headers: received ? { Range: `bytes=${received}-` } : {}, signal: controller.signal });
        if (response.status === 416 && received) {
          controller.abort(); await rename(partial, partial + '.corrupt');
          throw Error('Stale partial download; retrying from the beginning');
        }
        if (!response.ok || !response.body) throw Error(`Download HTTP ${response.status}`);
        if (response.status === 206) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
          if (!range || Number(range[1]) !== received) { controller.abort(); throw Error('Invalid resumed response'); }
          expectedSize = Number(range[3]);
        } else {
          received = 0;
          expectedSize = Number(response.headers.get('content-length')) || 0;
        }
        handle = await open(partial, received ? 'a' : 'w');
        for await (const chunk of response.body) {
          reset();
          await handle.writeFile(chunk);
          received += chunk.length;
          transferred += chunk.length;
          updated = performance.now();
        }
        clearTimeout(timer);
        await handle.close(); handle = undefined;
        if (expectedSize && received !== expectedSize) throw Error('Incomplete download; partial file retained');
        verifying = true;
        if (await sha256(partial) !== expected) {
          // A corrupt complete file cannot be resumed. Keep it for diagnosis,
          // but start the next attempt from an empty staging file.
          await rename(partial, partial + '.corrupt');
          throw Error('Download checksum mismatch');
        }
        await rename(partial, path);
      }, detail, 200, progressStream);
      return;
    } catch (error) { failure = error; console.error(`[generation] Download attempt failed: ${error.message}`); }
    finally { clearTimeout(timer); controller.abort(); await handle?.close(); }
  }
  throw failure;
}

export async function checksumText(url, { timeoutMs = 30000, attempts = 3 } = {}) {
  let failure;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw Error(`Checksum HTTP ${response.status}`);
      const hash = (await response.text()).trim().split(/\s/)[0];
      if (!/^[a-f0-9]{64}$/i.test(hash)) throw Error('Invalid checksum response');
      return hash.toLowerCase();
    } catch (error) { failure = error; }
  }
  throw failure;
}
