import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ArtworkRenderer, fitCaption, captionSvg, scrollOffset, formatRemaining } from '../src/artwork.mjs';
import { remainingTime, parseNowPlaying, ArtworkCache } from '../src/core.mjs';

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
  assert.equal(scrollOffset(120, 8600), 60);
  assert.equal(scrollOffset(120, 11100), 30);
  assert.equal(scrollOffset(120, 13600), 0);
  assert.equal(scrollOffset(120, NaN), 0);
});

test('the return and loop seam stay continuous, with gentle starts and no large frame jumps', () => {
  for (const width of [61, 68, 120, 600]) {
    const distance = width - 60, travel = Math.max(1200, distance / 12 * 1000);
    const returnStart = 3600 + travel, cycle = 3600 + 2 * travel;
    let previous = scrollOffset(width, 0);
    for (let elapsed = 100; elapsed <= cycle + 100; elapsed += 100) {
      const current = scrollOffset(width, elapsed);
      assert.ok(current >= 0 && current <= distance);
      assert.ok(Math.abs(current - previous) <= 1.9, `A visible jump occurred at ${elapsed} ms for width ${width}`);
      previous = current;
    }
    assert.equal(scrollOffset(width, returnStart), distance);
    assert.ok(scrollOffset(width, returnStart + travel / 2) > 0);
    assert.ok(scrollOffset(width, returnStart + travel / 2) < distance);
    assert.equal(scrollOffset(width, cycle), 0);
    assert.ok(scrollOffset(width, 1900) < 0.2);
    assert.ok(distance - scrollOffset(width, returnStart + 100) < 0.2);
  }
});

