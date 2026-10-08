let socket, uuid, actionId, settings = {}, globalSettings = {}, hostLanguage = 'en';
let globalsReady = false, socketFailed = false, globalPending = {}, localPending = {}, requestSequence = 0, activeRequestId;
let translate = SpotifastI18n.createTranslator('en');
let status = { key: 'checking' };
const element = id => document.getElementById(id);
const connected = () => !socketFailed && socket?.readyState === WebSocket.OPEN;
function send(event, payload) {
  if (!connected()) return false;
  socket.send(JSON.stringify({ event, action: actionId, context: uuid, payload }));
  return true;
}
function plugin(type) {
  if (!globalsReady || Object.keys(globalPending).length || !connected()) return;
  activeRequestId = uuid + ':' + (++requestSequence);
  status = { key: 'checking' };
  renderStatus();
  send('sendToPlugin', { type, requestId: activeRequestId });
}
function controls() {
  const globalDisabled = !connected() || !globalsReady || Object.keys(globalPending).length > 0;
  for (const id of ['language', 'exe', 'check', 'open']) element(id).disabled = globalDisabled;
  for (const id of ['uri', 'step', 'showText']) element(id).disabled = !connected();
}
function renderStatus() {
  element('status').textContent = status.key ? translate(status.key, { title: status.trackTitle }) : status.message;
  element('status').style.borderColor = status.online === true ? '#a3e635' : status.online === false ? '#fbbf24' : '#999';
}
function renderLanguage() {
  const language = SpotifastI18n.resolveLanguage(globalSettings.language, hostLanguage);
  translate = SpotifastI18n.createTranslator(language);
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = translate(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = translate(node.dataset.i18nPlaceholder); });
  element('language').value = ['en', 'fr'].includes(globalSettings.language) ? globalSettings.language : 'auto';
  const id = actionId?.split('.').pop();
  element('help').textContent = translate(id === 'volume' ? 'dialHelp' : id === 'nowplaying' ? 'artworkHelp' : 'help');
  renderStatus();
}
function normalizeStep(value) {
  const number = String(value).trim() === '' ? 5 : Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(25, Math.round(number))) : 5;
}
function renderLocalSettings() {
  for (const [id, value] of Object.entries({ uri: settings.uri ?? '', step: normalizeStep(settings.step ?? 5), showText: settings.showText !== false })) {
    const input = element(id);
    if (document.activeElement === input) continue;
    if (id === 'showText') input.checked = value;
    else input.value = value;
  }
}
function mergeReceived(incoming, pending) {
  for (const key of Object.keys(pending)) if (incoming[key] === pending[key]) delete pending[key];
  return { ...incoming, ...pending };
}
function disconnected() {
  socketFailed = true;
  globalsReady = false;
  status = { key: 'connectionLost', online: false };
  renderStatus();
  controls();
}
window.connectElgatoStreamDeckSocket = (port, propertyInspectorUUID, registerEvent, info, actionInfo) => {
  uuid = propertyInspectorUUID;
  hostLanguage = JSON.parse(info).application?.language || 'en';
  const action = JSON.parse(actionInfo);
  actionId = action.action;
  settings = action.payload.settings ?? {};
  const id = actionId.split('.').pop();
  element('playlist').hidden = id !== 'playlist';
  element('volume').hidden = !['volumeup', 'volumedown', 'volume'].includes(id);
  element('text').hidden = id !== 'nowplaying';
  renderLocalSettings();
  renderLanguage();
  socket = new WebSocket('ws://127.0.0.1:' + port);
  controls();
  socket.onopen = () => {
    socket.send(JSON.stringify({ event: registerEvent, uuid }));
    send('getGlobalSettings');
    controls();
  };
  socket.onclose = disconnected;
  socket.onerror = disconnected;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.event === 'didReceiveGlobalSettings') {
      const wasReady = globalsReady, wasSaving = Object.keys(globalPending).length > 0;
      globalSettings = mergeReceived(message.payload.settings ?? {}, globalPending);
      globalsReady = true;
      if (document.activeElement !== element('exe')) element('exe').value = globalSettings.exePath ?? '';
      renderLanguage();
      controls();
      if (!wasReady || (wasSaving && !Object.keys(globalPending).length)) plugin('status');
    }
    if (message.event === 'didReceiveSettings') {
      settings = mergeReceived(message.payload.settings ?? {}, localPending);
      renderLocalSettings();
    }
    if (message.event === 'sendToPropertyInspector' && message.payload?.type === 'status') {
      if (message.payload.requestId !== undefined && message.payload.requestId !== activeRequestId) return;
      status = { key: message.payload.messageKey, trackTitle: message.payload.trackTitle, message: message.payload.message, online: message.payload.online };
      renderStatus();
    }
  };
};
element('open').onclick = () => plugin('open');
element('check').onclick = () => plugin('status');
function saveGlobal(key, value) {
  if (!globalsReady || !connected() || Object.keys(globalPending).length) return;
  globalPending = { [key]: value };
  globalSettings = { ...globalSettings, ...globalPending };
  renderLanguage();
  controls();
  send('setGlobalSettings', globalSettings);
  // Explicitly fetch the stored value; this also works on hosts that do not echo writes to their sender.
  send('getGlobalSettings');
}
element('exe').onchange = () => saveGlobal('exePath', element('exe').value.trim());
element('language').onchange = () => saveGlobal('language', element('language').value);
function save(id) {
  if (!connected()) return;
  const value = id === 'showText' ? element(id).checked : id === 'step' ? normalizeStep(element(id).value) : element(id).value.trim();
  if (id !== 'showText') element(id).value = value;
  localPending[id] = value;
  settings = { ...settings, [id]: value };
  send('setSettings', settings);
  send('getSettings');
}
for (const id of ['uri', 'step', 'showText']) element(id).onchange = () => save(id);
renderLanguage();
controls();
