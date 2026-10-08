import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ArtworkRenderer, fitCaption, captionSvg, scrollOffset, formatRemaining } from '../src/artwork.mjs';
import { remainingTime, parseNowPlaying } from '../src/core.mjs';

const renderer = new ArtworkRenderer({ fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
test('title and artist use real font widths and stay inside 60 pixels', async () => {
  const fonts = await renderer.fonts;
  assert.ok(fonts.regular, 'Windows Arial font must load');
  assert.ok(fonts.bold, 'Windows Arial Bold font must load');
  for (const name of ['Perfect', 'Kaley, LYON', 'Éléonore et François', 'WWWWWWWWWWWWWW', 'An exceptionally long song title with multiple artists']) {
    const font = name === 'Perfect' ? fonts.bold : fonts.regular;
    const line = fitCaption(name, font);
    assert.ok(line.width <= 60, name + ' overflowed');
    assert.ok(line.size >= 8.5, 'Text became too small');
  }
  assert.equal(fitCaption('Perfect', fonts.bold).text, 'Perfect');
  assert.equal(fitCaption('Kaley, LYON', fonts.regular, { maxSize: 9 }).text, 'Kaley, LYON');
  assert.match(fitCaption('WWWWWWWWWWWWWW', fonts.bold).text, /…$/);
});

test('scrolling keeps full Unicode text, holds both ends and leaves short lines stationary', async () => {
  const fonts = await renderer.fonts;
  const long = 'A very long song title with a readable ending 🎵';
  const first = captionSvg('', long, 'Artist', fonts, { scrollText: true, elapsedMs: 0 });
  const held = captionSvg('', long, 'Artist', fonts, { scrollText: true, elapsedMs: 1500 });
  const moved = captionSvg('', long, 'Artist', fonts, { scrollText: true, elapsedMs: 4000 });
  assert.equal(first, held);
  assert.notEqual(first, moved);
  assert.ok(moved.includes(long));
  assert.ok(!moved.includes('…'));
  assert.ok(moved.includes('clip-path="url(#track)"'));
  assert.equal(captionSvg('', 'Short', 'Artist', fonts, { scrollText: true }), captionSvg('', 'Short', 'Artist', fonts, { scrollText: true, elapsedMs: 10000 }));
  assert.equal(scrollOffset(60, 5000), 0);
  assert.equal(scrollOffset(120, 1800), 0);
  assert.equal(scrollOffset(120, 6800), 60);
  assert.equal(scrollOffset(120, 8000), 60);
  assert.equal(scrollOffset(120, 8600), 0);
  assert.equal(scrollOffset(120, NaN), 0);
});

test('remaining time uses milliseconds, pauses with playback and hides unknown durations', () => {
  const snapshot = parseNowPlaying('playing\tTrack\tArtist\tAlbum\t52828\t154870\t59\ton\toff');
  assert.equal(formatRemaining(remainingTime(snapshot)), '-1:43');
  assert.equal(formatRemaining(remainingTime(snapshot, 1500)), '-1:41');
  assert.equal(remainingTime({ ...snapshot, state: 'paused' }, 4000), 102042);
  assert.equal(remainingTime({ ...snapshot, state: 'stopped' }), undefined);
  assert.equal(remainingTime({ ...snapshot, duration: 0 }), undefined);
  assert.equal(remainingTime({ ...snapshot, position: 200000 }), 0);
  assert.equal(remainingTime(snapshot, 60000), remainingTime(snapshot, 5000));
  for (const [value, expected] of [[0, '-0:00'], [1, '-0:01'], [60000, '-1:00'], [3600000, '-1:00:00'], [NaN, ''], [undefined, '']]) assert.equal(formatRemaining(value), expected);
});

test('timer can appear without captions and animation caches remain bounded', async () => {
  const fallback = new ArtworkRenderer({ loadFonts: async () => ({}), fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
  const timer = await fallback.render('', 'Title', 'Artist', { showText: false, remainingMs: 154000 });
  const svg = Buffer.from(timer.split(',')[1], 'base64').toString();
  assert.ok(svg.includes('-2:34'));
  assert.ok(!svg.includes('<g clip-path="url(#caption)">'));
  assert.equal(timer, await fallback.render('', 'Title', 'Artist', { showText: false, remainingMs: 154000, elapsedMs: 5000 }));
  for (let i = 0; i < 40; i++) await fallback.render('', 'Long title '.repeat(i + 1), 'Artist', { scrollText: true, elapsedMs: i * 200, remainingMs: 154000 - i * 1000 });
  assert.ok(fallback.cache.size <= 8);
  assert.ok(fallback.layouts.size <= 8);
});
test('multiline and Unicode names form one safe line without split graphemes', () => {
  assert.equal(fitCaption('  First\nSecond\tLine  ', undefined, { maxWidth: 400 }).text, 'First Second Line');
  const emoji = fitCaption('👨‍👩‍👧‍👦'.repeat(20), undefined);
  assert.match(emoji.text, /…$/);
  assert.ok(emoji.width <= 60);
  assert.equal(emoji.text.slice(0, -1), '👨‍👩‍👧‍👦'.repeat(2));
  const svg = captionSvg('https://example.com/image.jpg', '<script>& title', 'Artist "name"');
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('https://example.com'));
  assert.ok(svg.includes('&lt;script&gt;&amp; title'));
});
test('caption image is self-contained, cached, and works if fonts are unavailable', async () => {
  const svg = Buffer.from((await renderer.render(undefined, 'Perfect', 'Kaley, LYON')).split(',')[1], 'base64').toString();
  assert.ok(svg.includes('viewBox="0 0 72 72"'));
  assert.ok(svg.includes('clip-path="url(#caption)"'));
  assert.ok(svg.includes('data:image/png;base64,'));
  assert.ok(svg.includes('<path fill="#fff"'));
  const image = await renderer.render(undefined, 'Perfect', 'Kaley, LYON');
  assert.equal(renderer.cache.size, 1);
  assert.equal(image, 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  const fallback = new ArtworkRenderer({ loadFonts: async () => { throw new Error('no fonts'); }, fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
  assert.ok((await fallback.render(undefined, 'Titre', 'Artiste')).startsWith('data:image/svg+xml;base64,'));
});

test('R10: fallback glyphs have an explicit SVG width and reject invalid XML controls', async () => {
  const fonts = await renderer.fonts;
  for (const text of ['🎵'.repeat(20), '👨‍👩‍👧‍👦'.repeat(20), 'Mixed 🎵 Latin']) {
    const svg = captionSvg('', text, text, fonts);
    const widths = [...svg.matchAll(/textLength="([0-9.]+)"/g)].map(match => Number(match[1]));
    assert.equal(widths.length, 2); assert.ok(widths.every(width => width <= 60)); assert.ok(svg.includes('lengthAdjust="spacingAndGlyphs"'));
  }
  assert.ok(!captionSvg('', 'A' + String.fromCharCode(1) + 'B', '').includes(String.fromCharCode(1)));
});
