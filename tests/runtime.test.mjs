import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRuntime } from '../src/runtime.mjs';
import { ArtworkRenderer } from '../src/artwork.mjs';
import { UUID, LocalizedError } from '../src/core.mjs';

export const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const textMetrics = new ArtworkRenderer();
function key(id = 'nowplaying', instance = id) {
  return { id: instance, manifestId: UUID + '.' + id, isKey: () => true, states: [], images: [], titles: [], alerts: 0,
    async setState(value) { this.states.push(value); }, async setImage(value) { this.images.push(value); }, async setTitle(value) { this.titles.push(value); }, async showAlert() { this.alerts++; } };
}
async function runtime(options = {}) {
  const callbacks = {}, messages = [], warnings = [], errors = [], timeouts = new Map(), intervals = new Map();
  const client = { customPath: '', data: { state: 'paused', title: '', artists: '', volume: 50, repeat: 'off', shuffle: false, saved: 'no', artUrl: '' }, calls: [], reads: 0,
    configure(p = '') { this.customPath = p; },
    async snapshot() { this.reads++; if (this.snapshotError) throw this.snapshotError; return { ...this.data }; },
    async run(args) { this.calls.push(args); if (this.runError) throw this.runError; },
    async open() { this.opened = true; if (this.openError) throw this.openError; }
  };
  const sdk = { info: { application: { language: 'en' } }, connect: async () => {}, actions: {},
    settings: { getGlobalSettings: async () => ({ language: 'fr' }), onDidReceiveSettings: cb => callbacks.settings = cb, onDidReceiveGlobalSettings: cb => callbacks.global = cb },
    ui: { onDidAppear: cb => callbacks.uiAppear = cb, onDidDisappear: cb => callbacks.uiDisappear = cb, onSendToPlugin: cb => callbacks.ui = cb, sendToPropertyInspector: async value => { messages.push({ target: sdk.ui.action.id, ...value }); } },
    system: { onSystemDidWakeUp: cb => callbacks.wake = cb }, logger: { info() {}, warn(value) { warnings.push(value); }, error(error) { errors.push(error); } }
  };
  for (const name of ['onWillAppear', 'onWillDisappear', 'onKeyDown', 'onDialRotate', 'onDialDown', 'onTouchTap']) sdk.actions[name] = cb => callbacks[name] = cb;
  const timers = { setTimeout(cb, delay) { const id = { delay }; timeouts.set(id, cb); return id; }, clearTimeout(id) { timeouts.delete(id); }, setInterval(cb, period) { const id = {}; intervals.set(id, { cb, period }); return id; }, clearInterval(id) { intervals.delete(id); } };
  const artworkRenderer = { async render(image, title, artists, options) { const picture = options.showText === false ? image || 'plain-cover' : 'caption:' + title.replace(/\s+/g, ' ') + '|' + artists + '|' + (image || ''); return picture + (options.playbackFeedback ? '|feedback:' + options.playbackFeedback : ''); } };
  const selectedRenderer = options.artworkRenderer ?? artworkRenderer;
  if (!selectedRenderer.hasScrollingText) selectedRenderer.hasScrollingText = (...args) => textMetrics.hasScrollingText(...args);
  const api = createRuntime(sdk, { client, artwork: { async get() {} }, timers, ...options, artworkRenderer: selectedRenderer });
  await api.start();
  const select = action => { if (sdk.ui.action) callbacks.uiDisappear({ action: sdk.ui.action }); sdk.ui.action = action; if (action) callbacks.uiAppear({ action }); };
  return { api, client, sdk, callbacks, messages, warnings, errors, select, timeouts, intervals };
}

