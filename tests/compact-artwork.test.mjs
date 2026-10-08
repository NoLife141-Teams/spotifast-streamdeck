import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ArtworkCache } from '../src/core.mjs';
import { compactArtwork } from '../src/compact-artwork.mjs';

const url = n => `https://i.scdn.co/image/test-${n}`;
const decode = value => Buffer.from(value.split(',')[1], 'base64');
const response = (bytes, type = 'image/png') => new Response(bytes, { headers: { 'content-type': type } });
const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><circle cx="160" cy="80" r="40" fill="#e84371"/></svg>');

test('JPEG, PNG and WebP artwork uses a central 144px crop with undistorted proportions and alpha', async () => {
  for (const [format, type] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const bytes = await sharp(source)[format]().toBuffer();
    const compact = await compactArtwork(bytes, type);
    const metadata = await sharp(compact.bytes).metadata();
    assert.equal(metadata.format, format); assert.equal(metadata.width, 144); assert.equal(metadata.height, 144);
    const { data, info } = await sharp(compact.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    assert.ok(pixel(72, 72)[0] > 180, 'The central colored circle must remain centered');
    if (format !== 'jpeg') {
      assert.equal(pixel(0, 0)[3], 0); assert.equal(pixel(72, 72)[3], 255);
      let left = 144, right = -1, top = 144, bottom = -1;
      for (let y = 0; y < 144; y++) for (let x = 0; x < 144; x++) if (pixel(x, y)[3] >= 128) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      assert.ok(Math.abs((right - left) - (bottom - top)) <= 1, 'A circle must stay circular after resizing a non-square source');
      assert.ok(right - left >= 70 && right - left <= 73, 'The crop must retain the expected scale');
    }
  }
});

test('artwork downloads and conversion are coalesced and fresh results expire after an hour', async () => {
  let clock = 0, reads = 0;
  const bytes = await sharp(source).png().toBuffer();
  const cache = new ArtworkCache(async (uri, options) => { reads++; assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal); return response(bytes); }, { now: () => clock });
  const results = await Promise.all(Array.from({ length: 8 }, () => cache.get(url(1))));
  assert.equal(reads, 1); assert.equal(new Set(results).size, 1);
  const value = results[0]; assert.ok(value.startsWith('data:image/png;base64,'));
  assert.equal((await sharp(decode(value)).metadata()).width, 144);
  assert.equal(cache.isFresh(url(1), value), true); assert.equal(cache.isFresh(url(1), 'other'), false);
  assert.equal(await cache.get(url(1)), value); assert.equal(reads, 1);
  clock = 3600000; assert.equal(cache.isFresh(url(1), value), false);
  await cache.get(url(1)); assert.equal(reads, 2); assert.equal(cache.pending.size, 0);
});

test('artwork rejects unapproved URLs, malformed data, mismatched formats and oversized decoded images', async () => {
  const png = await sharp(source).png().toBuffer();
  const invalid = [Buffer.from('not an image'), await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#abc' } }).png().toBuffer(),
    await sharp({ create: { width: 4097, height: 4097, channels: 3, background: '#abc' } }).png().toBuffer()];
  let fetches = 0;
  const cache = new ArtworkCache(async () => { fetches++; return response(png, 'image/jpeg'); });
  assert.equal(await cache.get('https://example.com/picture'), undefined); assert.equal(fetches, 0);
  assert.equal(await cache.get(url('mismatch')), undefined);
  for (const bytes of invalid) assert.equal(await new ArtworkCache(async () => response(bytes)).get(url('invalid')), undefined);
});

test('a failed conversion is negatively cached for thirty seconds and oversized downloads cancel their reader', async () => {
  let clock = 0, fetches = 0, canceled = false;
  const cache = new ArtworkCache(async () => { fetches++; return response(Buffer.from('invalid')); }, { now: () => clock });
  assert.equal(await cache.get(url(1)), undefined); assert.equal(await cache.get(url(1)), undefined); assert.equal(fetches, 1);
  clock = 30000; assert.equal(await cache.get(url(1)), undefined); assert.equal(fetches, 2);
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { canceled = true; } });
  assert.equal(await new ArtworkCache(async () => new Response(body, { headers: { 'content-type': 'image/png' } })).get(url('oversized')), undefined);
  assert.equal(canceled, true);
});

test('encoded artwork cache obeys both entry and byte budgets when replacing and evicting', async () => {
  const bytes = await sharp(source).png().toBuffer();
  const seed = new ArtworkCache(async () => response(bytes)); const value = await seed.get(url(0)); const size = Buffer.byteLength(value);
  const cache = new ArtworkCache(async () => response(bytes), { maxEntries: 8, maxBytes: size * 2 });
  for (let i = 0; i < 5; i++) await cache.get(url(i));
  assert.equal(cache.cache.size, 2); assert.equal(cache.bytes, size * 2); assert.equal(cache.isFresh(url(0), value), false);
  assert.equal(cache.isFresh(url(4), value), true);
  const entries = new ArtworkCache(async () => response(bytes), { maxEntries: 2, maxBytes: size * 8 });
  for (let i = 0; i < 5; i++) await entries.get(url(i));
  assert.equal(entries.cache.size, 2); assert.equal(entries.bytes, size * 2);
  await entries.get(url(4)); assert.equal(entries.bytes, size * 2);
  const tooSmall = new ArtworkCache(async () => response(bytes), { maxBytes: size - 1 });
  assert.ok(await tooSmall.get(url(1))); assert.equal(tooSmall.cache.size, 0); assert.equal(tooSmall.bytes, 0);
  for (const options of [{ maxEntries: NaN }, { maxBytes: Infinity }, { maxBytes: -1 }]) assert.throws(() => new ArtworkCache(fetch, options), RangeError);
});

test('packaged native decoder works outside the repository without its node_modules', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotifast-image-codec-'));
  try {
    await cp(new URL('../build/rocks.spotifast.streamdeck.sdPlugin/', import.meta.url), directory, { recursive: true });
    const bytes = await sharp(source).png().toBuffer();
    const script = `const assert = require('node:assert/strict'); const path = require('node:path');
      const prefix = process.cwd() + path.sep;
      assert.ok(require.resolve('sharp').startsWith(prefix));
      assert.ok(require.resolve('@img/sharp-win32-x64/sharp.node').startsWith(prefix));
      const sharp = require('sharp');
      sharp(Buffer.from(process.argv[1], 'base64')).resize(144,144,{fit:'cover'}).png().toBuffer().then(async bytes => {
        const info = await sharp(bytes).metadata(); assert.equal(info.width,144); assert.equal(info.height,144);
        console.log(JSON.stringify({ node:process.version, nativeLoaded:true, width:info.width, height:info.height }));
      }).catch(e=>{ console.error(e);process.exit(1); });`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script, bytes.toString('base64')], { cwd: directory, encoding: 'utf8', windowsHide: true, shell: false }));
    assert.equal(result.nativeLoaded, true); assert.equal(result.width, 144);
  } finally {
    assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith('spotifast-image-codec-'));
    await rm(directory, { recursive: true, force: true });
  }
});
