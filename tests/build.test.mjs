import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('R12/R05: rebuilding removes obsolete output and preserves the release license and sibling files', async () => {
  const temporaryRoot = path.join(root, '.local-backups'); await mkdir(temporaryRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(temporaryRoot, 'build-test-'));
  try {
    for (const file of ['src', 'streamdeck', 'scripts', 'package.json', 'LICENSE']) await cp(path.join(root, file), path.join(fixture, file), { recursive: true });
    const build = () => execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: fixture, windowsHide: true, encoding: 'utf8', shell: false });
    build(); const output = path.join(fixture, 'build/rocks.spotifast.streamdeck.sdPlugin');
    await writeFile(path.join(output, 'ui/obsolete.txt'), 'obsolete'); const sibling = path.join(fixture, 'build/preserve.txt'); await writeFile(sibling, 'preserve'); build();
    await assert.rejects(access(path.join(output, 'ui/obsolete.txt')), error => error.code === 'ENOENT'); assert.equal(await readFile(sibling, 'utf8'), 'preserve');
    assert.equal(await readFile(path.join(output, 'LICENSE'), 'utf8'), await readFile(path.join(fixture, 'LICENSE'), 'utf8'));
    const metadata = JSON.parse(await readFile(path.join(fixture, 'package.json'), 'utf8')); const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')); assert.equal(manifest.Version, metadata.version + '.0');
    const notices = await readFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), 'utf8'); assert.match(notices, /@elgato\/schemas 0\.4\.16/);
  } finally {
    if (path.dirname(fixture) !== temporaryRoot || !path.basename(fixture).startsWith('build-test-')) throw new Error('Unsafe test cleanup path');
    await rm(fixture, { recursive: true, force: true });
  }
});