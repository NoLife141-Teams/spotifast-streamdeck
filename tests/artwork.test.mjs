import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ArtworkRenderer, fitCaption, captionSvg } from '../src/artwork.mjs';

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
