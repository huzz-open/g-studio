import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

function probeNode(node) {
  const result = spawnSync(node, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const version = result.stdout?.trim() || '';
  if (!result.error && result.status === 0 && /^v\d+\.\d+\.\d+$/.test(version)) return { version };
  const reason = result.error?.message || (result.signal ? `terminated by ${result.signal}` : result.status === 0 ? 'unexpected version output' : `exit status ${result.status}`);
  const output = [result.stderr?.trim(), version && `stdout: ${version}`].filter(Boolean).join('; ').slice(0, 2000);
  return { error: `${reason}${output ? `; ${output}` : ''}` };
}

export function prepareBundledNode(node) {
  mkdirSync(dirname(node), { recursive: true });
  if (existsSync(node)) {
    // Copies between computers can lose executable permissions. Repair these
    // before deciding that an otherwise usable runtime needs replacing.
    if (process.platform !== 'win32') chmodSync(node, 0o755);
    // The shell already started this executable successfully. Do not probe or
    // overwrite the running binary; its version is available in this process.
    if (realpathSync(node) === realpathSync(process.execPath)) return process.version;
    const current = probeNode(node);
    if (current.version) return current.version;
  }

  // Replace via a new file rather than modifying a failed executable in place.
  const temporary = `${node}.${process.pid}.tmp`;
  try {
    copyFileSync(process.execPath, temporary);
    if (process.platform !== 'win32') chmodSync(temporary, 0o755);
    renameSync(temporary, node);
  } finally {
    rmSync(temporary, { force: true });
  }
  const copied = probeNode(node);
  if (!copied.version) throw Error(`Bundled Node could not start at "${node}": ${copied.error}. Source Node: "${process.execPath}" (${process.version}).`);
  return copied.version;
}