test('labels follow English/French, including wake-up, without changing action settings', async () => {
  const { api, client, callbacks } = await runtime(); const action = key(); api.visible.set(action.id, { action, settings: {} });
  await api.refresh(); assert.equal(action.images.at(-1), 'caption:Aucun morceau||');
  api.configure({ language: 'en' }); await api.refresh(); assert.equal(action.images.at(-1), 'caption:No track||');
  api.configure({ language: 'fr' }); callbacks.wake(); await api.refresh(); assert.equal(action.images.at(-1), 'caption:Aucun morceau||');
  client.snapshotError = new Error('not running'); await api.refresh(); assert.equal(action.titles.at(-1), 'Ouvrir\nSpotifast');
});

test('R01: a failed command invalidates and restores the actual key state', async () => {
  const { api, client } = await runtime(); const action = key('playpause'); client.data.state = 'playing'; api.visible.set(action.id, { action, settings: {} });
  await api.refresh(); assert.equal(action.states.at(-1), 1);
  client.runError = new Error('refused'); await api.perform({ action }, ['play-pause']);
  assert.equal(action.alerts, 1); assert.equal(action.states.at(-1), 1); assert.equal(action.states.length, 2);
  const manifest = JSON.parse(await readFile(new URL('../streamdeck/manifest.json', import.meta.url), 'utf8'));
  for (const item of manifest.Actions.filter(item => item.States.length > 1)) assert.equal(item.DisableAutomaticStates, true);
});

test('R01: successful commands with no state change also force a resync, using one timer', async () => {
  const { api, client, timeouts } = await runtime(); const action = key('playpause'); api.visible.set(action.id, { action, settings: {} }); await api.refresh();
  await api.perform({ action }, ['play-pause']); await api.perform({ action }, ['play-pause']);
  assert.equal(timeouts.size, 1); await api.refresh(); assert.equal(action.states.length, 2); assert.equal(action.states.at(-1), 0);
});

test('R02: Multi Actions issue explicit commands and Favorite is excluded', async () => {
  const { callbacks, client } = await runtime();
  for (const [id, desired, expected] of [['playpause', 1, ['play']], ['playpause', 0, ['pause']], ['shuffle', 1, ['shuffle', 'on']], ['shuffle', 0, ['shuffle', 'off']], ['repeat', 1, ['repeat', 'context']], ['repeat', 0, ['repeat', 'off']]]) {
    callbacks.onKeyDown({ action: key(id), payload: { settings: {}, isInMultiAction: true, userDesiredState: desired } }); await flush(); assert.deepEqual(client.calls.at(-1), expected);
  }
  const action = key('like'); callbacks.onKeyDown({ action, payload: { settings: {}, isInMultiAction: true, userDesiredState: 1 } }); await flush(); assert.equal(action.alerts, 1); assert.equal(client.calls.length, 6);
  const manifest = JSON.parse(await readFile(new URL('../streamdeck/manifest.json', import.meta.url), 'utf8')); assert.equal(manifest.Actions.find(a => a.UUID.endsWith('.like')).SupportedInMultiActions, false);
});

test('R07: errors from another key never enter the currently selected inspector', async () => {
  const { api, messages, select } = await runtime(); select(key('playlist', 'A'));
  await api.performInvalid({ action: key('playlist', 'B') }, new LocalizedError('invalidUri')); assert.equal(messages.length, 0);
  const action = key('playlist', 'A'); await api.performInvalid({ action }, new LocalizedError('invalidUri')); assert.equal(messages.length, 1); assert.equal(messages[0].target, 'A'); assert.match(messages[0].message, /Ajoute un lien/);
});

test('R07: delayed responses cannot cross a selection or a reopen of the same key', async () => {
  const { api, client, messages, select } = await runtime(); const action = key('playlist', 'A'); select(action);
  const old = deferred(); client.snapshot = () => old.promise; const pending = api.inspectorRequest({ action, payload: { type: 'status', requestId: 'old' } }); await flush();
  select(key('playlist', 'B')); select(action); old.resolve({ ...client.data, title: 'Old' }); await pending; assert.equal(messages.length, 0);
});

