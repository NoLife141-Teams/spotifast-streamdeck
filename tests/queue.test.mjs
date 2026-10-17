import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandQueue, Spotifast, commandFor } from '../src/core.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function client(queue = new CommandQueue()) {
  const calls = [], gates = [];
  const instance = new Spotifast({ queue, executeFile: async (exe, args, options) => { calls.push([...args]); assert.equal(options.shell, false); const gate = gates.shift(); if (gate) await gate.promise; return { stdout: '' }; } });
  instance.executable = async () => 'C:/Spotifast/spotifast.exe';
  return { instance, calls, gates };
}

test('R04: rotation bursts merge while Pause overtakes pending volume', async () => {
  const { instance, calls, gates } = client(); const active = deferred(); gates.push(active);
  const first = instance.run(['volume-up', '5']); await flush();
  const turns = Array.from({ length: 12 }, () => instance.run(['volume-up', '5'])); const pause = instance.run(['pause']); active.resolve();
  await Promise.all([first, pause, ...turns]); assert.deepEqual(calls, [['volume-up', '5'], ['pause'], ['volume-up', '60']]);
});

test('R04: opposite directions remain ordered at volume boundaries', async () => {
  const { instance, calls } = client(); const up = instance.run(['volume-up', '5']), down = instance.run(['volume-down', '5']); await Promise.all([up, down]);
  assert.deepEqual(calls, [['volume-up', '5'], ['volume-down', '5']]);
});

test('R04: concurrent snapshots share one CLI request', async () => {
  const { instance, calls, gates } = client(); const active = deferred(); gates.push(active);
  const first = instance.run(['now-playing', '--raw']); await flush(); const next = instance.run(['now-playing', '--raw']); assert.equal(first, next); active.resolve(); await Promise.all([first, next]); assert.equal(calls.length, 1);
});

test('R04: commands expire in the queue without executing stale volume changes', async () => {
  let now = 0; const { instance, calls, gates } = client(new CommandQueue({ now: () => now })); const active = deferred(); gates.push(active);
  const first = instance.run(['now-playing', '--raw']); await flush(); const stale = instance.run(['volume-up', '10']); const rejection = assert.rejects(stale, error => error.messageKey === 'commandExpired'); now = 3000; active.resolve(); await first; await rejection; assert.equal(calls.length, 1);
});

test('R04: a full queue rejects excess work and reserves transport by evicting low-priority work', async () => {
  const queue = new CommandQueue({ maxPending: 2 }); const gate = deferred(); const first = queue.run(() => gate.promise); await flush();
  const expired = queue.run(() => assert.fail('expired task ran'), { priority: -10 }); const expiration = assert.rejects(expired, e => e.messageKey === 'commandExpired');
  const low = queue.run(() => 'volume', { priority: 0 }); await assert.rejects(queue.run(() => {}, { priority: -10 }), e => e.messageKey === 'commandQueueBusy');
  const urgent = queue.run(() => 'pause', { priority: 20 }); gate.resolve(); await first; await expiration; assert.equal(await urgent, 'pause'); assert.equal(await low, 'volume');
});

test('command failures do not poison the queue', async () => {
  const queue = new CommandQueue(); const failed = queue.run(() => { throw new Error('failed'); }); const following = queue.run(() => 42); await assert.rejects(failed, /failed/); assert.equal(await following, 42);
});

test('status CLI timeouts release Pause promptly while writes retain their full budget', async () => {
  const active = deferred(), calls = [], budgets = [];
  const instance = new Spotifast({ executeFile: async (exe, args, options) => {
    calls.push(args); budgets.push(options.timeout);
    if (args[0] === 'now-playing') { await active.promise; throw Object.assign(new Error('status timed out'), { killed: true }); }
    return { stdout: '' };
  } });
  instance.executable = async () => 'C:/Spotifast/spotifast.exe';
  const snapshot = instance.snapshot(); const rejected = assert.rejects(snapshot, error => error.killed === true);
  await flush();
  const volume = instance.run(['volume-up', '5']), pause = instance.run(['pause']);
  assert.deepEqual(calls, [['now-playing', '--raw']]);
  active.resolve(); await rejected; await Promise.all([volume, pause]);
  assert.deepEqual(calls, [['now-playing', '--raw'], ['pause'], ['volume-up', '5']]);
  assert.deepEqual(budgets, [1000, 5000, 5000]);
});

test('a stalled isolated CLI child times out without preventing the next serialized write', async () => {
  const execute = promisify(execFile), calls = [];
  const instance = new Spotifast({ executeFile: (exe, args, options) => {
    calls.push(args[0]);
    // This test launches its own Node helper, never the actual Spotifast application.
    return execute(process.execPath, ['-e', args[0] === 'now-playing' ? 'setTimeout(() => {}, 10000)' : 'process.stdout.write("ok")'], options);
  } });
  instance.executable = async () => 'unused-test-helper.exe';
  const reading = instance.snapshot();
  const rejected = assert.rejects(reading, error => error.killed === true);
  await flush();
  const pause = instance.run(['pause']);
  await rejected;
  assert.equal(await pause, 'ok');
  assert.deepEqual(calls, ['now-playing', 'pause']);
});

test('changing executable cancels pending commands from the previous configuration', async () => {
  const { instance, calls, gates } = client(); const gate = deferred(); gates.push(gate); const first = instance.run(['next']); await flush(); const stale = instance.run(['next']); const rejected = assert.rejects(stale, e => e.messageKey === 'commandExpired');
  instance.configure('D:/Portable/spotifast.exe'); gate.resolve(); await first; await rejected; assert.equal(calls.length, 1);
});

