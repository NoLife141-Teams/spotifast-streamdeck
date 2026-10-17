import test from 'node:test';
import assert from 'node:assert/strict';
import opentype from 'opentype.js';
import { fitCaption, captionSvg, ArtworkRenderer } from '../src/artwork.mjs';

function fixtureFont() {
  const glyphs = [new opentype.Glyph({ name: '.notdef', advanceWidth: 500 })];
  for (const char of ' AWVfitrse…•ﬁ') {
    const path = new opentype.Path();
    if (char !== ' ') {
      path.moveTo(-40, 0); path.lineTo(640, 0); path.lineTo(640, 700); path.close();
    }
    glyphs.push(new opentype.Glyph({ name: char, unicode: char.codePointAt(0), advanceWidth: 600, path }));
  }
  const font = new opentype.Font({ familyName: 'Caption Test', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  font.kerningPairs = { [font.charToGlyphIndex('A') + ',' + font.charToGlyphIndex('V')]: -100 };
  font.substitution.add('liga', { sub: [font.charToGlyphIndex('f'), font.charToGlyphIndex('i')], by: font.charToGlyphIndex('ﬁ') });
  return font;
}

test('long captions use bounded shaping instead of shrinking every prefix', () => {
  const font = fixtureFont(), shape = font.stringToGlyphs.bind(font);
  let calls = 0, characters = 0;
  font.stringToGlyphs = (text, options) => { calls++; characters += text.length; return shape(text, options); };
  const result = fitCaption('W'.repeat(1000), font);
  assert.ok(result.width <= 60);
  assert.match(result.text, /…$/);
  assert.ok(calls <= 32, `Expected bounded shaping, got ${calls} calls`);
  assert.ok(characters < 10000, `Expected near-linear shaping work, got ${characters} characters`);
});

test('hidden captions never shape title or artist, but keep metadata and timer', async () => {
  const font = fixtureFont(), shape = font.stringToGlyphs.bind(font), shaped = [];
  font.stringToGlyphs = (text, options) => { shaped.push(text); return shape(text, options); };
  const renderer = new ArtworkRenderer({ loadFonts: async () => ({ regular: font, bold: font }) });
  for (const captionLayout of ['compact', 'twoLines']) {
    const image = await renderer.render('data:image/png;base64,AAAA', 'WWWW', 'Artist', { showText: false, captionLayout });
    const svg = Buffer.from(image.split(',')[1], 'base64').toString();
    assert.ok(svg.includes('<title>WWWW</title><desc>Artist</desc>'));
    assert.ok(!svg.includes('<g clip-path="url(#caption)">'));
  }
  assert.deepEqual(shaped.filter(Boolean), []);
  assert.ok(captionSvg('', 'WWWW', 'Artist', {}, { showText: false, remainingMs: 61000 }).includes('-1:01'));
});

test('compact layout only shapes its combined caption', () => {
  const font = fixtureFont(), shape = font.stringToGlyphs.bind(font), shaped = [];
  font.stringToGlyphs = (text, options) => { shaped.push(text); return shape(text, options); };
  captionSvg('', 'W', 'A', { bold: font, regular: font }, { captionLayout: 'compact', scrollText: true });
  assert.ok(shaped.includes('W • A'));
  assert.ok(!shaped.includes('W') && !shaped.includes('A'), 'Unused two-line captions must not be shaped');
});

test('measured widths retain kerning and ink overhangs', () => {
  const font = fixtureFont();
  assert.equal(font.stringToGlyphs('fi').length, 1, 'The fixture must exercise ligature shaping');
  for (const text of ['W', 'AV', 'AV AV', 'fi', 'fifi AV', 'fififififififififififififi', 'WWWWWWWWWWWWWWWWWWWW']) {
    const result = fitCaption(text, font);
    const box = font.getPath(result.text, 0, 0, result.size).getBoundingBox();
    const expected = Math.max(font.getAdvanceWidth(result.text, result.size), box.x2 - box.x1);
    assert.ok(Math.abs(result.width - expected) < 1e-9);
    assert.ok(result.width <= 60);
  }
  for (const cluster of ['👨‍👩‍👧‍👦', 'e\u0301', '🇫🇷']) {
    const result = fitCaption(cluster.repeat(1000), undefined);
    assert.equal(result.text, cluster.normalize('NFC').repeat(2) + '…');
    assert.ok(result.width <= 60);
  }
});


test('a budget narrower than the ellipsis produces an empty, non-overflowing caption', () => {
  for (const font of [fixtureFont(), undefined]) {
    assert.deepEqual(fitCaption('WWWW', font, { maxWidth: 1 }), { text: '', size: 8.5, width: 0 });
    assert.deepEqual(fitCaption('', font, { maxWidth: 0 }), { text: '', size: 10, width: 0 });
  }
});
