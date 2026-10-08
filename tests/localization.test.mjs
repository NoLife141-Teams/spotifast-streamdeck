import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import translations from '../streamdeck/ui/i18n.js';
import { spotifyUri, commandFor, parseNowPlaying } from '../src/core.mjs';
test('English and French contain the same complete catalog', () => {
  assert.deepEqual(Object.keys(translations.messages.en).sort(), Object.keys(translations.messages.fr).sort());
  for (const locale of Object.values(translations.messages)) for (const text of Object.values(locale)) assert.ok(text.length > 0);
});
test('automatic language, regional French and explicit overrides', () => {
  assert.equal(translations.resolveLanguage('auto', 'fr_CA'), 'fr');
  assert.equal(translations.resolveLanguage(undefined, 'fr-FR'), 'fr');
  assert.equal(translations.resolveLanguage('en', 'fr'), 'en');
  assert.equal(translations.resolveLanguage('fr', 'en'), 'fr');
  assert.equal(translations.resolveLanguage('auto', 'de'), 'en');
  assert.equal(translations.createTranslator('fr')('nowPlaying', { title: '<Track>' }), 'Lecture en cours : <Track>');
});
test('Spotify links and existing commands survive localization', () => {
  assert.equal(spotifyUri('https://open.spotify.com/intl-fr/playlist/example123?si=test'), 'spotify:playlist:example123');
  assert.deepEqual(commandFor('playlist', { uri: 'https://open.spotify.com/playlist/example123' }), ['play-uri', 'spotify:playlist:example123']);
  assert.deepEqual(commandFor('playpause'), ['play-pause']);
  assert.deepEqual(commandFor('nowplaying'), ['play-pause']);
  assert.deepEqual(commandFor('volume', { step: 5 }, -2), ['volume-down', '10']);
  assert.throws(() => spotifyUri('https://example.com/playlist/no'), error => error.messageKey === 'invalidUri');
  const raw = ['playing','Track','Artist','Album','123','456','59','on','off','https://i.scdn.co/example','no','Spotifast'].join('\t');
  assert.equal(parseNowPlaying(raw).device, 'Spotifast');
  assert.throws(() => parseNowPlaying('bad'), error => error.messageKey === 'unknownResponse');
});
test('every packaged action has both translations and keeps its UUID', async () => {
  const original = JSON.parse(await readFile(new URL('../streamdeck/manifest.json', import.meta.url), 'utf8'));
  const built = JSON.parse(await readFile(new URL('../build/rocks.spotifast.streamdeck.sdPlugin/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(built.Actions.map(a => a.UUID), original.Actions.map(a => a.UUID));
  for (const language of ['en','fr']) {
    const locale = JSON.parse(await readFile(new URL('../build/rocks.spotifast.streamdeck.sdPlugin/' + language + '.json', import.meta.url), 'utf8'));
    for (const action of built.Actions) {
      assert.ok(locale[action.UUID].Name);
      assert.ok(locale[action.UUID].Tooltip);
      if (action.Encoder) assert.ok(locale[action.UUID].Encoder.TriggerDescription.Rotate);
    }
  }
});
