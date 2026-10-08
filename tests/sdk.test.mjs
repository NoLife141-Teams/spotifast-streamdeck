import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

test('packaged plugin starts with the real SDK on Stream Deck 7.1 and applies global settings', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotifast-sdk-'));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  let child;
  let output = '';
  const messages = [];
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith('spotifast-sdk-'));
    await rm(directory, { recursive: true, force: true });
  });
  await cp(new URL('../build/rocks.spotifast.streamdeck.sdPlugin/', import.meta.url), directory, { recursive: true });
  const executable = path.join(directory, 'missing', 'spotifast.exe');
  const action = 'rocks.spotifast.streamdeck.nowplaying';
  const context = 'sdk-smoke-cover';
  server.on('connection', socket => {
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      if (message.event === 'getGlobalSettings') {
        socket.send(JSON.stringify({ event: 'didReceiveGlobalSettings', context: message.context, id: message.id,
          payload: { settings: { language: 'fr', exePath: executable } } }));
        socket.send(JSON.stringify({ event: 'willAppear', action, context, device: 'sdk-smoke-device',
          payload: { controller: 'Keypad', coordinates: { column: 0, row: 0 }, settings: {}, state: 0, isInMultiAction: false } }));
      }
      if (message.event === 'setTitle' && message.payload.title === 'Ouvrir\nSpotifast') {
        socket.send(JSON.stringify({ event: 'didReceiveGlobalSettings', context: 'sdk-smoke-plugin',
          payload: { settings: { language: 'en', exePath: executable } } }));
      }
    });
  });
  if (!server.address()) await once(server, 'listening');
  child = spawn(process.execPath, [path.join(directory, 'bin', 'plugin.js'),
    '-port', String(server.address().port), '-pluginUUID', 'sdk-smoke-plugin', '-registerEvent', 'registerPlugin',
    '-info', JSON.stringify({ application: { language: 'en', platform: 'windows', platformVersion: '10', version: '7.1.0.0' },
      plugin: { uuid: 'rocks.spotifast.streamdeck', version: '0.2.1.0' }, devicePixelRatio: 1,
      devices: [{ id: 'sdk-smoke-device', name: 'Test Stream Deck', type: 0, size: { columns: 3, rows: 2 } }] })],
    { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (messages.some(message => message.event === 'setTitle' && message.payload.title === 'Open\nSpotifast')) break;
    if (spawnError || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const logFiles = await readdir(path.join(directory, 'logs')).catch(() => []);
  const logs = (await Promise.all(logFiles.map(file => readFile(path.join(directory, 'logs', file), 'utf8')))).join('\n');
  const diagnostics = (spawnError?.message || '') + output + logs;
  assert.ok(messages.some(message => message.event === 'registerPlugin'), 'SDK did not register: ' + diagnostics);
  const request = messages.find(message => message.event === 'getGlobalSettings');
  assert.ok(request?.id, 'SDK v3 did not request settings with a message identifier');
  assert.ok(messages.some(message => message.event === 'setTitle' && message.payload.title === 'Ouvrir\nSpotifast'),
    'Initial French global settings were not applied: ' + diagnostics);
  assert.ok(messages.some(message => message.event === 'setTitle' && message.payload.title === 'Open\nSpotifast'),
    'English global-settings update was not applied: ' + diagnostics);
  assert.ok(!diagnostics.includes('[ERR_NOT_SUPPORTED]'), diagnostics);
});
