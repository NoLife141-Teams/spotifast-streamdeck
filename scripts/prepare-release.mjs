import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function validateReleaseNotes(text) {
  if (!/^## English\s*$/m.test(text) || !/^## Français\s*$/m.test(text)) throw new Error('Release notes must include English and French sections');
  if (/\bTODO\b|\bTBD\b|<!--\s*release-blocker/i.test(text)) throw new Error('Release notes contain unfinished release blockers');
  return text;
}
export async function prepareRelease(root = process.cwd()) {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const notes = validateReleaseNotes(await readFile(path.join(root, 'releases', 'v' + metadata.version + '.md'), 'utf8'));
  const dist = path.join(root, 'dist'), installer = 'rocks.spotifast.streamdeck.streamDeckPlugin';
  const reportBytes = await readFile(path.join(dist, 'package-verification.json'));
  const report = JSON.parse(reportBytes);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const installerHash = digest(await readFile(path.join(dist, installer)));
  if (report.sha256 !== installerHash || report.sdkSmoke !== 'passed' || report.platform !== 'win32' || !report.node.startsWith('v20.')) throw new Error('Canonical release must be the exact verified Windows Node 20 installer');
  await copyFile(path.join(root, 'LICENSE'), path.join(dist, 'LICENSE'));
  await writeFile(path.join(dist, 'RELEASE_NOTES.md'), notes);
  // Bind publication to the bytes already checked above. If staging files are
  // replaced later, the publishing job must reject them rather than attest to
  // a replacement installer or verification report with a fresh checksum.
  const checksums = [[installer, installerHash], ['LICENSE', digest(await readFile(path.join(dist, 'LICENSE')))],
    ['RELEASE_NOTES.md', digest(notes)], ['package-verification.json', digest(reportBytes)]];
  const lines = checksums.map(([name, checksum]) => checksum + '  ' + name);
  await writeFile(path.join(dist, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await prepareRelease();
