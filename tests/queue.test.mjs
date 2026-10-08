import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandQueue, Spotifast, commandFor } from '../src/core.mjs';
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

test('changing executable cancels pending commands from the previous configuration', async () => {
  const { instance, calls, gates } = client(); const gate = deferred(); gates.push(gate); const first = instance.run(['next']); await flush(); const stale = instance.run(['next']); const rejected = assert.rejects(stale, e => e.messageKey === 'commandExpired');
  instance.configure('D:/Portable/spotifast.exe'); gate.resolve(); await first; await rejected; assert.equal(calls.length, 1);
});

test('R02: explicit macro commands are idempotent and unsupported targets are rejected', () => {
  assert.deepEqual(commandFor('playpause', {}, undefined, 1), ['play']); assert.deepEqual(commandFor('playpause', {}, undefined, 0), ['pause']);
  assert.throws(() => commandFor('playpause', {}, undefined, 2), e => e.messageKey === 'unknownAction');
  assert.throws(() => commandFor('like', {}, undefined, 1), e => e.messageKey === 'unsupportedMultiAction');
});
