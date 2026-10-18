import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { safeEntry, verifyArchive } from '../scripts/verify-package.mjs';
const prefix = 'rocks.spotifast.streamdeck.sdPlugin/';
test('installer extraction rejects unsafe paths and foreign roots', () => {
  for (const name of ['../a', '/absolute', prefix + '../escape', prefix + 'a/../escape', prefix + 'C:/secret', prefix + 'a\\b', prefix + '/double']) assert.throws(() => safeEntry(name), /Unsafe/);
  assert.equal(safeEntry(prefix + 'bin/plugin.js'), 'bin/plugin.js');
});
test('installer must exactly contain tested files and license without omitted or altered bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'spotifast-verify-test-'));
  try {
    const source = path.join(root, 'source'); await mkdir(source);
    await writeFile(path.join(source, 'LICENSE'), 'MIT test'); await writeFile(path.join(source, '.sdignore'), '*.log');
    const archive = async entries => {
      const writer = new ZipWriter(new Uint8ArrayWriter());
      for (const [name, text] of entries) await writer.add(prefix + name, new Uint8ArrayReader(Buffer.from(text)));
      const file = path.join(root, 'test.zip'); await writeFile(file, await writer.close()); return file;
    };
    assert.equal((await verifyArchive(await archive([['LICENSE', 'MIT test']]), source, path.join(root, 'out'))).files, 1);
    await assert.rejects(verifyArchive(await archive([['LICENSE', 'changed']]), source, path.join(root, 'bad')), /differs/);
    await assert.rejects(verifyArchive(await archive([]), source, path.join(root, 'missing')), /omitted/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { validateReleaseNotes, prepareRelease } from '../scripts/prepare-release.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
test('release notes require both languages and no unfinished release blockers', () => {
  assert.equal(validateReleaseNotes('## English\nText\n## Français\nTexte'), '## English\nText\n## Français\nTexte');
  for (const text of ['## English\nOnly', '## English\nTODO\n## Français\nTexte']) assert.throws(() => validateReleaseNotes(text));
});
test('release staging refuses an installer changed after testing or the wrong runtime', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'spotifast-staging-test-'));
  try {
    await mkdir(path.join(root, 'dist')); await mkdir(path.join(root, 'releases'));
    await writeFile(path.join(root, 'package.json'), '{"version":"1.2.3"}'); await writeFile(path.join(root, 'LICENSE'), 'MIT');
    await writeFile(path.join(root, 'releases/v1.2.3.md'), '## English\nTest\n## Français\nTest');
    await writeFile(path.join(root, 'dist/rocks.spotifast.streamdeck.streamDeckPlugin'), 'tested');
    const report = { sha256: createHash('sha256').update('tested').digest('hex'), sdkSmoke: 'passed', platform: 'win32', node: 'v20.20.0' };
    const save = value => writeFile(path.join(root, 'dist/package-verification.json'), JSON.stringify(value));
    await save(report); await prepareRelease(root);
    assert.match(await readFile(path.join(root, 'dist/SHA256SUMS.txt'), 'utf8'), /  LICENSE\n/);
    await save({ ...report, node: 'v22.0.0' }); await assert.rejects(prepareRelease(root), /exact verified/);
    await save(report); await writeFile(path.join(root, 'dist/rocks.spotifast.streamdeck.streamDeckPlugin'), 'changed');
    await assert.rejects(prepareRelease(root), /exact verified/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('CI preserves required PR checks and gates publication on tag plus both runtime lanes', async () => {
  const workflow = await readFile(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  assert.match(workflow, /branches: \[main\]/); assert.match(workflow, /tags: \['v\*'\]/); assert.match(workflow, /\n  pull_request:\n/);
  assert.match(workflow, /node: \[20, 22\]/); assert.match(workflow, /\n  check:\n[\s\S]*needs: plugin_checks/);
  assert.match(workflow, /\n  publish:\n    if: github.event_name == 'push' && startsWith\(github.ref, 'refs\/tags\/v'\)\n    needs: check/);
  assert.match(workflow, /npm run package:verify/); assert.match(workflow, /matrix.node == 20\n        run: npm run release:prepare/);
  assert.match(workflow, /digest-mismatch: error/); assert.match(workflow, /sha256sum --check --strict SHA256SUMS.txt/);
  assert.match(workflow, /--verify-tag --prerelease/);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
});
