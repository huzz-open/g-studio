import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadDependency, indexArtifacts } from './dependency-download.mjs';
import { sha256 } from './download-file.mjs';

// OmegaConf requires this release, which PyPI publishes only as a source archive.
// Build this explicit pure-Python exception before the binary-only resolver runs.
export const SOURCE_WHEELS = [{
  name: 'antlr4-python3-runtime', version: '4.9.3',
  filename: 'antlr4-python3-runtime-4.9.3.tar.gz',
  url: 'https://files.pythonhosted.org/packages/3e/38/7859ff46355f76f8d19459005ca000b6e7012f2f1ca597746cbcd1fbfe5e/antlr4-python3-runtime-4.9.3.tar.gz',
  hash: 'f224469b4168294902bb1efa80a8bf7855f24c99aef99cbefc1bcd3cce77881b',
  wheel: 'antlr4_python3_runtime-4.9.3-py3-none-any.whl',
}];

export async function prepareSourceWheels({ home, python, requirements, sources, uvRun }, { download = downloadDependency } = {}) {
  const pins = (await readFile(requirements, 'utf8')).split(/\r?\n/).map(line => line.trim());
  const result = [];
  for (const source of SOURCE_WHEELS.filter(item => pins.includes(`${item.name}==${item.version}`))) {
    const directory = join(home, 'downloads', 'built-wheels');
    const path = join(directory, source.wheel), receipt = `${path}.json`;
    try {
      const cached = JSON.parse(await readFile(receipt, 'utf8'));
      if (cached.source === source.hash && cached.sha256 === await sha256(path)) {
        console.log(`[generation] Reusing verified locally built wheel: ${source.wheel}`);
        result.push({ name: source.name, path });
        continue;
      }
    } catch { /* Missing or damaged cache: rebuild from the verified archive. */ }
    const archive = await download(source, sources, join(home, 'downloads', 'sources'), { lookup: indexArtifacts });
    await mkdir(directory, { recursive: true });
    const staging = await mkdtemp(join(directory, '.build-'));
    let built = false, failure;
    try {
      const constraints = join(staging, 'build-constraints.txt');
      await writeFile(constraints, 'setuptools==78.1.0\n');
      for (const index of sources) {
        try {
          await uvRun(['build', archive, '--wheel', '--no-build-logs', '--python', python, '--out-dir', staging,
            '--build-constraints', constraints, '--default-index', index], `Building ${source.name} wheel`, true, 300000);
          const digest = await sha256(join(staging, source.wheel));
          await rename(join(staging, source.wheel), path);
          await writeFile(receipt, JSON.stringify({ source: source.hash, sha256: digest }));
          built = true;
          break;
        } catch (error) {
          failure = error;
          console.warn(`[generation] Source wheel build failed: ${error.message}; trying next source`);
        }
      }
      if (!built) throw failure || Error(`Cannot build ${source.name}`);
    } finally { await rm(staging, { recursive: true, force: true }); }
    result.push({ name: source.name, path });
  }
  return result;
}
