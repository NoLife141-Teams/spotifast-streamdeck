import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = (await readdir(path.join(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'tests/' + name);
if (!tests.length) throw new Error('No test files found');
for (const args of [['--test', ...tests], ['streamdeck/settings.test.cjs']]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}