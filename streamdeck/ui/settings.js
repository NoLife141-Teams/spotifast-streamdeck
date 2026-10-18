let socket, uuid, actionId, settings = {}, globalSettings = {}, hostLanguage = 'en';
let globalsReady = false, socketFailed = false, globalPending = {}, localPending = {}, requestSequence = 0, activeRequestId;
let translate = SpotifastI18n.createTranslator('en');
let status = { key: 'checking' }, diagnosticRequestId, diagnosticReport, previewRequestId, previewStatusKey = 'previewWaiting';
let devices = [], devicesReady = false, devicesPending = false, devicesRequestId, devicesMessage = 'deviceChoose';
const element = id => document.getElementById(id);
const checkboxes = ['showText', 'scrollText', 'showRemaining', 'showElapsed', 'showProgress'];
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
function requestPreview() {
  if (actionId?.split('.').pop() !== 'nowplaying' || !connected()) return;
  previewRequestId = uuid + ':preview:' + (++requestSequence);
  send('sendToPlugin', { type: 'preview', requestId: previewRequestId, settings: Object.fromEntries(
    ['showText', 'scrollText', 'showRemaining', 'showElapsed', 'showProgress', 'captionLayout'].map(key => [key, settings[key]])
  ) });
}
function controls() {
  const globalDisabled = !connected() || !globalsReady || Object.keys(globalPending).length > 0;
  for (const id of ['language', 'exe', 'check', 'open', 'diagnose', 'refreshDevices']) element(id).disabled = globalDisabled;
  element('deviceId').disabled = globalDisabled || devicesPending || !devicesReady || !devices.length;
  element('refreshDevices').disabled = globalDisabled || devicesPending;
  for (const id of ['uri', 'displayName', 'step', 'volumePercent', 'seekSeconds', 'captionLayout', ...checkboxes]) element(id).disabled = !connected() || (['scrollText', 'captionLayout'].includes(id) && settings.showText === false);
}
function renderDiagnostic() {
  element('diagnosticPreview').hidden = !diagnosticReport;
  element('copyDiagnostic').disabled = !diagnosticReport;
  if (!diagnosticReport) return;
  // The runtime emits only allowlisted diagnostic fields, never raw logs.
  const report = { ...diagnosticReport, status: diagnosticReport.status && { ...diagnosticReport.status, message: translate(diagnosticReport.status.messageKey), action: translate(diagnosticReport.status.actionKey) }, recentErrors: diagnosticReport.recentErrors.map(error => ({
    ...error, message: translate(error.messageKey), action: translate(error.actionKey)
  })) };
  element('diagnosticPreview').value = JSON.stringify(report, null, 2);
  element('diagnosticStatus').textContent = translate('diagnosticsReady');
}
function requestDiagnostic() {
  if (!globalsReady || Object.keys(globalPending).length || !connected()) return;
  diagnosticRequestId = uuid + ':diagnostics:' + (++requestSequence);
  element('diagnosticStatus').textContent = translate('checking');
  send('sendToPlugin', { type: 'diagnostics', requestId: diagnosticRequestId });
}
function renderStatus() {
  element('status').textContent = status.key ? translate(status.key, { title: status.trackTitle }) : status.message;
  element('activeDevice').textContent = status.online && status.activeDevice ? translate('activeDeviceLabel', { device: status.activeDevice }) : translate('noDevice');
  element('status').style.borderColor = status.online === true ? '#a3e635' : status.online === false ? '#fbbf24' : '#999';
}
function renderDevices() {
  const select = element('deviceId'), options = [];
  const option = (value, text, disabled = false) => {
    const node = document.createElement('option'); node.value = value; node.textContent = text; node.disabled = disabled; return node;
  };
  options.push(option('', translate('deviceChoose')));
  for (const device of devices) options.push(option(device.id, device.name + ' (' + device.kind + ') · ' + device.id));
  if (settings.deviceId && !devices.some(device => device.id === settings.deviceId)) options.push(option(settings.deviceId, translate('deviceSavedUnavailable'), true));
  select.replaceChildren(...options);
  select.value = settings.deviceId || '';
  element('devicesFeedback').textContent = translate(devicesMessage);
}
function requestDevices() {
  if (!globalsReady || Object.keys(globalPending).length || !connected() || devicesPending) return;
  devicesRequestId = uuid + ':devices:' + (++requestSequence);
  devicesPending = true; devicesMessage = 'devicesLoading';
  renderDevices(); controls();
  send('sendToPlugin', { type: 'devices', requestId: devicesRequestId });
}
function clearDevices() {
  devices = []; devicesReady = false; devicesPending = false; devicesRequestId = undefined; devicesMessage = 'deviceChoose';
  renderDevices();
}
function renderUriValidation() {
  const input = element('uri'), value = input.value.trim();
  const type = SpotifastSpotify.spotifyType(value), valid = Boolean(type), invalid = Boolean(value) && !valid;
  input.setAttribute('aria-invalid', String(invalid));
  input.style.borderColor = invalid ? '#fbbf24' : '';
  element('uriFeedback').textContent = translate(invalid ? 'invalidUri' : valid ? 'validUri' : 'playlistHint', { type: translate('linkType_' + type) });
  element('uriFeedback').style.color = invalid ? '#fbbf24' : '#bbb';
}
function renderLanguage() {
  const language = SpotifastI18n.resolveLanguage(globalSettings.language, hostLanguage);
  translate = SpotifastI18n.createTranslator(language);
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = translate(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = translate(node.dataset.i18nPlaceholder); });
  element('language').value = ['en', 'fr'].includes(globalSettings.language) ? globalSettings.language : 'auto';
  const id = actionId?.split('.').pop();
  element('help').textContent = translate(id === 'volume' ? 'dialHelp' : id === 'nowplaying' ? 'artworkHelp' : id === 'like' ? 'favoriteHelp' : 'help');
  renderStatus();
  renderDevices();
  renderUriValidation();
  renderDiagnostic();
  element('previewStatus').textContent = translate(previewStatusKey);
}
function normalizeStep(value) {
  const number = String(value).trim() === '' ? 5 : Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(25, Math.round(number))) : 5;
}
function normalizeAbsoluteVolume(value) {
  const number = value === undefined || String(value).trim() === '' ? 50 : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 50;
}
function normalizeSeekSeconds(value) {
  const number = value === undefined || String(value).trim() === '' ? 10 : Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(3600, Math.round(number))) : 10;
}
function normalizeCaptionLayout(value) { return value === 'twoLines' ? 'twoLines' : 'compact'; }
function renderLocalSettings() {
  for (const [id, value] of Object.entries({ uri: settings.uri ?? '', displayName: SpotifastSpotify.shortcutName(settings.displayName), seekSeconds: normalizeSeekSeconds(settings.seekSeconds), volumePercent: normalizeAbsoluteVolume(settings.volumePercent), step: normalizeStep(settings.step ?? 5), captionLayout: normalizeCaptionLayout(settings.captionLayout), ...Object.fromEntries(checkboxes.map(id => [id, ['showElapsed', 'showProgress'].includes(id) ? settings[id] === true : settings[id] !== false])) })) {
    const input = element(id);
    if (document.activeElement === input) continue;
    if (checkboxes.includes(id)) input.checked = value;
    else input.value = value;
  }
  renderUriValidation();
  renderDevices();
}
function mergeReceived(incoming, pending) {
  for (const key of Object.keys(pending)) if (incoming[key] === pending[key]) delete pending[key];
  return { ...incoming, ...pending };
}
function disconnected() {
  socketFailed = true;
  previewStatusKey = 'connectionLost';
  element('previewStatus').textContent = translate(previewStatusKey);
  element('artworkPreview').src = '../imgs/music.png';
  globalsReady = false;
  clearDevices();
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
  element('absoluteVolume').hidden = id !== 'setvolume';
  element('seek').hidden = !['seekback', 'seekforward'].includes(id);
  element('devices').hidden = id !== 'device';
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
      const previousPath = globalSettings.exePath;
      globalSettings = mergeReceived(message.payload.settings ?? {}, globalPending);
      if (previousPath !== globalSettings.exePath) clearDevices();
      globalsReady = true;
      if (document.activeElement !== element('exe')) element('exe').value = globalSettings.exePath ?? '';
      renderLanguage();
      controls();
      if (!wasReady || (wasSaving && !Object.keys(globalPending).length)) { plugin('status'); requestPreview(); }
    }
    if (message.event === 'didReceiveSettings') {
      settings = mergeReceived(message.payload.settings ?? {}, localPending);
      renderLocalSettings();
      controls();
      requestPreview();
    }
    if (message.event === 'sendToPropertyInspector' && message.payload?.type === 'preview') {
      if (message.payload.requestId !== previewRequestId) return;
      const image = message.payload.image;
      element('artworkPreview').src = typeof image === 'string' && /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(image) ? image : '../imgs/music.png';
      previewStatusKey = message.payload.messageKey;
      element('previewStatus').textContent = translate(previewStatusKey);
    }
    if (message.event === 'sendToPropertyInspector' && message.payload?.type === 'diagnostics') {
      if (message.payload.requestId !== diagnosticRequestId) return;
      diagnosticReport = message.payload.report;
      renderDiagnostic();
    }
    if (message.event === 'sendToPropertyInspector' && message.payload?.type === 'devices') {
      if (!devicesRequestId || message.payload.requestId !== devicesRequestId) return;
      devicesPending = false; devicesReady = !message.payload.failed;
      devices = devicesReady && Array.isArray(message.payload.devices) ? message.payload.devices : [];
      devicesMessage = message.payload.messageKey || 'devicesEmpty';
      renderDevices(); controls();
    }
    if (message.event === 'sendToPropertyInspector' && message.payload?.type === 'status') {
      if (message.payload.requestId !== undefined && message.payload.requestId !== activeRequestId) return;
      status = { key: message.payload.messageKey, trackTitle: message.payload.trackTitle, message: message.payload.message, online: message.payload.online, activeDevice: message.payload.activeDevice };
      renderStatus();
    }
  };
};
element('diagnose').onclick = requestDiagnostic;
element('copyDiagnostic').onclick = async () => {
  if (!diagnosticReport) return;
  const text = element('diagnosticPreview').value;
  try {
    if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await globalThis.navigator.clipboard.writeText(text);
    element('diagnosticStatus').textContent = translate('diagnosticsCopied');
  } catch {
    element('diagnosticPreview').focus();
    element('diagnosticPreview').select();
    element('diagnosticStatus').textContent = translate('diagnosticsCopyManual');
  }
};
element('open').onclick = () => plugin('open');
element('check').onclick = () => plugin('status');
element('refreshDevices').onclick = requestDevices;
element('deviceId').onchange = () => {
  if (!connected() || devicesPending || !devicesReady || !devices.some(device => device.id === element('deviceId').value)) { renderDevices(); return; }
  save('deviceId');
};
function saveGlobal(key, value) {
  if (!globalsReady || !connected() || Object.keys(globalPending).length) return;
  if (key === 'exePath') clearDevices();
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
  const value = checkboxes.includes(id) ? element(id).checked : id === 'displayName' ? SpotifastSpotify.shortcutName(element(id).value) : id === 'seekSeconds' ? normalizeSeekSeconds(element(id).value) : id === 'volumePercent' ? normalizeAbsoluteVolume(element(id).value) : id === 'step' ? normalizeStep(element(id).value) : id === 'captionLayout' ? normalizeCaptionLayout(element(id).value) : element(id).value.trim();
  if (!checkboxes.includes(id)) element(id).value = value;
  if (id === 'uri') renderUriValidation();
  localPending[id] = value;
  settings = { ...settings, [id]: value };
  controls();
  send('setSettings', settings);
  send('getSettings');
  requestPreview();
}
for (const id of ['uri', 'displayName', 'step', 'volumePercent', 'seekSeconds', 'captionLayout', ...checkboxes]) element(id).onchange = () => save(id);
element('uri').oninput = renderUriValidation;
renderLanguage();
controls();
