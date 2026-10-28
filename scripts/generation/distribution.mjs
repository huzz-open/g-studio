import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Source files only: no node_modules, installed runtimes, credentials or jobs. */
export function generationDistribution(root) {
  const archive = execFileSync('tar', [
    '-czf', '-', '--exclude=__pycache__', '--exclude=*.pyc', '--exclude=.venv',
    'start-generation.sh', 'scripts/generation', 'services/generation-python',
  ], { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const sha256 = createHash('sha256').update(archive).digest('hex');
  return new Map([
    ['install-generation.sh', readFileSync(join(root, 'install-generation.sh'))],
    ['generation-source.sha256', Buffer.from(`${sha256}  generation-source-${sha256}.tar.gz\n`)],
    [`generation-source-${sha256}.tar.gz`, archive],
  ]);
}
