import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { root, home, run, selectRuntime } from './bootstrap.mjs';

export async function pack(python) {
  if (process.env.GEN_PYTHON) throw Error('Portable packing requires the managed project runtime; unset GEN_PYTHON.');
  const { info, variant, requested } = selectRuntime();
  const directory = join(root, 'runtime/bundles');
  mkdirSync(directory, { recursive: true });
  const output = join(directory, `g-studio-generation-${info.tag}-${variant}.zip`);
  await run(python, [join(root, 'scripts/generation/pack_runtime.py'), root, home, info.tag, variant, output], { env: {...process.env, GEN_BUNDLE_DEVICE:requested}, progressLabel: 'Packing portable backend (no credentials or task data)' });
  console.log(`[generation] Portable package: ${output}\n[generation] Extract, then run: sh start-generation.sh${variant === 'cpu' ? ' --cpu' : variant === 'base' ? ' --base' : ''}`);
}