test('R07: only the latest request for an inspector may display its result', async () => {
  const { api, client, messages, select } = await runtime(); const action = key('playlist', 'A'); select(action); const old = deferred(), recent = deferred(); let index = 0;
  client.snapshot = () => [old, recent][index++].promise;
  const first = api.inspectorRequest({ action, payload: { type: 'status', requestId: 1 } }); await flush(); const second = api.inspectorRequest({ action, payload: { type: 'status', requestId: 2 } }); await flush();
  recent.resolve({ ...client.data, title: 'Current' }); await second; old.resolve({ ...client.data, title: 'Old' }); await first;
  assert.equal(messages.length, 1); assert.equal(messages[0].requestId, 2); assert.equal(messages[0].trackTitle, 'Current');
});

test('R08/R09: open failures and CLI failures report their real localized cause', async () => {
  const { api, client, messages, select } = await runtime(); const action = key('open'); select(action);
  client.openError = new LocalizedError('executableMissing'); await api.inspectorRequest({ action, payload: { type: 'open', requestId: 1 } });
  assert.equal(messages.at(-1).messageKey, 'executableMissing'); assert.match(messages.at(-1).message, /introuvable/);
  client.openError = undefined;
  for (const [error, expected] of [[new LocalizedError('incompleteResponse'), 'incompleteResponse'], [Object.assign(new Error('timeout'), { killed: true }), 'commandTimeout'], [new Error('offline'), 'commandFailed']]) {
    client.snapshotError = error; await api.inspectorRequest({ action, payload: { type: 'status', requestId: expected } }); assert.equal(messages.at(-1).messageKey, expected);
  }
  client.snapshotError = undefined; await api.inspectorRequest({ action, payload: { type: 'open', requestId: 3 } }); assert.equal(messages.at(-1).messageKey, 'connected'); assert.equal(messages.at(-1).requestId, 3);
});

test('R11: pending artwork does not hold metadata polling and stale covers are discarded', async () => {
  const old = deferred(), current = deferred(); const { api, client } = await runtime({ artwork: { get: url => url.endsWith('/old') ? old.promise : current.promise } });
  const cover = key(), transport = key('playpause'); api.visible.set(cover.id, { action: cover, settings: { showText: false } }); api.visible.set(transport.id, { action: transport, settings: {} });
  client.data = { ...client.data, state: 'playing', artUrl: 'https://i.scdn.co/old' }; await api.refresh(); await flush(); assert.equal(transport.states.at(-1), 1);
  client.data = { ...client.data, state: 'paused', title: 'New', artUrl: 'https://i.scdn.co/new' }; await api.refresh(); await flush(); assert.equal(transport.states.at(-1), 0); assert.equal(client.reads, 2);
  old.resolve('old-cover'); await flush(); assert.ok(!cover.images.includes('old-cover'));
  current.resolve('new-cover'); await flush(); assert.equal(cover.images.at(-1), 'new-cover');
});

test('artwork checkbox and new profiles use the current cover without native title wrapping', async () => {
  const { api, client } = await runtime({ artwork: { async get() { return 'cover'; } } }); client.data = { ...client.data, title: 'Perfect', artists: 'Kaley, LYON', artUrl: 'https://i.scdn.co/cover' };
  const action = key(); const entry = { action, settings: {} }; api.visible.set(action.id, entry); await api.refresh(); await flush();
  assert.equal(action.images.at(-1), 'caption:Perfect|Kaley, LYON|cover'); assert.equal(action.titles.at(-1), '');
  entry.settings.showText = false; await api.refresh(); assert.equal(action.images.at(-1), 'cover');
});

test('a delayed render is discarded when its action disappears', async () => {
  const delayed = deferred(); const { api, callbacks } = await runtime({ artworkRenderer: { render: () => delayed.promise } }); const action = key(); api.visible.set(action.id, { action, settings: {} });
  const pending = api.refresh(); await flush(); callbacks.onWillDisappear({ action }); delayed.resolve('old-image'); await pending; assert.equal(action.images.length, 0);
});

