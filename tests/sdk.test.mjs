import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

test('real Elgato SDK routes macro states and inspector failures to their originating action', { timeout: 15000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temporaryRoot = path.join(root, '.local-backups');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(path.join(temporaryRoot, 'sdk-test-'));
  await cp(path.join(root, 'streamdeck/manifest.json'), path.join(directory, 'manifest.json'));
  const host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(host, 'listening');
  const messages = [], events = new EventEmitter();
  const receive = message => { messages.push(message); events.emit('message'); };
  function waitFor(predicate) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const message = messages.find(predicate);
        if (message) { clearTimeout(timeout); events.off('message', check); resolve(message); }
      };
      const timeout = setTimeout(() => { events.off('message', check); reject(new Error('SDK message timeout: ' + JSON.stringify(messages))); }, 5000);
      events.on('message', check);
      check();
    });
  }
  const connection = once(host, 'connection');
  const info = { application: { language: 'fr', version: '7.4.0', platform: 'windows', platformVersion: '10.0' }, devices: [{ id: 'test-device', name: 'Test', type: 0, size: { columns: 5, rows: 3 } }], plugin: { uuid: 'rocks.spotifast.streamdeck', version: '0.2.2.0' } };
  const child = fork(fileURLToPath(new URL('./fixtures/sdk-runtime.mjs', import.meta.url)), ['-port', String(host.address().port), '-pluginUUID', 'rocks.spotifast.streamdeck', '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)], { cwd: directory, silent: true });
  child.on('message', receive);
  let socket;
  try {
    [socket] = await connection;
    socket.on('message', raw => {
      const message = JSON.parse(raw);
      receive(message);
      if (message.event === 'getGlobalSettings') socket.send(JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: { language: 'fr' } } }));
    });
    await waitFor(message => message.ready);
    assert.equal((await waitFor(message => message.event === 'registerPlugin')).uuid, 'rocks.spotifast.streamdeck');
    const action = 'rocks.spotifast.streamdeck.playpause';
    const send = (event, context, payload = {}) => socket.send(JSON.stringify({ event, context, action, device: 'test-device', payload }));
    send('willAppear', 'key-a', { controller: 'Keypad', coordinates: { column: 0, row: 0 }, settings: {}, isInMultiAction: false });
    assert.equal((await waitFor(message => message.event === 'setState' && message.context === 'key-a')).payload.state, 0);
    send('keyDown', 'key-a', { settings: {}, isInMultiAction: true, userDesiredState: 1 });
    assert.deepEqual((await waitFor(message => message.command)).command, ['play']);
    send('propertyInspectorDidAppear', 'key-a');
    send('sendToPlugin', 'key-a', { type: 'open', requestId: 'sdk-open' });
    const failure = await waitFor(message => message.event === 'sendToPropertyInspector' && message.payload.requestId === 'sdk-open');
    assert.equal(failure.context, 'key-a');
    assert.equal(failure.payload.messageKey, 'executableMissing');
    assert.equal(failure.payload.online, false);
    assert.match(failure.payload.message, /introuvable/);
    assert.equal(messages.some(message => message.event === 'setGlobalSettings'), false);
  } finally {
    socket?.terminate();
    const ended = once(child, 'exit');
    child.kill();
    await ended;
    await new Promise(resolve => host.close(resolve));
    if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith('sdk-test-')) throw new Error('Unsafe SDK fixture cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
