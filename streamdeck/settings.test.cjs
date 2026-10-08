const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const translations = require('./ui/i18n.js');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, 'ui/settings.js'), 'utf8');
function inspector({ action = 'playlist', settings = {}, globals = {}, ready = true } = {}) {
  const elements = new Map(); const element = id => { if (!elements.has(id)) elements.set(id, { value: '', checked: false, hidden: false, disabled: false, style: {} }); return elements.get(id); };
  class Socket { static OPEN = 1; constructor() { this.readyState = 0; this.messages = []; Socket.last = this; } send(text) { this.messages.push(JSON.parse(text)); } }
  const window = {}, document = { activeElement: null, documentElement: {}, getElementById: element, querySelectorAll: () => [] };
  vm.runInNewContext(source, { window, document, WebSocket: Socket, SpotifastI18n: translations });
  window.connectElgatoStreamDeckSocket(28196, 'live-inspector', 'registerPropertyInspector', '{}', JSON.stringify({ action: 'rocks.spotifast.streamdeck.' + action, context: 'different-instance', payload: { settings: { uri: 'spotify:playlist:Old', step: 5, showText: true, preserved: 'keep', ...settings } } }));
  const socket = Socket.last; socket.readyState = Socket.OPEN; socket.onopen();
  const receive = (event, payload) => socket.onmessage({ data: JSON.stringify({ event, payload }) });
  const sent = event => socket.messages.filter(message => message.event === event);
  if (ready) receive('didReceiveGlobalSettings', { settings: { preservedGlobal: true, ...globals } });
  return { element, socket, document, receive, sent };
}

test('registration and all outbound commands preserve property-inspector routing', () => {
  const { socket, element, sent } = inspector();
  assert.deepEqual(socket.messages[0], { event: 'registerPropertyInspector', uuid: 'live-inspector' });
  element('check').onclick(); element('open').onclick(); element('uri').value = 'https://open.spotify.com/playlist/Selected'; element('uri').onchange();
  for (const message of socket.messages.slice(1)) { assert.equal(message.context, 'live-inspector'); assert.equal(message.action, 'rocks.spotifast.streamdeck.playlist'); }
  assert.equal(sent('sendToPlugin')[0].payload.type, 'status'); assert.equal(sent('sendToPlugin').at(-1).payload.type, 'open'); assert.ok(sent('sendToPlugin')[0].payload.requestId);
  assert.equal(sent('setSettings').at(-1).payload.preserved, 'keep');
});

test('R03: global controls remain disabled and cannot overwrite settings before they load', () => {
  const { element, receive, sent } = inspector({ ready: false });
  assert.equal(element('language').disabled, true); assert.equal(element('exe').disabled, true); assert.equal(element('check').disabled, true);
  element('language').value = 'fr'; element('language').onchange(); assert.equal(sent('setGlobalSettings').length, 0); assert.equal(sent('sendToPlugin').length, 0);
  receive('didReceiveGlobalSettings', { settings: { exePath: 'D:/Portable/spotifast.exe', preservedGlobal: true } });
  assert.equal(element('language').disabled, false); element('language').value = 'fr'; element('language').onchange(); const save = sent('setGlobalSettings').at(-1);
  assert.equal(save.payload.exePath, 'D:/Portable/spotifast.exe'); assert.equal(save.payload.preservedGlobal, true); assert.equal(save.payload.language, 'fr');
});

test('R03: a global edit waits for its saved value, preserving fields and ignoring older replies', () => {
  const { element, receive, sent, document } = inspector({ globals: { language: 'en', exePath: 'D:/Portable/spotifast.exe' } });
  element('language').value = 'fr'; element('language').onchange(); assert.equal(element('language').disabled, true); assert.equal(document.documentElement.lang, 'fr');
  receive('didReceiveGlobalSettings', { settings: { language: 'en', exePath: 'D:/Portable/spotifast.exe' } }); assert.equal(element('language').disabled, true); assert.equal(document.documentElement.lang, 'fr');
  const save = sent('setGlobalSettings').at(-1).payload; receive('didReceiveGlobalSettings', { settings: save }); assert.equal(element('language').disabled, false);
  element('exe').value = ' E:/New/spotifast.exe '; element('exe').onchange(); const latest = sent('setGlobalSettings').at(-1).payload;
  assert.equal(latest.exePath, 'E:/New/spotifast.exe'); assert.equal(latest.language, 'fr');
  receive('didReceiveGlobalSettings', { settings: save }); assert.equal(element('exe').value, 'E:/New/spotifast.exe'); assert.equal(element('exe').disabled, true);
  receive('didReceiveGlobalSettings', { settings: latest }); assert.equal(element('exe').disabled, false);
});