test('R02: explicit macro commands are idempotent and unsupported targets are rejected', () => {
  for (const id of ['playpause', 'nowplaying']) {
    assert.deepEqual(commandFor(id, {}, undefined, 1), ['play']);
    assert.deepEqual(commandFor(id, {}, undefined, 0), ['pause']);
    assert.deepEqual(commandFor(id), ['play-pause']);
  }
  assert.throws(() => commandFor('playpause', {}, undefined, 2), e => e.messageKey === 'unknownAction');
  assert.throws(() => commandFor('like', {}, undefined, 1), e => e.messageKey === 'unsupportedMultiAction');
});

test('executable discovery cannot repopulate a cache from an obsolete configuration', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const directory = await mkdtemp(path.join(tmpdir(), 'spotifast-path-'));
  try {
    const oldPath = path.join(directory, 'old.exe'), newPath = path.join(directory, 'new.exe');
    await writeFile(oldPath, ''); await writeFile(newPath, '');
    const calls = [], instance = new Spotifast({ executeFile: async exe => { calls.push(exe); return { stdout: '' }; } });
    instance.configure(oldPath);
    const lookup = instance.executable();
    instance.configure(newPath);
    assert.equal(await lookup, newPath);
    await instance.run(['pause']);
    assert.deepEqual(calls, [newPath]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('playlist and subsequent Pause retain input order behind an active status read', async () => {
  const { instance, calls, gates } = client(); const gate = deferred(); gates.push(gate);
  const status = instance.run(['now-playing', '--raw']); await flush();
  const playlist = instance.run(['play-uri', 'spotify:playlist:Example']);
  const pause = instance.run(['pause']); gate.resolve();
  await Promise.all([status, playlist, pause]);
  assert.deepEqual(calls, [['now-playing', '--raw'], ['play-uri', 'spotify:playlist:Example'], ['pause']]);
});

test('merged volume preserves fresh input without resurrecting expired input', async () => {
  let now = 0;
  const { instance, calls, gates } = client(new CommandQueue({ now: () => now }));
  const gate = deferred(); gates.push(gate);
  const active = instance.run(['next']); await flush();
  const old = instance.run(['volume-up', '100']);
  now = 2400; const fresh = instance.run(['volume-up', '5']);
  now = 2501; gate.resolve(); await Promise.all([active, old, fresh]);
  assert.deepEqual(calls, [['next'], ['volume-up', '5']]);
});

test('a merged volume batch still expires when every input is stale', async () => {
  let now = 0;
  const { instance, calls, gates } = client(new CommandQueue({ now: () => now }));
  const gate = deferred(); gates.push(gate);
  const active = instance.run(['next']); await flush();
  const old = instance.run(['volume-up', '5']);
  const rejected = assert.rejects(old, error => error.messageKey === 'commandExpired');
  now = 2400; instance.run(['volume-up', '5']);
  now = 4901; gate.resolve(); await active; await rejected;
  assert.deepEqual(calls, [['next']]);
});

for (const commands of [
  [['volume-up', '5'], ['mute']],
  [['volume-down', '5'], ['mute']],
  [['mute'], ['volume-up', '5']],
  [['mute'], ['volume-up', '5'], ['mute']],
  [['volume-up', '5'], ['volume-up', '5'], ['mute'], ['volume-up', '5'], ['volume-up', '5'], ['mute']]
]) {
  test('mute and volume retain input order: ' + JSON.stringify(commands), async () => {
    const gate = deferred(), calls = [];
    let volume = 50, beforeMute;
    // Spotifast mute restores its saved volume; volume changes clear that saved value.
    const apply = args => {
      if (args[0] === 'mute') {
        if (volume === 0) { volume = Math.max(5, beforeMute ?? 50); beforeMute = undefined; }
        else { beforeMute = volume; volume = 0; }
      } else {
        volume = Math.max(0, Math.min(100, volume + (args[0] === 'volume-up' ? 1 : -1) * Number(args[1])));
        beforeMute = undefined;
      }
    };
    for (const args of commands) apply(args);
    const expected = { volume, beforeMute };
    volume = 50; beforeMute = undefined;
    const instance = new Spotifast({ executeFile: async (_exe, args) => {
      if (args[0] === 'now-playing') await gate.promise;
      else { calls.push([...args]); apply(args); }
      return { stdout: '' };
    } });
    instance.executable = async () => 'unused-test-helper.exe';
    const active = instance.run(['now-playing', '--raw']); await flush();
    const pending = commands.map(args => instance.run(args));
    gate.resolve(); await Promise.all([active, ...pending]);
    assert.deepEqual({ volume, beforeMute }, expected, JSON.stringify(calls));
    const expectedCalls = [];
    for (const args of commands) {
      const last = expectedCalls.at(-1);
      if (args[0].startsWith('volume-') && last?.[0] === args[0]) last[1] = String(Math.min(100, Number(last[1]) + Number(args[1])));
      else expectedCalls.push([...args]);
    }
    assert.deepEqual(calls, expectedCalls, 'only adjacent same-direction volume changes may merge');
  });
}

test('Pause still overtakes the ordered mute-volume lane', async () => {
  const { instance, calls, gates } = client(); const gate = deferred(); gates.push(gate);
  const active = instance.run(['now-playing', '--raw']); await flush();
  const pending = [['volume-up', '5'], ['mute'], ['pause'], ['volume-up', '5']].map(args => instance.run(args));
  gate.resolve(); await Promise.all([active, ...pending]);
  assert.deepEqual(calls, [['now-playing', '--raw'], ['pause'], ['volume-up', '5'], ['mute'], ['volume-up', '5']]);
});
