import test from 'node:test';
import assert from 'node:assert/strict';
import { Spotifast, commandFor, parseDevices, CommandQueue } from '../src/core.mjs';
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const device = (id = 'speaker-1', overrides = {}) => ({ id, name: 'Kitchen', kind: 'Speaker', active: false, ...overrides });
function player(options = {}) {
  const calls = [], waits = [], state = { lists: [[device()]], error: undefined, waitGate: undefined };
  const client = new Spotifast({ ...options, sleep: async ms => { waits.push(ms); if (state.waitGate) await state.waitGate.promise; }, executeFile: async (_exe, args, opts) => {
    calls.push([...args]); assert.equal(opts.shell, false);
    if (state.error) throw state.error;
    if (args[0] === 'devices') return { stdout: JSON.stringify(state.lists.length > 1 ? state.lists.shift() : state.lists[0]) };
    return { stdout: '' };
  } });
  client.executable = async () => 'C:/Spotifast/spotifast.exe';
  return { client, calls, waits, state };
}

test('device actions need an explicit valid opaque ID, never a name or automatic fallback', () => {
  assert.deepEqual(commandFor('device', { deviceId: 'speaker-1' }), ['transfer', 'speaker-1']);
  for (const deviceId of [undefined, '', 'Kitchen speaker', 'a;next', 'x\nnext', '../device', 'x'.repeat(65)]) {
    assert.throws(() => commandFor('device', { deviceId }), error => error.messageKey === 'deviceUnconfigured');
  }
});

test('device parsing preserves duplicate names by distinct ID and refuses duplicate IDs or malformed payloads', () => {
  assert.deepEqual(parseDevices(JSON.stringify([device('a'), device('b')])), [device('a'), device('b')]);
  assert.deepEqual(parseDevices('[]'), []);
  assert.equal(parseDevices(JSON.stringify([device('a', { name: '<unsafe>\nKitchen' })]))[0].name, '<unsafe> Kitchen');
  for (const raw of ['not json', '{}', '[null]', JSON.stringify([device('a'), device('a')]), JSON.stringify([device('a', { active: 'true' })]), JSON.stringify([device('a', { id: 'two words' })]), JSON.stringify(Array.from({ length: 257 }, (_, n) => device(String(n))))]) {
    assert.throws(() => parseDevices(raw), error => error.messageKey === 'devicesInvalid');
  }
});

test('explicit refresh reads cached inventory, waits a bounded window, and returns the next list', async () => {
  const { client, calls, waits, state } = player(); state.lists = [[], [device('a'), device('b')]];
  assert.deepEqual(await client.devices(), [device('a'), device('b')]);
  assert.deepEqual(calls, [['devices', '--raw'], ['devices', '--raw']]); assert.deepEqual(waits, [500]);
});

test('transfer rechecks the exact configured ID and never chooses the first same-name device', async () => {
  const { client, calls, state } = player(); state.lists = [[device('a'), device('b')]];
  await client.transfer('b'); assert.deepEqual(calls, [['devices', '--raw'], ['devices', '--raw'], ['transfer', '--', 'b']]);
});

test('a disappearing, missing or ambiguous selected device never triggers transfer', async () => {
  for (const lists of [[[device()], []], [[device('other')]], [[device(), device()]]]) {
    const { client, calls, state } = player(); state.lists = lists;
    await assert.rejects(client.transfer('speaker-1'), error => ['deviceUnavailable', 'devicesInvalid'].includes(error.messageKey));
    assert.ok(calls.every(args => args[0] === 'devices'));
  }
});

test('an explicitly requested active target is reasserted and read failure never falls back', async () => {
  const { client, calls, state } = player(); state.lists = [[device('speaker-1', { active: true })]];
  await client.transfer('speaker-1'); assert.equal(calls.length, 3);
  assert.deepEqual(calls.at(-1), ['transfer', '--', 'speaker-1']);
  state.error = new Error('unsupported devices');
  await assert.rejects(client.transfer('speaker-1'), /unsupported devices/);
  assert.deepEqual(calls.at(-1), ['devices', '--raw']);
  assert.equal(calls.filter(args => args[0] === 'transfer').length, 1);
});

test('configuration or selection invalidation during refresh prevents stale transfer', async () => {
  for (const kind of ['configuration', 'selection']) {
    const { client, calls, state } = player(); state.waitGate = deferred(); let valid = true;
    const transfer = client.transfer('speaker-1', { valid: () => valid });
    const rejected = assert.rejects(transfer, error => error.messageKey === 'deviceStale'); await flush();
    if (kind === 'configuration') client.configure('D:/New/spotifast.exe'); else valid = false;
    state.waitGate.resolve(); await rejected; assert.deepEqual(calls, [['devices', '--raw']]);
  }
});

test('transfer is one FIFO transaction across the inventory check and subsequent macro playback', async () => {
  const { client, calls, state } = player(); state.waitGate = deferred();
  const transfer = client.transfer('speaker-1'); await flush();
  const pause = client.run(['pause'], { ordered: true }); assert.equal(calls.length, 1);
  state.waitGate.resolve(); await Promise.all([transfer, pause]);
  assert.deepEqual(calls, [['devices', '--raw'], ['devices', '--raw'], ['transfer', '--', 'speaker-1'], ['pause']]);
});

test('a queued expired transfer does not issue any inventory or write command', async () => {
  let now = 0; const queue = new CommandQueue({ now: () => now }), { client, calls } = player({ queue }), gate = deferred();
  const active = queue.run(() => gate.promise); await flush();
  const transfer = client.transfer('speaker-1'); const rejected = assert.rejects(transfer, error => error.messageKey === 'commandExpired');
  now = 5001; gate.resolve(); await active; await rejected; assert.equal(calls.length, 0);
});


test('an opaque ID beginning with a hyphen remains a positional CLI value', async () => {
  const { client, calls, state } = player(); state.lists = [[device('--opaque')]];
  await client.transfer('--opaque');
  assert.deepEqual(calls.at(-1), ['transfer', '--', '--opaque']);
});