test('Favorite follows the saved track state and never confirms a failed change', async () => {
  const { api, client, callbacks } = await runtime();
  const action = key('like'); api.visible.set(action.id, { action, settings: {} });
  client.data.saved = 'no'; await api.refresh(); assert.equal(action.states.at(-1), 0);
  callbacks.onKeyDown({ action, payload: { settings: {} } }); await flush();
  assert.deepEqual(client.calls, [['like']]);
  assert.equal(action.states.at(-1), 0, 'An unconfirmed command must not fill the heart');
  client.data.saved = 'yes'; await api.refresh(); assert.equal(action.states.at(-1), 1);
  client.runError = new Error('refused'); await api.perform({ action }, ['like']);
  assert.equal(action.alerts, 1); assert.equal(action.states.at(-1), 1);
  client.runError = undefined; client.data.saved = 'no'; client.data.title = 'Next track';
  await api.refresh(); assert.equal(action.states.at(-1), 0);
});

test('artwork stays clear at rest and controls playback when all optional overlays are hidden', async () => {
  const { api, client, callbacks, intervals } = await runtime({ artwork: { async get() { return 'cover'; } } });
  const action = key();
  const settings = { showText: false, scrollText: false, showRemaining: false };
  api.visible.set(action.id, { action, settings });
  client.data = { ...client.data, state: 'paused', title: 'Track', artUrl: 'https://i.scdn.co/cover' };
  await api.refresh(); await flush();
  assert.equal(action.images.at(-1), 'cover');
  assert.ok(![...intervals.values()].some(timer => timer.period === 100));
  callbacks.onKeyDown({ action, payload: { settings } }); await flush();
  assert.deepEqual(client.calls, [['play-pause']]);
  client.data.state = 'playing'; await api.refresh();
  assert.equal(action.images.at(-1), 'cover|feedback:playing');
  client.snapshotError = new Error('offline'); await api.refresh();
  assert.equal(action.images.at(-1), 'imgs/music.png');
  assert.equal(action.titles.at(-1), 'Ouvrir\nSpotifast');
});

test('playback feedback waits for confirmation, fades, and restores hidden-overlay artwork without CLI reads', async () => {
  let clock = 0;
  const { api, client, timeouts, intervals } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { return JSON.stringify(options); } } });
  const action = key(); api.visible.set(action.id, { action, settings: { showText: false, scrollText: false, showRemaining: false } });
  client.data = { ...client.data, state: 'playing', title: 'Track' };
  const frame = () => JSON.parse(action.images.at(-1));
  await api.refresh(); assert.equal(frame().playbackFeedback, undefined);
  await api.perform({ action }, ['play-pause']); await api.refresh();
  assert.equal(frame().playbackFeedback, undefined, 'Command acceptance is not playback confirmation');
  client.data.state = 'paused'; await api.refresh();
  assert.equal(frame().playbackFeedback, 'paused'); assert.equal(frame().feedbackOpacity, 1);
  assert.ok([...intervals.values()].some(timer => timer.period === 100));
  const reads = client.reads;
  clock = 900; await api.animate(); assert.equal(frame().feedbackOpacity, 0.5);
  const [expiryId, expiry] = [...timeouts].find(([id]) => id.delay === 1000);
  clock = 1000; timeouts.delete(expiryId); expiry(); await flush();
  assert.equal(frame().playbackFeedback, undefined);
  assert.equal(client.reads, reads, 'Restoring the artwork must not query the player');
  assert.ok(![...intervals.values()].some(timer => timer.period === 100));
  await api.perform({ action }, ['play-pause']); client.data.state = 'playing'; await api.refresh();
  assert.equal(frame().playbackFeedback, 'playing');
  expiry(); await flush(); assert.equal(frame().playbackFeedback, 'playing', 'An older expiry cannot clear newer feedback');
  clock = 2000; await api.animate(); assert.equal(frame().playbackFeedback, undefined);
  assert.ok(![...timeouts.keys()].some(id => id.delay === 1000));
  api.stop(); assert.equal(timeouts.size, 0); assert.equal(intervals.size, 0);
});

