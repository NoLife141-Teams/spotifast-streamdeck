import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm, lstat }  from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import translations from '../streamdeck/ui/i18n.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build', 'rocks.spotifast.streamdeck.sdPlugin');
// Delete only this generated plugin directory; never follow a junction into another tree.
const buildRoot = path.join(root, 'build');
if (path.dirname(output) !== buildRoot || path.basename(output) !== 'rocks.spotifast.streamdeck.sdPlugin') throw new Error('Unsafe build output');
for (const directory of [buildRoot, output]) {
  try { if ((await lstat(directory)).isSymbolicLink()) throw new Error('Build directory must not be a symlink: ' + directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'bin'), { recursive: true });
await cp(path.join(root, 'streamdeck/ui'), path.join(output, 'ui'), { recursive: true });
await cp(path.join(root, 'streamdeck/imgs'), path.join(output, 'imgs'), { recursive: true });
await cp(path.join(root, 'LICENSE'), path.join(output, 'LICENSE'));
const manifest = JSON.parse(await readFile(path.join(root, 'streamdeck/manifest.json'), 'utf8'));
manifest.Version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version + '.0';
manifest.Author = 'NoLife141-Teams';
manifest.Description = translations.messages.en.description;
for (const action of manifest.Actions) {
  const id = action.UUID.split('.').pop();
  action.Name = translations.messages.en['action_' + id];
  action.Tooltip = id === 'volume' ? translations.messages.en.dialTooltip : 'Spotifast: ' + action.Name;
  if (action.Encoder) action.Encoder.TriggerDescription = { Rotate: translations.messages.en.rotate, Push: translations.messages.en.push, Touch: translations.messages.en.touch };
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const language of ['en', 'fr']) {
  const t = translations.createTranslator(language);
  const locale = { Name: 'Spotifast', Description: t('description'), Localization: translations.messages[language] };
  for (const action of manifest.Actions) {
    const id = action.UUID.split('.').pop();
    locale[action.UUID] = { Name: t('action_' + id), Tooltip: id === 'volume' ? t('dialTooltip') : 'Spotifast: ' + t('action_' + id) };
    if (action.Encoder) locale[action.UUID].Encoder = { TriggerDescription: { Rotate: t('rotate'), Push: t('push'), Touch: t('touch') } };
  }
  await writeFile(path.join(output, language + '.json'), JSON.stringify(locale, null, 2) + '\n');
}
await writeFile(path.join(output, 'package.json'), '{ "type": "commonjs" }\n');
await writeFile(path.join(output, '.sdignore'), 'logs/\n*.log\n*.map\n');
const runtimePackages = ['@elgato/streamdeck', '@elgato/schemas', '@elgato/utils', 'ws', 'zod', 'opentype.js'];
const requireFromRoot = createRequire(import.meta.url);
const requireFromSdk = createRequire(requireFromRoot.resolve('@elgato/streamdeck'));
async function packageDirectory(dependency) {
  let directory = path.dirname((dependency === 'opentype.js' || dependency === '@elgato/streamdeck' ? requireFromRoot : requireFromSdk).resolve(dependency));
  while (directory !== path.dirname(directory)) {
    try { const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); if (metadata.name === dependency) return directory; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    directory = path.dirname(directory);
  }
  throw new Error('Dependency metadata not found: ' + dependency);
}
let notices = 'Third-party licenses bundled with Spotifast Stream Deck\n\n';
for (const dependency of runtimePackages) {
  const directory = await packageDirectory(dependency);
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const license = await readFile(path.join(directory, 'LICENSE'), 'utf8');
  notices += dependency + ' ' + metadata.version + '\n' + license + '\n\n';
}
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
await build({ entryPoints: [path.join(root, 'src/plugin.mjs')], outfile: path.join(output, 'bin/plugin.js'), bundle: true, platform: 'node', format: 'cjs', target: 'node20', legalComments: 'eof' });
console.log('Built ' + path.relative(root, output) + ' (English + French)');
