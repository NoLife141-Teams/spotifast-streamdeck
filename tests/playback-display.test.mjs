import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackDisplay, playbackOverlays, artworkSettings } from '../src/playback-display.mjs';

test('all playback overlays share one clamped sample and freeze while paused', () => {
  const snapshot = { state: 'playing', position: 10000, duration: 100000 };
  assert.deepEqual(playbackDisplay(snapshot, 1500), { positionMs: 11500, remainingMs: 88500, progress: 0.115 });
  assert.deepEqual(playbackDisplay({ ...snapshot, state: 'paused' }, 1500), { positionMs: 10000, remainingMs: 90000, progress: 0.1 });
  assert.deepEqual(playbackDisplay(snapshot, 9000), playbackDisplay(snapshot, 5000));
  assert.deepEqual(playbackDisplay({ ...snapshot, position: 999999 }, 1000), { positionMs: 100000, remainingMs: 0, progress: 1 });
  assert.equal(playbackDisplay({ ...snapshot, position: -1000 }, -1000).positionMs, 0);
});

test('unknown duration hides duration-dependent overlays while unknown playback hides all time', () => {
  assert.deepEqual(playbackDisplay({ state: 'playing', position: 10000, duration: 0 }, 1000), { positionMs: 11000, remainingMs: undefined, progress: undefined });
  for (const snapshot of [undefined, {}, { state: 'stopped', position: 0, duration: 100 }, { state: 'paused', position: NaN, duration: 100 }]) assert.deepEqual(playbackDisplay(snapshot), {});
});

test('old profiles retain remaining-time-only defaults and each optional overlay is independent', () => {
  const snapshot = { state: 'playing', position: 20000, duration: 100000 };
  assert.deepEqual(artworkSettings({ unknown: 'keep' }), { showText: true, scrollText: true, captionLayout: 'compact', showRemaining: true, showElapsed: false, showProgress: false });
  assert.deepEqual(playbackOverlays(snapshot, {}, 0), { remainingMs: 80000, positionMs: undefined, progress: undefined });
  assert.deepEqual(playbackOverlays(snapshot, { showRemaining: false, showElapsed: true }, 0), { remainingMs: undefined, positionMs: 20000, progress: undefined });
  assert.deepEqual(playbackOverlays(snapshot, { showRemaining: false, showProgress: true }, 0), { remainingMs: undefined, positionMs: undefined, progress: 0.2 });
  assert.equal(artworkSettings({ showElapsed: 'true', showProgress: 1 }).showElapsed, false);
});