test('external changes, failed commands, expired confirmations and configuration changes never show success feedback', async () => {
  let clock = 0;
  const { api, client } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { return JSON.stringify(options); } } });
  const action = key(); api.visible.set(action.id, { action, settings: {} });
  const frame = () => JSON.parse(action.images.at(-1));
  client.data.title = 'Track'; await api.refresh();
  client.data.state = 'playing'; await api.refresh(); assert.equal(frame().playbackFeedback, undefined);
  client.runError = new Error('refused'); await api.perform({ action }, ['play-pause']);
  assert.equal(action.alerts, 1); assert.equal(frame().playbackFeedback, undefined);
  client.runError = undefined; await api.perform({ action }, ['play-pause']);
  clock = 6000; client.data.state = 'paused'; await api.refresh(); assert.equal(frame().playbackFeedback, undefined);
  const delayed = deferred(); client.run = () => delayed.promise;
  const pending = api.perform({ action }, ['play-pause']); await flush();
  client.data.state = 'playing'; await api.refresh(); assert.equal(frame().playbackFeedback, undefined);
  api.configure({ language: 'en' }); delayed.resolve(); await pending; await api.refresh();
  assert.equal(frame().playbackFeedback, undefined);
  api.stop();
});

test('explicit playback commands only confirm their requested state', async () => {
  for (const [command, target, opposite] of [['play', 'playing', 'paused'], ['pause', 'paused', 'playing']]) {
    const { api, client } = await runtime({ artworkRenderer: { async render(image, title, artists, options) { return JSON.stringify(options); } } });
    const artwork = key(); api.visible.set(artwork.id, { action: artwork, settings: {} });
    const transport = key('playpause');
    const frame = () => JSON.parse(artwork.images.at(-1));
    client.data = { ...client.data, title: 'Track', state: target }; await api.refresh();
    await api.perform({ action: transport }, [command]);
    client.data.state = opposite; await api.refresh();
    assert.equal(frame().playbackFeedback, undefined, 'An external change away from the requested state must not confirm the command');
    await api.perform({ action: transport }, [command]);
    await api.refresh(); assert.equal(frame().playbackFeedback, undefined, 'Command acceptance must still wait for its requested playback state');
    client.data.state = target; await api.refresh();
    assert.equal(frame().playbackFeedback, target, 'The matching state change must confirm the explicit command');
    api.stop();
  }
});

test('rapid presses, profile changes and new tracks cannot replay an old playback confirmation', async () => {
  let clock = 0;
  const { api, client, callbacks, timeouts } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { return JSON.stringify(options); } } });
  const action = key(); api.visible.set(action.id, { action, settings: {} });
  const frame = () => JSON.parse(action.images.at(-1));
  client.data = { ...client.data, title: 'Track', state: 'playing' }; await api.refresh();
  const first = deferred(), second = deferred(); let call = 0;
  client.run = () => (++call === 1 ? first.promise : second.promise);
  const oldPress = api.perform({ action }, ['play-pause']); await flush();
  client.data.state = 'paused'; await api.refresh(); assert.equal(frame().playbackFeedback, undefined);
  const recentPress = api.perform({ action }, ['play-pause']); await flush();
  client.data.state = 'playing'; second.resolve(); await recentPress; await api.refresh();
  assert.equal(frame().playbackFeedback, 'playing');
  const expiry = [...timeouts].find(([id]) => id.delay === 1000)[1];
  first.resolve(); await oldPress; await api.refresh(); assert.equal(frame().playbackFeedback, 'playing');
  callbacks.onWillDisappear({ action });
  assert.ok(![...timeouts.keys()].some(id => id.delay === 1000));
  callbacks.onWillAppear({ action, payload: { settings: {} } }); await api.refresh();
  expiry(); await flush(); assert.equal(frame().playbackFeedback, undefined);
  client.run = async () => {};
  await api.perform({ action }, ['play-pause']); client.data.state = 'paused'; await api.refresh();
  assert.equal(frame().playbackFeedback, 'paused');
  client.data.title = 'New track'; await api.refresh(); assert.equal(frame().playbackFeedback, undefined);
  const late = deferred(); client.run = () => late.promise;
  const stoppedPress = api.perform({ action }, ['play-pause']); await flush(); api.stop();
  late.resolve(); await stoppedPress; assert.equal(timeouts.size, 0);
});

