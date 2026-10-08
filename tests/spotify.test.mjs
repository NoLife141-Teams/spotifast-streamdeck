import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import links from '../streamdeck/ui/spotify.js';
import { spotifyUri, commandFor } from '../src/core.mjs';

test('the browser and command parser accept the same Spotify links and URIs', async () => {
  const browser = { URL };
  vm.runInNewContext(await readFile(new URL('../streamdeck/ui/spotify.js', import.meta.url), 'utf8'), browser);
  for (const type of ['playlist', 'album', 'track', 'artist', 'show']) {
    const uri = `spotify:${type}:ABC123`;
    for (const input of [uri, `  ${uri}  `, `https://open.spotify.com/${type}/ABC123`, `https://open.spotify.com/intl-fr/${type}/ABC123/?si=shared#fragment`]) {
      assert.equal(browser.SpotifastSpotify.spotifyUri(input), uri);
      assert.equal(links.spotifyUri(input), uri);
      assert.equal(spotifyUri(input), uri);
      assert.deepEqual(commandFor('playlist', { uri: input }), ['play-uri', uri]);
    }
  }
});

test('invalid Spotify input still cannot become a playback command', () => {
  for (const input of ['', '   ', null, undefined, 'spotify:playlist:', 'spotify:episode:ABC123', 'spotify:track:A B', 'spotify:track:ABC123;next', 'http://open.spotify.com/track/ABC123', 'https://open.spotify.com.evil.test/track/ABC123', 'https://example.com/track/ABC123', 'https://open.spotify.com/track/ABC123/extra', '<script>alert(1)</script>']) {
    assert.equal(links.spotifyUri(input), undefined);
    assert.throws(() => commandFor('playlist', { uri: input }), error => error.messageKey === 'invalidUri');
  }
});
