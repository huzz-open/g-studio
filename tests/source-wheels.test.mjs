import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSourceWheels, SOURCE_WHEELS } from '../scripts/generation/source-wheels.mjs';
import { indexArtifacts, indexWheels } from '../scripts/generation/dependency-download.mjs';

test('source-only dependency is built once, reused offline, and rebuilt after corruption', async () => {
  const home = await mkdtemp(join(tmpdir(), 'g-source-wheel-'));
  const source = SOURCE_WHEELS[0];
  const requirements = join(home, 'requirements.txt');
  let downloads = 0, builds = 0;
  const options = { download: async (item, sources, directory, { lookup }) => {
    downloads++;
    assert.equal(item.hash, source.hash);
    assert.equal(lookup, indexArtifacts);
    return join(directory, item.filename);
  } };
  const config = { home, python: 'python', requirements, sources: ['https://example.test/simple'],
    uvRun: async (args, label, isolatedIndex, timeout) => {
      builds++;
      assert.equal(args[0], 'build');
      assert.ok(args.includes('--wheel'));
      assert.equal(isolatedIndex, true);
      assert.equal(timeout, 300000);
      assert.equal(await readFile(args[args.indexOf('--build-constraints') + 1], 'utf8'), 'setuptools==78.1.0\n');
      await writeFile(join(args[args.indexOf('--out-dir') + 1], source.wheel), 'built wheel');
    } };
  try {
    await writeFile(requirements, `# model requirements\n${source.name}==${source.version}\n`);
    const wheels = await prepareSourceWheels(config, options);
    assert.equal(wheels[0].name, source.name);
    assert.deepEqual(await prepareSourceWheels(config, { download: () => assert.fail('cache must not use network') }), wheels);
    assert.equal(builds, 1);
    await writeFile(wheels[0].path, 'corrupted');
    await prepareSourceWheels(config, options);
    assert.equal(await readFile(wheels[0].path, 'utf8'), 'built wheel');
    assert.equal(builds, 2);
    assert.equal(downloads, 2);
    await writeFile(requirements, 'numpy==1.26.4\n');
    assert.deepEqual(await prepareSourceWheels(config, options), []);
    assert.equal(builds, 2);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('archive discovery preserves checksums without offering sources to the wheel selector', async () => {
  const fetchIndex = async () => ({ ok: true, text: async () =>
    `<a href="demo.tar.gz#sha256=${'a'.repeat(64)}">source</a><a href="demo.whl#sha256=${'b'.repeat(64)}">wheel</a><a href="unchecked.tar.gz">unchecked</a>` });
  const artifacts = await indexArtifacts('https://example.test/simple', 'demo', fetchIndex);
  assert.deepEqual(artifacts.map(item => item.filename), ['demo.tar.gz', 'demo.whl']);
  const wheels = await indexWheels('https://example.test/simple', 'demo', fetchIndex);
  assert.deepEqual(wheels.map(item => item.filename), ['demo.whl']);
});