test('animation advances captions and countdown without extra CLI reads, and resets for a new track', async () => {
  let clock = 1000;
  const frames = [];
  const { api, client, callbacks, intervals } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { frames.push({ title, ...options }); return JSON.stringify([title, options]); } } });
  client.data = { ...client.data, state: 'playing', title: 'Very long title', artists: 'Very long artist', position: 10000, duration: 120000 };
  const action = key(); callbacks.onWillAppear({ action, payload: { settings: {} } }); await api.refresh();
  const reads = client.reads;
  assert.equal(frames.at(-1).elapsedMs, 0);
  assert.equal(frames.at(-1).remainingMs, 110000);
  assert.ok([...intervals.values()].some(timer => timer.period === 100));
  const titles = action.titles.length;
  clock += 3200; await api.animate();
  assert.equal(frames.at(-1).elapsedMs, 3200);
  assert.equal(frames.at(-1).remainingMs, 106800);
  assert.equal(client.reads, reads);
  assert.equal(action.titles.length, titles, 'Animation should update only the image');
  client.data = { ...client.data, title: 'New title', position: 0 }; await api.refresh();
  assert.equal(frames.at(-1).elapsedMs, 0);
  assert.equal(frames.at(-1).remainingMs, 120000);
  callbacks.onWillDisappear({ action }); assert.ok(![...intervals.values()].some(timer => timer.period === 100));
  api.stop(); assert.equal(intervals.size, 0);
});

test('paused countdown is stable; timer, text and animation can be disabled independently', async () => {
  let clock = 0;
  const frames = [];
  const { api, client, callbacks, intervals } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { frames.push(options); return JSON.stringify(options); } } });
  const action = key(); const entry = { action, settings: { showText: false } }; api.visible.set(action.id, entry);
  client.data = { ...client.data, state: 'paused', title: 'Paused', position: 10000, duration: 120000 };
  await api.refresh(); clock += 4000; await api.animate();
  assert.equal(frames.at(-1).remainingMs, 110000); assert.equal(frames.at(-1).showText, false);
  callbacks.settings({ action, payload: { settings: { showText: true, scrollText: false, showRemaining: false } } }); await api.refresh();
  assert.equal(frames.at(-1).scrollText, false); assert.equal(frames.at(-1).remainingMs, undefined);
  assert.ok(![...intervals.values()].some(timer => timer.period === 100));
  client.snapshotError = new Error('offline'); await api.refresh(); const count = frames.length; await api.animate(); assert.equal(frames.length, count);
  api.stop();
});

test('artwork defaults to one line and resets scrolling when its layout changes', async () => {
  let clock = 1000;
  const frames = [];
  const { api, callbacks, client } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { frames.push(options); return JSON.stringify(options); } } });
  const action = key(); api.visible.set(action.id, { action, settings: {} });
  client.data = { ...client.data, title: 'A very long track title', artists: 'Artist' };
  await api.refresh(); assert.equal(frames.at(-1).captionLayout, 'compact');
  clock += 5000; await api.animate(); assert.equal(frames.at(-1).elapsedMs, 5000);
  callbacks.settings({ action, payload: { settings: { captionLayout: 'twoLines' } } });
  await api.refresh();
  assert.equal(frames.at(-1).captionLayout, 'twoLines'); assert.equal(frames.at(-1).elapsedMs, 0);
  callbacks.settings({ action, payload: { settings: { captionLayout: 'invalid' } } });
  await api.refresh(); assert.equal(frames.at(-1).captionLayout, 'compact');
  assert.equal(client.calls.length, 0, 'Layout changes must not send playback commands');
  api.stop();
});

