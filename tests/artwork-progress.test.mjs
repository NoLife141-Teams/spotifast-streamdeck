import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import opentype from 'opentype.js';
import { ArtworkRenderer, captionSvg, formatElapsed, formatRemaining } from '../src/artwork.mjs';

const cover = 'data:image/png;base64,AAAA';
const decode = image => Buffer.from(image.split(',')[1], 'base64').toString();
const renderer = fonts => new ArtworkRenderer({ loadFonts: async () => fonts ?? {} });
const svgFor = options => captionSvg(cover, 'Track', 'Artist', {}, { showText: false, ...options });

function group(svg, id) {
  const start = svg.indexOf('<g id="' + id + '"');
  assert.ok(start >= 0, 'Missing overlay ' + id);
  const tags = /<\/?g(?:\s[^>]*)?>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match; (match = tags.exec(svg));) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (!depth) return svg.slice(start, tags.lastIndex);
  }
  assert.fail('Unclosed overlay ' + id);
}

function timerFont() {
  const glyphs = [new opentype.Glyph({ name: '.notdef', advanceWidth: 500 })];
  for (const char of '0123456789:-…') {
    const path = new opentype.Path();
    path.moveTo(-40, -100); path.lineTo(550, -100); path.lineTo(550, 700); path.lineTo(-40, 700); path.close();
    glyphs.push(new opentype.Glyph({ name: char, unicode: char.codePointAt(0), advanceWidth: 600, path }));
  }
  const font = new opentype.Font({ familyName: 'Timer Test', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  font.kerningPairs = {};
  return font;
}

test('elapsed time floors seconds, preserves hours and rejects unknown values', () => {
  for (const [value, expected] of [
    [0, '0:00'], [1, '0:00'], [999, '0:00'], [1000, '0:01'], [59999, '0:59'],
    [60000, '1:00'], [3599999, '59:59'], [3600000, '1:00:00'], [123456789, '34:17:36'],
    [-1, ''], [NaN, ''], [Infinity, ''], [-Infinity, ''], [undefined, ''], [null, ''], ['1000', '']
  ]) assert.equal(formatElapsed(value), expected, String(value));
  assert.equal(formatElapsed(1001), '0:01');
  assert.equal(formatRemaining(1001), '-0:02', 'The existing countdown must still round upward');
});

test('legacy defaults retain byte-identical SVG output without the optional overlays', () => {
  // Captured before adding position/progress support, using no operating-system fonts.
  const snapshots = [
    ['', 'Track', 'Artist', {}, '1c6a2c8919f775e277d7becfdb562f0c8aff2ff672f6cb32d859a5a50a0dbaa7'],
    [cover, 'Été & <Night>', 'A • B', { showText: false }, 'feaf379c3c3b2c38ce59e52ee5508f4b8dc1122625fc97d96639b7dc48f78a2a'],
    ['', 'Long title '.repeat(12), 'Long artist '.repeat(10), { captionLayout: 'compact', scrollText: true, elapsedMs: 4000, remainingMs: 123456789, playbackFeedback: 'paused', feedbackOpacity: 0.45 }, '72e1bad5fd8f096f991ac418d634822a84550b9a2cf9254d06d50e3a40074400'],
    ['', 'Track', 'Artist', { remainingMs: 123456, playbackFeedback: 'playing' }, '7a5ad58c3cc7592347c839a4d5f17e0a7760db89d5e962f9bb146c4a5c0a59e6']
  ];
  for (const [artwork, title, artists, options, digest] of snapshots) {
    const svg = captionSvg(artwork, title, artists, {}, options);
    assert.equal(createHash('sha256').update(svg).digest('hex'), digest);
    assert.equal(svg, captionSvg(artwork, title, artists, {}, { ...options, positionMs: undefined, progress: undefined }));
    assert.ok(!svg.includes('id="elapsed-time"'));
    assert.ok(!svg.includes('id="playback-progress"'));
  }
});

test('elapsed, remaining and progress overlays are independently optional, including without captions', () => {
  for (let flags = 0; flags < 8; flags++) {
    for (const showText of [false, true]) {
      const svg = svgFor({ showText, positionMs: flags & 1 ? 4000 : undefined, remainingMs: flags & 2 ? 12000 : undefined, progress: flags & 4 ? 0.25 : undefined });
      assert.equal(svg.includes('id="elapsed-time"'), !!(flags & 1));
      assert.equal(svg.includes('id="remaining-time"'), !!(flags & 2));
      assert.equal(svg.includes('id="playback-progress"'), !!(flags & 4));
      assert.equal(svg.includes('<g clip-path="url(#caption)">'), showText);
      if (flags & 1) assert.match(group(svg, 'elapsed-time'), />0:04<\/text>/);
      if (flags & 2) assert.match(group(svg, 'remaining-time'), />-0:12<\/text>/);
      if (flags & 4) assert.match(group(svg, 'playback-progress'), /width="18" height="3" fill="#1ed760"/);
    }
  }
  const zero = svgFor({ positionMs: 0, remainingMs: 0, progress: 0 });
  assert.match(group(zero, 'elapsed-time'), />0:00<\/text>/);
  assert.match(group(zero, 'remaining-time'), />-0:00<\/text>/);
  assert.match(group(zero, 'playback-progress'), /width="0" height="3" fill="#1ed760"/);
});

test('caption animation elapsedMs stays separate from playback positionMs', async () => {
  const cached = renderer();
  const options = { showText: false, positionMs: 12456, progress: 0.2 };
  const first = await cached.render(cover, 'Track', 'Artist', options);
  assert.equal(first, await cached.render(cover, 'Track', 'Artist', { ...options, elapsedMs: 4000 }));
  const title = 'Long title '.repeat(10);
  const scrolling = { scrollText: true, positionMs: 12456, progress: 0.2 };
  const held = decode(await cached.render(cover, title, 'Artist', scrolling));
  const moved = decode(await cached.render(cover, title, 'Artist', { ...scrolling, elapsedMs: 4000 }));
  assert.notEqual(held, moved);
  assert.equal(group(held, 'elapsed-time'), group(moved, 'elapsed-time'));
  assert.equal(group(held, 'playback-progress'), group(moved, 'playback-progress'));
});

test('timer rows stay within the artwork, below progress and separate from each other', () => {
  for (const milliseconds of [0, 123456789, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
    for (const progress of [undefined, 0, 0.5, 1]) {
      const svg = svgFor({ positionMs: milliseconds, remainingMs: milliseconds, progress });
      const baseline = progress === undefined ? 12 : 15;
      for (const [id, expectedY] of [['elapsed-time', baseline], ['remaining-time', baseline + 12]]) {
        const overlay = group(svg, id);
        const transforms = [...overlay.matchAll(/translate\(([-\d.]+) ([-\d.]+)\)/g)];
        const lengths = [...overlay.matchAll(/textLength="([\d.]+)"/g)];
        assert.equal(transforms.length, 2);
        for (const [index, transform] of transforms.entries()) {
          const x = Number(transform[1]), y = Number(transform[2]), width = Number(lengths[index][1]);
          assert.equal(y, expectedY);
          assert.ok(x >= 4 && x + width <= 68, id + ' exceeds horizontal bounds');
          assert.ok(y - 9 - 0.6 > (progress === undefined ? 0 : 3));
          assert.ok(y + 3 < 48, id + ' overlaps caption area');
        }
        assert.ok(!overlay.includes('…'), 'Long timers must preserve every digit');
      }
    }
  }
});

test('invalid timers and progress hide cleanly, while finite progress is clamped and quantized', () => {
  const plain = svgFor({});
  for (const invalid of [undefined, null, false, '0.5', NaN, Infinity, -Infinity]) {
    assert.equal(svgFor({ positionMs: invalid, progress: invalid }), plain, String(invalid));
  }
  assert.equal(svgFor({ positionMs: -1 }), plain);
  assert.equal(svgFor({ progress: -1 }), svgFor({ progress: 0 }));
  assert.equal(svgFor({ progress: 2 }), svgFor({ progress: 1 }));
  for (const [progress, width] of [[0, 0], [0.000001, 0], [0.123456, 8.89], [1 / 3, 24], [1, 72]]) {
    const bar = group(svgFor({ progress }), 'playback-progress');
    assert.ok(bar.includes('width="' + width + '" height="3" fill="#1ed760"'));
    assert.ok(!bar.includes('NaN') && !bar.includes('Infinity'));
  }
});

test('image caching follows displayed seconds and rounded progress, including seeks and track replacements', async () => {
  const cached = renderer();
  const options = { showText: false, positionMs: 12001, remainingMs: 27999, progress: 0.25 };
  const first = await cached.render(cover, 'Track', 'Artist', options);
  assert.equal(first, await cached.render(cover, 'Track', 'Artist', { ...options, positionMs: 12999, remainingMs: 27001, progress: 0.250001 }));
  assert.equal(cached.cache.size, 1);
  const forward = await cached.render(cover, 'Track', 'Artist', { ...options, positionMs: 13000 });
  assert.notEqual(forward, first);
  const seek = await cached.render(cover, 'Track', 'Artist', { ...options, positionMs: 0, remainingMs: 40000, progress: 0 });
  assert.notEqual(seek, first);
  assert.match(group(decode(seek), 'elapsed-time'), />0:00<\/text>/);
  assert.notEqual(first, await cached.render(cover, 'Track', 'Artist', { ...options, progress: 0.251 }));
  const changedTitle = await cached.render(cover, 'Next Track', 'Artist', options);
  const changedCover = await cached.render('data:image/png;base64,BBBB', 'Track', 'Artist', options);
  assert.notEqual(changedTitle, first);
  assert.notEqual(changedCover, first);
  assert.equal(first, await cached.render(cover, 'Track', 'Artist', options));
  assert.notEqual(await cached.render(cover, 'Track', 'Artist', { showText: false }), await cached.render(cover, 'Track', 'Artist', { showText: false, progress: 0 }));
});

test('both timer outlines are reused across progress frames until their displayed second changes', async () => {
  const font = timerFont(), original = font.getPath.bind(font);
  let paths = 0;
  font.getPath = (...args) => { paths++; return original(...args); };
  const cached = renderer({ bold: font, regular: font });
  const options = { showText: false, positionMs: 12000, remainingMs: 48000, progress: 0.1 };
  await cached.render(cover, 'Track', 'Artist', options);
  assert.ok(paths > 0);
  paths = 0;
  for (let i = 1; i < 10; i++) await cached.render(cover, 'Track', 'Artist', { ...options, positionMs: 12000 + i, remainingMs: 48000 - i, progress: 0.1 + i / 100 });
  assert.equal(paths, 0, 'Both unchanged timers must reuse their outlines');
  await cached.render(cover, 'Track', 'Artist', { ...options, positionMs: 13000 });
  assert.equal(paths, 1, 'Only elapsed geometry changes');
  paths = 0;
  await cached.render(cover, 'Track', 'Artist', { ...options, positionMs: 13000, remainingMs: 47000 });
  assert.equal(paths, 1, 'Only countdown geometry changes');
});

test('combined overlays preserve exact direct rendering through bounded cache eviction', async () => {
  for (const fonts of [{}, { bold: timerFont(), regular: timerFont() }]) {
    const cached = renderer(fonts);
    for (let i = 0; i < 120; i++) {
      const artwork = 'data:image/png;base64,' + Buffer.from('cover-' + (i % 12)).toString('base64');
      const title = 'Track ' + (i % 12);
      const options = {
        showText: i % 3 !== 0, captionLayout: i % 2 ? 'compact' : 'twoLines', scrollText: true, elapsedMs: i * 200,
        positionMs: i * 1000, remainingMs: (200 - i) * 1000, progress: i / 119,
        playbackFeedback: i % 2 ? 'playing' : 'paused', feedbackOpacity: (i % 10) / 10
      };
      assert.equal(decode(await cached.render(artwork, title, 'Artist', options)), captionSvg(artwork, title, 'Artist', fonts, options));
    }
    assert.ok(cached.cache.size <= 8);
    assert.ok(cached.layouts.size <= 8);
    assert.ok(cached.covers.size <= 8);
    assert.ok(cached.counters.size <= 64);
    assert.ok([...cached.cache.keys()].every(key => !key.includes('data:image/')));
  }
});
