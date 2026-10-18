import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';

const pluginName = 'rocks.spotifast.streamdeck.sdPlugin';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function safeEntry(name) {
  if (!name.startsWith(pluginName + '/') || name.includes('\\') || name.includes('\0')) throw new Error('Unsafe package entry');
  const relative = name.slice(pluginName.length + 1);
  if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Unsafe package entry');
  return relative;
}
async function expectedFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.name === '.sdignore' || entry.name === '.git' || entry.name.startsWith('.env') || entry.name.endsWith('.log') || entry.name.endsWith('.map') || relative.startsWith('logs/')) continue;
    if (entry.isSymbolicLink()) throw new Error('Package source must not contain symlinks');
    if (entry.isDirectory()) files.push(...await expectedFiles(path.join(directory, entry.name), relative + '/'));
    else files.push(relative);
  }
  return files.sort();
}
export async function verifyArchive(archive, source, destination) {
  const reader = new ZipReader(new Uint8ArrayReader(await readFile(archive)));
  const seen = new Set();
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      const relative = safeEntry(entry.filename);
      if (seen.has(relative.toLowerCase())) throw new Error('Duplicate package entry');
      seen.add(relative.toLowerCase());
      if (entry.uncompressedSize > 100 * 1024 * 1024) throw new Error('Oversized package entry');
      const data = await entry.getData(new Uint8ArrayWriter(), { checkSignature: true });
      const expected = await readFile(path.join(source, relative));
      if (relative === 'manifest.json') {
        const manifest = JSON.parse(expected); if (manifest.Nodejs) delete manifest.Nodejs.Debug;
        assert.deepEqual(JSON.parse(Buffer.from(data).toString()), manifest, 'Packaged manifest differs');
      } else assert.equal(hash(data), hash(expected), 'Packaged file differs: ' + relative);
      const target = path.join(destination, relative);
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data);
    }
    assert.deepEqual([...seen].sort(), (await expectedFiles(source)).map(name => name.toLowerCase()).sort(), 'Package omitted files');
    return { files: seen.size, sha256: hash(await readFile(archive)) };
  } finally { await reader.close(); }
}
export async function verifyPackage(root = process.cwd()) {
  const dist = path.join(root, 'dist');
  const candidates = (await readdir(dist)).filter(name => name.endsWith('.streamDeckPlugin'));
  assert.deepEqual(candidates, ['rocks.spotifast.streamdeck.streamDeckPlugin'], 'Expected exactly the canonical installer');
  const directory = await mkdtemp(path.join(tmpdir(), 'spotifast-package-'));
  try {
    const report = await verifyArchive(path.join(dist, candidates[0]), path.join(root, 'build', pluginName), directory);
    const result = spawnSync(process.execPath, ['--test', 'tests/sdk.test.mjs'], { cwd: root, env: { ...process.env, SPOTIFAST_PACKAGE_TEST_DIRECTORY: directory }, windowsHide: true, shell: false, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Installer SDK smoke test failed');
    await writeFile(path.join(dist, 'package-verification.json'), JSON.stringify({ ...report, node: process.version, platform: process.platform, sdkSmoke: 'passed', physicalHardware: 'not-tested' }, null, 2) + '\n');
    return report;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await verifyPackage());
