const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const translations = require('./ui/i18n.js');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, 'ui/settings.js'), 'utf8');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { value: '', checked: false, hidden: false, style: {} });
  return elements.get(id);
};
class Socket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.messages = []; Socket.last = this; }
  send(text) { this.messages.push(JSON.parse(text)); }
}
const window = {}; const documentState = {};
vm.runInNewContext(source, { window, document: { getElementById: element, documentElement: documentState, querySelectorAll: () => [] }, WebSocket: Socket, SpotifastI18n: translations });
const piId = 'live-property-inspector';
const actionId = 'rocks.spotifast.streamdeck.playlist';
window.connectElgatoStreamDeckSocket(28196, piId, 'registerPropertyInspector', '{}', JSON.stringify({
  action: actionId, context: 'different-action-instance',
  payload: { settings: { uri: 'spotify:playlist:existing123', step: 5, showText: true, preserved: 'keep' } }
}));
const socket = Socket.last;
assert.equal(element('uri').value, 'spotify:playlist:existing123');
assert.equal(element('playlist').hidden, false);
socket.readyState = Socket.OPEN;
socket.onopen();
assert.deepEqual(socket.messages[0], { event: 'registerPropertyInspector', uuid: piId });
const verifyRouting = message => {
  assert.equal(message.context, piId, `${message.event} must use the property-inspector identifier`);
  assert.equal(message.action, actionId, `${message.event} must include the action type`);
};
verifyRouting(socket.messages[2]);
socket.messages.slice(1).forEach(verifyRouting);
assert.equal(socket.messages[1].event, 'getGlobalSettings');
assert.equal(socket.messages[2].payload.type, 'status');
element('check').onclick();
verifyRouting(socket.messages.at(-1));
assert.equal(socket.messages.at(-1).payload.type, 'status');
element('open').onclick();
verifyRouting(socket.messages.at(-1));
assert.equal(socket.messages.at(-1).payload.type, 'open');
socket.onmessage({ data: JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: { preservedGlobal: true } } }) });
element('exe').value = ' C:\\Programs\\Spotifast\\spotifast.exe ';
element('exe').onchange();
const globalSave = socket.messages.at(-2);
verifyRouting(globalSave);
assert.equal(globalSave.event, 'setGlobalSettings');
assert.equal(globalSave.payload.preservedGlobal, true);
assert.equal(globalSave.payload.exePath, 'C:\\Programs\\Spotifast\\spotifast.exe');
element('uri').value = ' https://open.spotify.com/playlist/selected123 ';
element('step').value = '99';
element('showText').checked = false;
element('uri').onchange();
const actionSave = socket.messages.at(-1);
verifyRouting(actionSave);
assert.equal(actionSave.event, 'setSettings');
assert.equal(actionSave.payload.uri, 'https://open.spotify.com/playlist/selected123');
assert.equal(actionSave.payload.step, 25);
assert.equal(actionSave.payload.showText, false);
assert.equal(actionSave.payload.preserved, 'keep');
socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: { type: 'status', online: true, message: 'Connected' } }) });
assert.equal(element('status').textContent, 'Connected');
assert.equal(element('status').style.borderColor, '#a3e635');
assert.doesNotThrow(() => socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector' }) }));
socket.readyState = 3;
const previousCount = socket.messages.length;
assert.doesNotThrow(() => element('check').onclick());
assert.equal(socket.messages.length, previousCount);
socket.readyState = Socket.OPEN;
socket.onmessage({ data: JSON.stringify({ event: 'didReceiveGlobalSettings', payload: { settings: { language: 'fr', preservedGlobal: true } } }) });
assert.equal(documentState.lang, 'fr');
assert.match(element('help').textContent, /Spotifast doit/);
socket.onmessage({ data: JSON.stringify({ event: 'sendToPropertyInspector', payload: { type: 'status', messageKey: 'connected', online: true } }) });
assert.match(element('status').textContent, /Choisis un morceau/);
element('language').value = 'en';
element('language').onchange();
assert.equal(documentState.lang, 'en');
assert.match(element('status').textContent, /Choose a track/);
assert.equal(socket.messages.at(-2).payload.language, 'en');
assert.equal(socket.messages.at(-2).payload.preservedGlobal, true);
verifyRouting(socket.messages.at(-2));
console.log('PASS: registration, message routing, local/global settings, status display, disconnected clicks');