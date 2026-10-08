let socket, uuid, actionId, settings = {}, globalSettings = {}, hostLanguage = 'en';
let translate = SpotifastI18n.createTranslator('en');
let status = { key: 'checking' };
const element = id => document.getElementById(id);
function send(event, payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, action: actionId, context: uuid, payload }));
}
function plugin(type) { send('sendToPlugin', { type }); }
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
  element('uri').value = settings.uri ?? '';
  element('step').value = settings.step ?? 5;
  element('showText').checked = settings.showText !== false;
  renderLanguage();
  socket = new WebSocket('ws://127.0.0.1:' + port);
  socket.onopen = () => {
    socket.send(JSON.stringify({ event: registerEvent, uuid }));
    send('getGlobalSettings');
    plugin('status');
  };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.event === 'didReceiveGlobalSettings') {
      globalSettings = message.payload.settings ?? {};
      element('exe').value = globalSettings.exePath ?? '';
      renderLanguage();
    }
    if (message.event === 'sendToPropertyInspector' && message.payload?.type === 'status') {
      status = { key: message.payload.messageKey, trackTitle: message.payload.trackTitle, message: message.payload.message, online: message.payload.online };
      renderStatus();
    }
  };
};
element('open').onclick = () => plugin('open');
element('check').onclick = () => plugin('status');
element('exe').onchange = () => {
  globalSettings = { ...globalSettings, exePath: element('exe').value.trim() };
  send('setGlobalSettings', globalSettings);
  plugin('status');
};
element('language').onchange = () => {
  globalSettings = { ...globalSettings, language: element('language').value };
  renderLanguage();
  send('setGlobalSettings', globalSettings);
  plugin('status');
};
function save() {
  settings = { ...settings, uri: element('uri').value.trim(), step: Math.max(1, Math.min(25, Number(element('step').value) || 5)), showText: element('showText').checked };
  send('setSettings', settings);
}
for (const id of ['uri', 'step', 'showText']) element(id).onchange = save;
renderLanguage();