test('artwork has no permanent playback badge and transient feedback reports the confirmed state', async () => {
  const iconRenderer = new ArtworkRenderer({ fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
  const options = { showText: false };
  const cover = await iconRenderer.render('', 'Track', 'Artist', options);
  const play = await iconRenderer.render('', 'Track', 'Artist', { ...options, playbackFeedback: 'playing' });
  const pause = await iconRenderer.render('', 'Track', 'Artist', { ...options, playbackFeedback: 'paused' });
  const decode = image => Buffer.from(image.split(',')[1], 'base64').toString();
  assert.ok(!decode(cover).includes('id="playback-'));
  assert.ok(decode(play).includes('id="playback-play"'));
  assert.ok(!decode(play).includes('id="playback-pause"'));
  assert.ok(decode(pause).includes('id="playback-pause"'));
  assert.ok(!decode(pause).includes('id="playback-play"'));
  assert.ok(!decode(pause).includes('<g clip-path="url(#caption)">'));
  assert.notEqual(play, pause, 'The image cache must distinguish playback states');
  assert.equal(play, await iconRenderer.render('', 'Track', 'Artist', { ...options, playbackFeedback: 'playing' }));
  const fading = await iconRenderer.render('', 'Track', 'Artist', { ...options, playbackFeedback: 'paused', feedbackOpacity: 0.5 });
  assert.ok(decode(fading).includes('id="playback-feedback" opacity="0.5"'));
  assert.notEqual(fading, pause, 'The image cache must distinguish fade levels');
  assert.equal(cover, await iconRenderer.render('', 'Track', 'Artist', { ...options, playbackFeedback: 'paused', feedbackOpacity: 0 }));
  const timed = captionSvg('', 'Track', 'Artist', {}, { ...options, remainingMs: 123456789 });
  assert.ok(timed.includes('-34:17:37'), 'Every digit should remain visible');
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

test('compact captions keep title and artist on one scrolling line above a smaller gradient', () => {
  const options = { captionLayout: 'compact', scrollText: true };
  const initial = captionSvg('', 'Été à Montréal', 'Éléonore & François', {}, options);
  const moved = captionSvg('', 'Été à Montréal', 'Éléonore & François', {}, { ...options, elapsedMs: 5000 });
  assert.ok(initial.includes('Été à Montréal • Éléonore &amp; François'));
  assert.equal((initial.match(/<text /g) || []).length, 1);
  assert.ok(!initial.includes('<g clip-path="url(#artist)">'));
  assert.ok(initial.includes('<rect y="54" width="72" height="18" fill="url(#captionShade)"/>'));
  assert.ok(initial.includes('stop-opacity="0"'));
  assert.ok(initial.includes('stroke-width=".35"'));
  assert.notEqual(initial, moved);
  assert.equal(initial, captionSvg('', 'Été à Montréal', 'Éléonore & François', {}, { ...options, elapsedMs: 1500 }));
  const noArtist = captionSvg('', 'Track', '', {}, options);
  assert.ok(!noArtist.includes(' • '), 'An empty artist must not leave a dangling separator');
  const shortened = captionSvg('', 'Long title '.repeat(10), 'Long artist '.repeat(10), {}, { captionLayout: 'compact', scrollText: false });
  const visibleText = shortened.match(/<text [^>]*>([^<]*)<\/text>/)[1];
  assert.ok(visibleText.endsWith('…'));
});

test('switching caption layout cannot return an image cached for the other layout', async () => {
  const layoutRenderer = new ArtworkRenderer({ fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
  const options = { captionLayout: 'compact', scrollText: true };
  const compact = await layoutRenderer.render('', 'Perfect', 'Kaley, LYON', options);
  const twoLines = await layoutRenderer.render('', 'Perfect', 'Kaley, LYON', { ...options, captionLayout: 'twoLines' });
  assert.notEqual(compact, twoLines);
  assert.equal(compact, await layoutRenderer.render('', 'Perfect', 'Kaley, LYON', options));
  const hidden = await layoutRenderer.render('', 'Perfect', 'Kaley, LYON', { ...options, showText: false, playbackFeedback: 'paused', remainingMs: 60000 });
  const svg = Buffer.from(hidden.split(',')[1], 'base64').toString();
  assert.ok(!svg.includes('<g clip-path="url(#caption)">'));
  assert.ok(svg.includes('id="playback-pause"'));
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

test('animation uses measured caption widths for the selected layout', async () => {
  const options = { scrollText: true, captionLayout: 'twoLines' };
  assert.equal(await renderer.hasScrollingText('Hi', '', options), false);
  assert.equal(await renderer.hasScrollingText('WWWW', 'WWWW', options), false);
  assert.equal(await renderer.hasScrollingText('WWWW', 'WWWW', { ...options, captionLayout: 'compact' }), true);
  assert.equal(await renderer.hasScrollingText('An exceptionally long song title', '', options), true);
  assert.equal(await renderer.hasScrollingText('Hi', 'An exceptionally long artist name', options), true);
  assert.equal(await renderer.hasScrollingText('🎵'.repeat(20), '', options), true);
  assert.equal(await renderer.hasScrollingText('Long title '.repeat(20), '', { ...options, scrollText: false }), false);
  assert.equal(await renderer.hasScrollingText('Long title '.repeat(20), '', { ...options, showText: false }), false);
});

test('scroll detection reuses the rendering layout and works without system fonts', async () => {
  const fallback = new ArtworkRenderer({ loadFonts: async () => ({}), fallbackPath: new URL('../streamdeck/imgs/music.png', import.meta.url) });
  const options = { scrollText: true, captionLayout: 'compact' };
  assert.equal(await fallback.hasScrollingText('Hi', '', options), false);
  const layout = fallback.layouts.values().next().value;
  await fallback.render('', 'Hi', '', options);
  assert.equal(fallback.layouts.size, 1); assert.equal(fallback.layouts.values().next().value, layout);
  assert.equal(await fallback.hasScrollingText('👨‍👩‍👧‍👦'.repeat(20), '', options), true);
});

test('compact image keys preserve exact SVG output through cover and counter eviction', async () => {
  for (const fonts of [await renderer.fonts, {}]) {
    const cached = new ArtworkRenderer({ loadFonts: async () => fonts });
    for (let i = 0; i < 100; i++) {
      const cover = 'data:image/jpeg;base64,' + Buffer.from('cover-' + (i % 12)).toString('base64');
      const title = i % 2 ? 'A long scrolling track title 🎵' : 'Short';
      const options = {
        showText: i % 3 !== 0, scrollText: i % 2 === 0, captionLayout: i % 4 ? 'compact' : 'twoLines',
        elapsedMs: i * 200, remainingMs: i * 1000, playbackFeedback: i % 3 ? 'playing' : 'paused', feedbackOpacity: (i % 10) / 10
      };
      const image = await cached.render(cover, title, 'Artist', options);
      assert.equal(Buffer.from(image.split(',')[1], 'base64').toString(), captionSvg(cover, title, 'Artist', fonts, options));
    }
    assert.ok(cached.cache.size <= 8); assert.ok(cached.covers.size <= 8); assert.ok(cached.counters.size <= 64);
    assert.ok([...cached.cache.keys()].every(key => !key.includes('data:image/')));
  }
});

test('scrolling frames reuse counter outlines until the displayed second changes', async () => {
  const original = await renderer.fonts;
  let paths = 0;
  const bold = Object.create(original.bold);
  bold.getPath = (...args) => { paths++; return original.bold.getPath(...args); };
  const cached = new ArtworkRenderer({ loadFonts: async () => ({ ...original, bold }) });
  const cover = 'data:image/png;base64,AAAA';
  const options = { captionLayout: 'compact', scrollText: true, remainingMs: 123000 };
  const title = 'A long scrolling track title';
  await cached.layoutFor(title, 'Artist', options); paths = 0;
  await cached.render(cover, title, 'Artist', { ...options, elapsedMs: 2000 });
  assert.ok(paths > 0); paths = 0;
  for (let elapsedMs = 2100; elapsedMs <= 2900; elapsedMs += 100) await cached.render(cover, title, 'Artist', { ...options, elapsedMs });
  assert.equal(paths, 0, 'The unchanged timer must reuse its glyph geometry across distinct scrolling frames');
  await cached.render(cover, title, 'Artist', { ...options, remainingMs: 122000, elapsedMs: 3000 });
  assert.ok(paths > 0, 'The next displayed second needs its own geometry');
});

test('render cache keys stay compact with large covers and distinguish replacement bytes', async () => {
  const cached = new ArtworkRenderer({ loadFonts: async () => ({}) });
  const cover = 'data:image/jpeg;base64,' + 'A'.repeat(100000);
  const options = { scrollText: true, captionLayout: 'compact' };
  const first = await cached.render(cover, 'A long scrolling track title', 'Artist', options);
  for (let i = 0; i < 10; i++) await cached.render(cover, 'A long scrolling track title', 'Artist', { ...options, elapsedMs: 2000 + i * 100 });
  assert.ok([...cached.cache.keys()].every(key => key.length < 512));
  const replacement = await cached.render(cover.slice(0, -4) + 'BBBB', 'A long scrolling track title', 'Artist', options);
  assert.notEqual(first, replacement);
  assert.equal(first, await cached.render(cover, 'A long scrolling track title', 'Artist', options));
});

test('artwork freshness follows replacement, eviction, negative entries and the original cache deadline', () => {
  const cache = new ArtworkCache(() => { throw new Error('Freshness must never fetch'); });
  const url = 'https://i.scdn.co/cover';
  assert.equal(cache.isFresh(url, 'cover'), false);
  cache.cache.set(url, { value: 'cover', expires: Date.now() + 60000 });
  assert.equal(cache.isFresh(url, 'cover'), true); assert.equal(cache.isFresh(url, 'old'), false);
  cache.cache.set(url, { value: 'changed', expires: Date.now() + 60000 });
  assert.equal(cache.isFresh(url, 'cover'), false); assert.equal(cache.isFresh(url, 'changed'), true);
  cache.cache.get(url).expires = Date.now() - 1; assert.equal(cache.isFresh(url, 'changed'), false);
  cache.cache.set(url, { value: undefined, expires: Date.now() + 30000 }); assert.equal(cache.isFresh(url, undefined), false);
  cache.cache.delete(url); assert.equal(cache.isFresh(url, 'changed'), false);
});