test('R06: received action settings are preserved when changing another field', () => {
  const { element, receive, sent } = inspector();
  receive('didReceiveSettings', { settings: { uri: 'spotify:playlist:New', step: 10, showText: true, unknown: 'preserve' } });
  assert.equal(element('uri').value, 'spotify:playlist:New'); assert.equal(element('step').value, 10);
  element('showText').checked = false; element('showText').onchange(); const save = sent('setSettings').at(-1).payload;
  assert.equal(save.uri, 'spotify:playlist:New'); assert.equal(save.step, 10); assert.equal(save.unknown, 'preserve'); assert.equal(save.showText, false); assert.equal(sent('getSettings').length, 1);
});

test('R06: editing one field does not clobber the latest other fields or a focused draft', () => {
  const { element, receive, sent, document } = inspector(); document.activeElement = element('uri'); element('uri').value = 'spotify:playlist:Draft';
  receive('didReceiveSettings', { settings: { uri: 'spotify:playlist:Remote', step: 15, showText: true } }); assert.equal(element('uri').value, 'spotify:playlist:Draft');
  element('showText').checked = false; element('showText').onchange(); assert.equal(sent('setSettings').at(-1).payload.uri, 'spotify:playlist:Remote'); assert.equal(sent('setSettings').at(-1).payload.step, 15);
  element('uri').onchange(); assert.equal(sent('setSettings').at(-1).payload.uri, 'spotify:playlist:Draft');
});

test('R07: old status replies never replace the latest request result', () => {
  const { element, receive, sent } = inspector(); const old = sent('sendToPlugin').at(-1).payload.requestId; element('check').onclick(); const latest = sent('sendToPlugin').at(-1).payload.requestId;
  receive('sendToPropertyInspector', { type: 'status', messageKey: 'connected', online: true, requestId: latest }); assert.match(element('status').textContent, /Choose a track/);
  receive('sendToPropertyInspector', { type: 'status', messageKey: 'commandFailed', online: false, requestId: old }); assert.match(element('status').textContent, /Choose a track/);
});

test('R13: volume steps are rounded, bounded and redisplayed exactly as executed', () => {
  const { element, sent } = inspector({ action: 'volumeup' });
  for (const [input, expected] of [['1.9', 2], ['99', 25], ['-1', 1], ['', 5], ['Infinity', 5]]) {
    element('step').value = input; element('step').onchange(); assert.equal(sent('setSettings').at(-1).payload.step, expected); assert.equal(Number(element('step').value), expected);
  }
});

test('both languages translate messages immediately and preserve unknown global fields', () => {
  const { element, receive, sent, document } = inspector(); element('language').value = 'fr'; element('language').onchange(); receive('didReceiveGlobalSettings', { settings: sent('setGlobalSettings').at(-1).payload });
  receive('sendToPropertyInspector', { type: 'status', messageKey: 'connected', online: true }); assert.equal(document.documentElement.lang, 'fr'); assert.match(element('status').textContent, /Choisis un morceau/);
  element('language').value = 'en'; element('language').onchange(); assert.equal(document.documentElement.lang, 'en'); assert.match(element('help').textContent, /Spotifast must/); assert.equal(sent('setGlobalSettings').at(-1).payload.preservedGlobal, true);
});

test('lost socket disables edits and displays a localized recovery message', () => {
  const { element, socket, sent } = inspector(); socket.onerror(); assert.equal(element('uri').disabled, true); assert.equal(element('language').disabled, true); assert.match(element('status').textContent, /Connection to Stream Deck was lost/);
  const before = socket.messages.length; element('uri').onchange(); element('language').onchange(); element('check').onclick(); assert.equal(socket.messages.length, before); assert.equal(sent('setSettings').length, 0);
});