test('slow animation frames are not queued and cannot overwrite a newer track', async () => {
  const waiting = deferred(); let delayed = false, clock = 0;
  const { api, client } = await runtime({ now: () => clock, artworkRenderer: { render: (image, title) => delayed ? waiting.promise : Promise.resolve(title) } });
  const action = key(); api.visible.set(action.id, { action, settings: {} }); client.data.title = 'A very long old track title'; await api.refresh();
  delayed = true; clock = 2000; const first = api.animate(); const second = api.animate(); assert.equal(first, second); await flush();
  delayed = false; client.data.title = 'A very long new track title'; await api.refresh(); waiting.resolve('Stale'); await first;
  assert.equal(action.images.at(-1), 'A very long new track title'); assert.ok(!action.images.includes('Stale')); api.stop();
});

test('short paused captions stay idle and a playing countdown runs once per second', async () => {
  let clock = 0;
  const frames = [];
  const { api, client, intervals } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { frames.push(options); return JSON.stringify(options); } } });
  const action = key(); api.visible.set(action.id, { action, settings: {} });
  const periods = () => [...intervals.values()].filter(timer => timer.period !== 1500).map(timer => timer.period);
  client.data = { ...client.data, state: 'paused', title: 'Hi', position: 10000, duration: 120000 };
  await api.refresh(); assert.deepEqual(periods(), []);
  const pausedFrames = frames.length;
  clock = 2000; await api.animate(); assert.equal(frames.length, pausedFrames);
  client.data.state = 'playing'; await api.refresh(); assert.deepEqual(periods(), [1000]);
  const reads = client.reads, playingFrames = frames.length;
  clock = 2500; await api.animate(); assert.equal(frames.length, playingFrames + 1);
  // Even when invoked more often, a timer-only entry is throttled to one frame per second.
  clock = 2900; await api.animate(); assert.equal(frames.length, playingFrames + 1);
  clock = 3500; await api.animate(); assert.equal(frames.at(-1).remainingMs, 108500);
  assert.equal(client.reads, reads);
  client.data.state = 'paused'; await api.refresh(); assert.deepEqual(periods(), []);
  api.stop(); assert.equal(intervals.size, 0);
});

test('layout, track and visibility changes enable only necessary scrolling', async () => {
  const { api, client, callbacks, intervals } = await runtime();
  const action = key();
  const periods = () => [...intervals.values()].filter(timer => timer.period !== 1500).map(timer => timer.period);
  client.data = { ...client.data, title: 'WWWW', artists: 'WWWW' };
  callbacks.onWillAppear({ action, payload: { settings: { captionLayout: 'twoLines' } } }); await api.refresh();
  assert.deepEqual(periods(), []);
  callbacks.settings({ action, payload: { settings: { captionLayout: 'compact' } } }); await api.refresh();
  assert.deepEqual(periods(), [100]);
  callbacks.settings({ action, payload: { settings: { captionLayout: 'compact', scrollText: false } } }); await api.refresh();
  assert.deepEqual(periods(), []);
  callbacks.settings({ action, payload: { settings: { showText: false } } }); await api.refresh();
  assert.deepEqual(periods(), []);
  callbacks.settings({ action, payload: { settings: {} } }); await api.refresh(); assert.deepEqual(periods(), [100]);
  client.data = { ...client.data, title: 'Hi', artists: '' }; await api.refresh(); assert.deepEqual(periods(), []);
  client.data.title = 'A very long new track title'; await api.refresh(); assert.deepEqual(periods(), [100]);
  callbacks.onWillDisappear({ action }); assert.deepEqual(periods(), []);
  api.stop();
});

