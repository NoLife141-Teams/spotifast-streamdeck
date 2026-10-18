import test from 'node:test';
import assert from 'node:assert/strict';
import { Spotifast, CommandQueue, commandFor, parseNowPlaying, seekTarget } from '../src/core.mjs';
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const sample = (overrides = {}) => ({ state: 'playing', title: 'Track', artists: 'Artist', album: 'Album', position: 50000, duration: 180900, volume: 50, shuffle: false, repeat: 'off', artUrl: '', saved: 'no', device: 'Spotifast', ...overrides });
const raw = snapshot => [snapshot.state, snapshot.title, snapshot.artists, snapshot.album, snapshot.position, snapshot.duration, snapshot.volume, snapshot.shuffle ? 'on' : 'off', snapshot.repeat, snapshot.artUrl, snapshot.saved, snapshot.device].join('\t');
function player(options = {}) {
  const calls = [], state = { data: sample(), readGate: undefined };
  const client = new Spotifast({ ...options, executeFile: async (_exe, args, execution) => {
    calls.push([...args]); assert.equal(execution.shell, false);
    if (args[0] === 'now-playing') { if (state.readGate) await state.readGate.promise; return { stdout: raw(state.data) }; }
    if (args[0] === 'seek-to') state.data.position = Number(args[1]) * 1000;
    return { stdout: '' };
  } });
  client.executable = async () => 'C:/Spotifast/spotifast.exe';
  return { client, calls, state };
}

test('seek buttons default to ±10 seconds, normalize settings, and restart explicitly at zero', () => {
  for (const [value, expected] of [[undefined, 10], ['', 10], [NaN, 10], [Infinity, 10], [-2, 1], [1.5, 2], [99999, 3600]]) {
    assert.deepEqual(commandFor('seekback', { seekSeconds: value }), ['seek', String(-expected)]);
    assert.deepEqual(commandFor('seekforward', { seekSeconds: value }), ['seek', String(expected)]);
  }
  assert.deepEqual(commandFor('restart'), ['seek-to', '0']);
});

test('seek calculations clamp to whole-second track bounds and paused tracks remain seekable', () => {
  assert.deepEqual(seekTarget(['seek', '-100'], sample()), ['seek-to', '0']);
  assert.deepEqual(seekTarget(['seek', '3600'], sample()), ['seek-to', '180']);
  assert.deepEqual(seekTarget(['seek', '10'], sample({ position: 12345, state: 'paused' })), ['seek-to', '22']);
  assert.deepEqual(seekTarget(['seek-to', '0'], sample()), ['seek-to', '0']);
  for (const args of [['seek', 'NaN'], ['seek-to', '-1'], ['seek', '1.2'], ['seek-to', '100']]) assert.throws(() => seekTarget(args, sample()));
});

test('missing and malformed timing cannot become a zero-position seek', async () => {
  for (const value of ['', 'NaN', 'Infinity', '-1', '1.5']) {
    const malformed = parseNowPlaying(raw(sample({ position: value })));
    assert.equal(malformed.position, null);
    assert.throws(() => seekTarget(['seek', '10'], malformed), error => error.messageKey === 'seekUnavailable');
  }
  for (const bad of [sample({ duration: 0 }), sample({ state: 'stopped' }), sample({ title: '' }), sample({ position: null })]) {
    const { client, calls } = player(); await assert.rejects(client.seek(['seek', '10'], { snapshot: bad, ageMs: 0 }), error => error.messageKey === 'seekUnavailable'); assert.equal(calls.length, 0);
  }
});

test('a guarded seek reads immediately before its serialized write and uses that fresh position', async () => {
  const { client, calls, state } = player(); state.data = sample({ state: 'paused', position: 55000 });
  await client.seek(['seek', '10'], { snapshot: sample(), ageMs: 0 });
  assert.deepEqual(calls, [['now-playing', '--raw'], ['seek-to', '65']]);
});

test('a changed track, duration or device rejects seek without a write', async () => {
  for (const changed of [{ title: 'Next track' }, { duration: 200000 }, { device: 'Phone' }, { state: 'stopped' }, { position: null }]) {
    const { client, calls, state } = player(); state.data = sample(changed);
    await assert.rejects(client.seek(['seek', '10'], { snapshot: sample(), ageMs: 0 }), error => error.messageKey === 'seekStale');
    assert.deepEqual(calls, [['now-playing', '--raw']]);
  }
});

test('stale snapshots and profile/configuration changes cancel seek before its write', async () => {
  const { client, calls, state } = player();
  for (const ageMs of [5001, Infinity, NaN, -1]) await assert.rejects(client.seek(['seek', '10'], { snapshot: sample(), ageMs }), error => error.messageKey === 'seekUnavailable');
  assert.equal(calls.length, 0);
  let valid = true;
  for (const invalidate of [() => client.configure('D:/New/spotifast.exe'), () => { valid = false; }]) {
    valid = true; state.readGate = deferred();
    const pending = client.seek(['seek', '10'], { snapshot: sample(), ageMs: 0, valid: () => valid });
    const rejected = assert.rejects(pending, error => error.messageKey === 'seekStale');
    await flush(); invalidate(); state.readGate.resolve(); await rejected;
  }
  assert.ok(calls.every(args => args[0] === 'now-playing'));
});

test('a queued local track change invalidates seek even if upstream snapshot still shows the old track', async () => {
  const { client, calls } = player();
  const next = client.run(['next']); const seeking = client.seek(['seek', '10'], { snapshot: sample(), ageMs: 0 });
  const rejection = assert.rejects(seeking, error => error.messageKey === 'seekStale'); await next; await rejection;
  assert.deepEqual(calls, [['next']]);
});

test('guard expires while a status read is blocked, without issuing the stale seek', async () => {
  let now = 0; const { client, calls, state } = player({ queue: new CommandQueue({ now: () => now }) });
  state.readGate = deferred(); const seeking = client.seek(['seek', '10'], { snapshot: sample(), ageMs: 4000 });
  const rejected = assert.rejects(seeking, error => error.messageKey === 'seekStale'); await flush(); now = 1001; state.readGate.resolve(); await rejected;
  assert.deepEqual(calls, [['now-playing', '--raw']]);
});

test('rapid seeks stay serialized with pause and use updated positions', async () => {
  const { client, calls } = player();
  await Promise.all([client.seek(['seek', '10'], { snapshot: sample(), ageMs: 0 }), client.run(['pause'], { ordered: true }), client.seek(['seek', '10'], { snapshot: sample(), ageMs: 0 })]);
  assert.deepEqual(calls, [['now-playing', '--raw'], ['seek-to', '60'], ['pause'], ['now-playing', '--raw'], ['seek-to', '70']]);
});

test('a previously sampled state cannot seek after a local track-changing command was accepted', async () => {
  const { client, calls } = player(); const snapshot = await client.snapshot();
  await client.run(['next']);
  await assert.rejects(client.seek(['seek', '10'], { snapshot, ageMs: 0 }), error => error.messageKey === 'seekStale');
  assert.deepEqual(calls, [['now-playing', '--raw'], ['next']]);
});
