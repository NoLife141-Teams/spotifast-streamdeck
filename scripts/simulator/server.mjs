import http from 'node:http';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('../../', import.meta.url));
const UUID = 'rocks.spotifast.streamdeck';
const keyActions = ['playpause', 'previous', 'next', 'nowplaying', 'shuffle', 'repeat', 'mute', 'like'];
const keyIcons = ['play', 'previous', 'next', 'music', 'shuffle', 'repeat', 'mute', 'heart'];
const json = (response, status, value) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };

export async function createSimulator({ port = 4319 } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotifast-simulator-'));
  const layout = JSON.parse(await readFile(path.join(root, 'streamdeck/multimedia.json'), 'utf8'));
  const state = { ready: false, error: '', layout, player: {}, trace: [],
    dials: ['multimedia', 'volume', 'multimedia', 'volume'].map((action, index) => ({ id: 'dial-' + index, action, settings: { step: 5 }, feedback: {}, alerts: 0 })),
    keys: keyActions.map((action, index) => ({ id: 'key-' + index, action, icon: keyIcons[index], state: 0, title: '', alerts: 0 })) };
  const listeners = new Set(), pending = new Map();
  let socket, child, server, closed = false, sequence = 0, logs = '';
  const publish = () => { for (const listener of listeners) listener.write('data: ' + JSON.stringify(state) + '\n\n'); };
  function trace(event, detail) { state.trace.unshift({ id: ++sequence, at: new Date().toISOString(), event, detail }); state.trace.length = Math.min(state.trace.length, 60); }
  function send(event, entry, payload = {}) {
    if (!socket || socket.readyState !== 1) throw new Error('SDK disconnected');
    socket.send(JSON.stringify({ event, action: UUID + '.' + entry.action, context: entry.id, device: 'simulator-plus', payload }));
  }
  function appear(entry, index, controller) {
    send('willAppear', entry, { controller, coordinates: { column: index % 4, row: controller === 'Encoder' ? 0 : Math.floor(index / 4) }, settings: entry.settings ?? {}, state: 0, isInMultiAction: false });
  }
  const host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const startup = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SDK startup timed out: ' + logs)), 10000);
    function fail(error) { clearTimeout(timeout); reject(error); }
    host.on('error', fail);
    host.on('connection', connected => {
      if (socket) { connected.close(); return; }
      socket = connected;
      socket.on('close', () => { state.ready = false; state.error = 'SDK déconnecté. Relance le simulateur.'; publish(); });
      socket.on('message', raw => {
        const message = JSON.parse(raw);
        if (message.event === 'getGlobalSettings') socket.send(JSON.stringify({ event: 'didReceiveGlobalSettings', context: message.context, id: message.id, payload: { settings: { language: 'fr' } } }));
        const entry = [...state.dials, ...state.keys].find(item => item.id === message.context);
        if (entry) {
          if (message.event === 'setFeedback') entry.feedback = { ...entry.feedback, ...message.payload };
          if (message.event === 'setImage') entry.image = message.payload.image;
          if (message.event === 'setTitle') entry.title = message.payload.title;
          if (message.event === 'setState') entry.state = message.payload.state;
          if (message.event === 'showAlert') { entry.alerts++; trace('Alerte', entry.id); }
          publish();
        }
      });
    });
    host.once('listening', async () => {
      try {
        await cp(path.join(root, 'streamdeck/manifest.json'), path.join(directory, 'manifest.json'));
        const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
        const info = { application: { language: 'fr', version: '7.1.0.0', platform: 'windows', platformVersion: '10.0' },
          devices: [{ id: 'simulator-plus', name: 'Simulated Stream Deck +', type: 7, size: { columns: 4, rows: 2 } }], plugin: { uuid: UUID, version: metadata.version + '.0' }, devicePixelRatio: 1 };
        child = fork(fileURLToPath(new URL('./runtime.mjs', import.meta.url)), ['-port', String(host.address().port), '-pluginUUID', UUID, '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)], { cwd: directory, silent: true, windowsHide: true });
        child.stdout.on('data', data => { logs = (logs + data).slice(-4000); });
        child.stderr.on('data', data => { logs = (logs + data).slice(-4000); });
        child.on('error', fail);
        child.on('exit', (code, signal) => { if (!closed) { state.ready = false; state.error = 'SDK arrêté : ' + (signal ?? code); publish(); fail(new Error(state.error + logs)); } });
        child.on('message', message => {
          if (message.player) state.player = message.player;
          if (message.command) trace('Commande', message.command.join(' '));
          if (message.ack) { pending.get(message.ack)?.(message); pending.delete(message.ack); }
          if (message.ready) {
            state.ready = true;
            state.keys.forEach((entry, index) => appear(entry, index, 'Keypad'));
            state.dials.forEach((entry, index) => appear(entry, index, 'Encoder'));
            clearTimeout(timeout); resolve();
          }
          publish();
        });
      } catch (error) { fail(error); }
    });
  });
  // Attach immediately so early SDK failures cannot become unhandled rejections.
  startup.catch(() => {});
  async function close() {
    if (closed) return;
    closed = true;
    for (const resolve of pending.values()) resolve({ error: 'Simulator stopped' });
    pending.clear();
    for (const listener of listeners) listener.end();
    listeners.clear();
    if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    for (const client of host.clients) client.terminate();
    await new Promise(resolve => host.close(resolve));
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith('spotifast-simulator-')) throw new Error('Unsafe simulator cleanup');
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await startup;
    server = http.createServer(async (request, response) => {
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('referrer-policy', 'no-referrer');
      const expectedHost = '127.0.0.1:' + server.address().port;
      if (request.headers.host !== expectedHost) { json(response, 403, { error: 'Local host required' }); return; }
      const url = new URL(request.url, 'http://' + expectedHost);
      try {
        if (request.method === 'POST') {
          if (request.headers.origin && request.headers.origin !== 'http://' + expectedHost) { json(response, 403, { error: 'Local origin required' }); return; }
          if (!request.headers['content-type']?.startsWith('application/json')) { json(response, 415, { error: 'JSON required' }); return; }
          let body = '';
          for await (const chunk of request) { body += chunk; if (body.length > 4096) { json(response, 413, { error: 'Request too large' }); return; } }
          const data = JSON.parse(body);
          if (!state.ready) { json(response, 503, { error: state.error || 'SDK not ready' }); return; }
          if (url.pathname === '/api/event') {
            const entry = state.dials[data.index];
            if (!Number.isInteger(data.index) || !entry || !['rotate', 'push', 'touch'].includes(data.type)) throw new Error('Invalid dial event');
            if (data.type === 'rotate' && (!Number.isInteger(data.ticks) || Math.abs(data.ticks) > 32 || !data.ticks)) throw new Error('Ticks must be between -32 and 32, excluding zero');
            if (data.type === 'touch' && (!Array.isArray(data.tapPos) || data.tapPos.length !== 2 || data.tapPos.some((v, i) => !Number.isFinite(v) || v < 0 || v >= [200, 100][i]))) throw new Error('Invalid touch coordinates');
            const event = { rotate: 'dialRotate', push: 'dialDown', touch: 'touchTap' }[data.type];
            send(event, entry, { controller: 'Encoder', settings: entry.settings, ...(data.type === 'rotate' ? { ticks: data.ticks, pressed: false } : data.type === 'touch' ? { tapPos: data.tapPos, hold: false } : {}) });
            trace(event, `Molette ${data.index + 1} · ` + (data.type === 'rotate' ? data.ticks + ' cran(s)' : data.type === 'touch' ? data.tapPos.map(Math.round).join(', ') : 'appui'));
          } else if (url.pathname === '/api/key') {
            if (!Number.isInteger(data.index) || !state.keys[data.index]) throw new Error('Invalid key');
            const entry = state.keys[data.index];
            send('keyDown', entry, { controller: 'Keypad', settings: {}, state: entry.state, isInMultiAction: false });
            trace('keyDown', entry.action);
          } else if (url.pathname === '/api/config') {
            const entry = state.dials[data.index];
            if (!Number.isInteger(data.index) || !entry || !['volume', 'multimedia'].includes(data.action) || !Number.isInteger(data.step) || data.step < 1 || data.step > 25) throw new Error('Invalid dial configuration');
            send('willDisappear', entry, { controller: 'Encoder', settings: entry.settings });
            Object.assign(entry, { action: data.action, settings: { step: data.step }, feedback: {} });
            appear(entry, data.index, 'Encoder'); trace('Configuration', `Molette ${data.index + 1} · ${data.action} · pas ${data.step}`);
          } else if (url.pathname === '/api/scenario') {
            if (!['normal', 'long', 'unknown', 'stopped', 'offline', 'reset'].includes(data.scenario)) throw new Error('Invalid scenario');
            if (data.scenario === 'reset') {
              state.trace = [];
              state.dials.forEach((entry, index) => {
                send('willDisappear', entry, { controller: 'Encoder', settings: entry.settings });
                Object.assign(entry, { action: index % 2 ? 'volume' : 'multimedia', settings: { step: 5 }, feedback: {}, alerts: 0 });
                appear(entry, index, 'Encoder');
              });
            }
            const id = 'scenario-' + ++sequence;
            const result = await new Promise(resolve => {
              const timeout = setTimeout(() => { pending.delete(id); resolve({ error: 'Scenario timeout' }); }, 5000);
              pending.set(id, value => { clearTimeout(timeout); resolve(value); });
              child.send({ scenario: data.scenario, id });
            });
            if (result.error) throw new Error(result.error);
            trace('Scénario', data.scenario);
          } else { json(response, 404, { error: 'Unknown endpoint' }); return; }
          publish(); json(response, 200, { ok: true }); return;
        }
        if (request.method !== 'GET') { json(response, 405, { error: 'Method not allowed' }); return; }
        if (url.pathname === '/api/state') { json(response, 200, state); return; }
        if (url.pathname === '/api/events') {
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          listeners.add(response); response.write('data: ' + JSON.stringify(state) + '\n\n');
          request.on('close', () => listeners.delete(response)); return;
        }
        let file, type;
        if (url.pathname === '/') { file = path.join(root, 'scripts/simulator/ui/index.html'); type = 'text/html; charset=utf-8'; }
        else if (['/app.js', '/style.css'].includes(url.pathname)) { file = path.join(root, 'scripts/simulator/ui', url.pathname.slice(1)); type = url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8'; }
        else if (/^\/imgs\/[a-z0-9-]+(?:@2x)?\.png$/.test(url.pathname)) { file = path.join(root, 'streamdeck', url.pathname.slice(1)); type = 'image/png'; }
        else { json(response, 404, { error: 'Not found' }); return; }
        const bytes = await readFile(file);
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); response.end(bytes);
      } catch (error) { json(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
    });
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    return { url: 'http://127.0.0.1:' + server.address().port, close };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SIMULATOR_PORT ?? 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SIMULATOR_PORT');
  const simulator = await createSimulator({ port });
  console.log('Stream Deck + simulator: ' + simulator.url);
  console.log('Fictional player only. Press Ctrl+C to stop.');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', simulator.url], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('Open this address manually: ' + simulator.url));
    browser.unref();
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => simulator.close().then(() => process.exit(0)));
}
