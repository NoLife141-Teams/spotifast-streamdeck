import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Spotifast } from '../src/core.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function launcher() {
  const calls = [];
  const instance = new Spotifast({
    executeFile: async () => assert.fail('Open must not use a timeout-bound CLI process'),
    spawnFile: (exe, args, options) => {
      const child = new EventEmitter();
      child.unrefs = 0;
      child.unref = () => { child.unrefs++; };
      calls.push({ exe, args, options, child });
      return child;
    }
  });
  instance.executable = async () => path.resolve('Program Files', 'Spotifast', 'spotifast.exe');
  return { instance, calls };
}

test('Open launches a visible detached app without a CLI command or timeout', async () => {
  const { instance, calls } = launcher();
  let completed = false;
  const opening = instance.open().then(() => { completed = true; });
  await flush();
  assert.equal(completed, false);
  assert.equal(calls.length, 1);
  const { exe, args, options, child } = calls[0];
  assert.equal(exe, await instance.executable());
  assert.deepEqual(args, []);
  assert.deepEqual(options, {
    cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false, shell: false
  });
  assert.equal(child.unrefs, 0);
  child.emit('spawn');
  await opening; // Does not wait for GUI exit, so the app can remain open.
  assert.equal(child.unrefs, 1);
});

test('Open coalesces repeated presses while a launch is pending or spawning', async () => {
  const { instance, calls } = launcher();
  const first = instance.open(), pending = instance.open();
  assert.equal(first, pending);
  await flush();
  assert.equal(instance.open(), first);
  assert.equal(calls.length, 1);
  calls[0].child.emit('spawn');
  await first;
  // Later presses use the same bare invocation; Spotifast surfaces its instance.
  const next = instance.open();
  await flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, []);
  calls[1].child.emit('spawn');
  await next;
});

test('Open reports spawn errors and permits a subsequent retry without a fallback launch', async () => {
  const { instance, calls } = launcher();
  const error = Object.assign(new Error('Access denied'), { code: 'EACCES' });
  const first = instance.open();
  const rejected = assert.rejects(first, value => value === error);
  await flush();
  calls[0].child.emit('error', error);
  await rejected;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].child.unrefs, 0);
  const next = instance.open();
  await flush();
  calls[1].child.emit('spawn');
  await next;
});

test('Open reports synchronous spawn failures', async () => {
  const instance = new Spotifast({ spawnFile: () => { throw new Error('Invalid executable'); } });
  instance.executable = async () => '/unused.exe';
  await assert.rejects(instance.open(), /Invalid executable/);
});

test('Open reports missing executables without spawning', async () => {
  const { instance, calls } = launcher();
  const missing = Object.assign(new Error('Missing executable'), { messageKey: 'executableMissing' });
  instance.executable = async () => { throw missing; };
  await assert.rejects(instance.open(), error => error === missing);
  assert.equal(calls.length, 0);
});

test('Open honors executable discovery for a custom path containing spaces', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotifast launch '));
  try {
    const exe = path.join(directory, 'spotifast.exe');
    await writeFile(exe, '');
    const calls = [];
    const instance = new Spotifast({ spawnFile: (file, args, options) => {
      calls.push({ file, args, options });
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    } });
    instance.configure(exe);
    await instance.open();
    assert.equal(calls[0].file, exe);
    assert.equal(calls[0].options.cwd, directory);
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[0].args, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('changing configuration cancels queued Open instead of starting an obsolete request', async () => {
  const { instance, calls } = launcher();
  let release;
  const active = instance.queue.run(() => new Promise(resolve => { release = resolve; }));
  await flush();
  const opening = instance.open();
  const rejected = assert.rejects(opening, error => error.messageKey === 'commandExpired');
  instance.configure('/different/spotifast.exe');
  release();
  await active;
  await rejected;
  assert.equal(calls.length, 0);
});