test('a scrolling key does not make a timer-only key render ten times per second', async () => {
  let clock = 0;
  const frames = [];
  const { api, client, intervals } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { frames.push(options.showText); return JSON.stringify(options); } } });
  const scroll = key('nowplaying', 'scroll'), timer = key('nowplaying', 'timer');
  api.visible.set(scroll.id, { action: scroll, settings: { showRemaining: false } });
  api.visible.set(timer.id, { action: timer, settings: { showText: false } });
  client.data = { ...client.data, state: 'playing', title: 'An exceptionally long song title', duration: 120000, position: 0 };
  await api.refresh(); frames.length = 0;
  assert.equal([...intervals.values()].filter(item => item.period === 100).length, 1);
  const reads = client.reads;
  for (clock = 100; clock <= 1000; clock += 100) await api.animate();
  assert.equal(frames.filter(showText => showText).length, 10);
  assert.equal(frames.filter(showText => !showText).length, 1);
  assert.equal(client.reads, reads);
  api.stop();
});

test('unknown, finished and stale countdowns do not keep an animation loop alive', async () => {
  let clock = 0;
  const frames = [];
  const { api, client, intervals } = await runtime({ now: () => clock, artworkRenderer: { async render(image, title, artists, options) { frames.push(options); return JSON.stringify(options); } } });
  const action = key(); api.visible.set(action.id, { action, settings: { showText: false } });
  const periods = () => [...intervals.values()].filter(timer => timer.period !== 1500).map(timer => timer.period);
  for (const data of [{ state: 'playing', duration: 0, position: 0 }, { state: 'stopped', duration: 1000, position: 0 }, { state: 'playing', duration: 1000, position: 1000 }]) {
    client.data = { ...client.data, ...data }; await api.refresh(); assert.deepEqual(periods(), []);
  }
  client.data = { ...client.data, state: 'playing', duration: 1000, position: 0 }; await api.refresh(); assert.deepEqual(periods(), [1000]);
  clock = 1000; await api.animate(); assert.deepEqual(periods(), []); assert.equal(frames.at(-1).remainingMs, 0);
  client.data.duration = 120000; await api.refresh(); assert.deepEqual(periods(), [1000]);
  clock = 6000; await api.animate(); assert.deepEqual(periods(), []);
  await api.refresh(); assert.deepEqual(periods(), [1000]);
  client.snapshotError = new Error('offline'); await api.refresh(); assert.deepEqual(periods(), []);
  api.stop();
});

test('playback feedback temporarily accelerates a stationary artwork key', async () => {
  let clock = 0;
  const { api, client, timeouts, intervals } = await runtime({ now: () => clock });
  const action = key(); api.visible.set(action.id, { action, settings: {} });
  const periods = () => [...intervals.values()].filter(timer => timer.period !== 1500).map(timer => timer.period);
  client.data = { ...client.data, title: 'Hi', state: 'paused', duration: 120000, position: 0 };
  await api.refresh(); assert.deepEqual(periods(), []);
  await api.perform({ action }, ['play-pause']); client.data.state = 'playing'; await api.refresh();
  assert.deepEqual(periods(), [100]);
  const [expiryId, expiry] = [...timeouts].find(([id]) => id.delay === 1000);
  clock = 1000; timeouts.delete(expiryId); expiry(); await flush();
  assert.deepEqual(periods(), [1000]);
  client.data.state = 'paused'; await api.refresh(); assert.deepEqual(periods(), []);
  api.stop();
});

test('delayed text measurement cannot restart animation after a key disappears', async () => {
  const waiting = deferred();
  const { api, callbacks, client, intervals } = await runtime({ artworkRenderer: { async render() { return 'cover'; }, hasScrollingText: () => waiting.promise } });
  const action = key(); api.visible.set(action.id, { action, settings: {} }); client.data.title = 'Long title';
  const pending = api.refresh(); await flush(); callbacks.onWillDisappear({ action });
  waiting.resolve(true); await pending;
  assert.ok(![...intervals.values()].some(timer => timer.period === 100));
  assert.equal(action.images.length, 0);
  api.stop();
});
