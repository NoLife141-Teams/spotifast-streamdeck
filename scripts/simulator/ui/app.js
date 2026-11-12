const $ = id => document.getElementById(id);
let state, selected = 0, clearedAt = 0, lastTrace = '', rotation = [0, 0, 0, 0];
const images = new Map();
const labels = { playpause: 'Lecture / pause', previous: 'Précédent', next: 'Suivant', nowplaying: 'Pochette', shuffle: 'Aléatoire', repeat: 'Répéter', mute: 'Sourdine', like: 'Favori' };
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
async function post(endpoint, payload) {
  try {
    const response = await fetch('/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showError(''); return true;
  } catch (error) { showError(error.message); return false; }
}
function selectDial(index) { selected = index; updateInspector(); document.querySelectorAll('.dial-cell,.screen').forEach(node => node.classList.toggle('selected', Number(node.dataset.index) === index)); }
function updateInspector() {
  if (!state) return;
  const entry = state.dials[selected], media = entry.action === 'multimedia';
  $('dial-number').textContent = String(selected + 1).padStart(2, '0');
  $('dial-name').textContent = media ? 'Multimedia' : 'Volume';
  $('dial-description').textContent = media ? 'Navigation et lecture du morceau.' : 'Volume, sourdine et lecture.';
  $('action').value = entry.action; $('step').value = entry.settings.step;
  $('step-field').hidden = media;
}
function rotate(index, ticks) {
  selectDial(index); rotation[index] += ticks * 18;
  document.querySelector(`.knob[data-index="${index}"]`).style.setProperty('--rotation', rotation[index] + 'deg');
  return post('event', { index, type: 'rotate', ticks });
}
function push(index) { selectDial(index); return post('event', { index, type: 'push' }); }
function source(value) { return typeof value === 'string' && (value.startsWith('imgs/') || value.startsWith('data:image/')) ? value.startsWith('imgs/') ? '/' + value : value : '/imgs/music.png'; }
function getImage(value) {
  const url = source(value);
  if (!images.has(url)) { const image = new Image(); image.onload = drawScreens; image.src = url; images.set(url, image); }
  return images.get(url);
}
function ellipsis(context, text, width) { if (context.measureText(text).width <= width) return text; let result = text; while (result && context.measureText(result + '…').width > width) result = result.slice(0, -1); return result + '…'; }
function item(context, spec, feedback) {
  const [x, y, width, height] = spec.rect;
  const raw = feedback[spec.key] ?? spec.value;
  const definition = raw && typeof raw === 'object' ? { ...spec, ...raw } : spec;
  const value = raw && typeof raw === 'object' ? raw.value : raw;
  context.save(); context.beginPath(); context.rect(x, y, width, height); context.clip();
  if (definition.type === 'pixmap' && value) { const image = getImage(value); if (image.complete && image.naturalWidth) context.drawImage(image, x, y, width, height); }
  else if (definition.type === 'text') {
    context.fillStyle = definition.color || '#e8efdf'; context.font = `${definition.font?.weight || 400} ${definition.font?.size || 12}px "Segoe UI", sans-serif`;
    context.textBaseline = 'middle'; context.textAlign = definition.alignment || 'left';
    const text = ellipsis(context, String(value ?? ''), width);
    context.fillText(text, x + (context.textAlign === 'right' ? width : context.textAlign === 'center' ? width / 2 : 0), y + height / 2);
  } else if (definition.type === 'bar') {
    const { min = 0, max = 100 } = definition.range || {};
    context.fillStyle = definition.bar_bg_c || '#3b3b3b'; context.fillRect(x, y, width, height);
    context.fillStyle = definition.bar_fill_c || '#c3f29c'; context.fillRect(x, y, width * Math.max(0, Math.min(1, (Number(value || 0) - min) / (max - min || 1))), height);
  }
  context.restore();
}
const volumeLayout = [
  { key: 'title', type: 'text', rect: [12, 10, 177, 20], font: { size: 12 } },
  { key: 'icon', type: 'pixmap', rect: [13, 39, 38, 38] },
  { key: 'value', type: 'text', rect: [63, 37, 124, 34], font: { size: 26, weight: 500 }, alignment: 'right' },
  { key: 'indicator', type: 'bar', rect: [12, 87, 176, 4], bar_fill_c: '#c3f29c', range: { min: 0, max: 100 } }
];
function drawScreens() {
  if (!state) return;
  state.dials.forEach((entry, index) => {
    const canvas = document.querySelector(`canvas[data-index="${index}"]`), context = canvas.getContext('2d');
    context.setTransform(2, 0, 0, 2, 0, 0); context.fillStyle = '#0b100d'; context.fillRect(0, 0, 200, 100);
    const layout = entry.action === 'multimedia' ? state.layout.items : volumeLayout;
    for (const spec of [...layout].sort((a, b) => (a.zOrder || 0) - (b.zOrder || 0))) item(context, spec, entry.feedback);
    if (index === selected) { context.fillStyle = '#c3f29c'; context.fillRect(0, 98, 200, 2); }
  });
}
for (let index = 0; index < 8; index++) {
  const button = document.createElement('button'); button.className = 'key'; button.dataset.index = index;
  const image = document.createElement('img'); image.alt = ''; image.draggable = false;
  const title = document.createElement('small'); button.append(image, title);
  button.onclick = () => post('key', { index }); $('keys').append(button);
}
for (let index = 0; index < 4; index++) {
  const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200; canvas.className = 'screen'; canvas.dataset.index = index; canvas.tabIndex = 0;
  canvas.setAttribute('role', 'button'); canvas.setAttribute('aria-label', `Écran tactile ${index + 1}`);
  canvas.onclick = event => {
    selectDial(index); const rect = canvas.getBoundingClientRect();
    post('event', { index, type: 'touch', tapPos: [Math.max(0, Math.min(199.99, (event.clientX - rect.left) / rect.width * 200)), Math.max(0, Math.min(99.99, (event.clientY - rect.top) / rect.height * 100))] });
  };
  canvas.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); selectDial(index); post('event', { index, type: 'touch', tapPos: [100, 50] }); } };
  $('screens').append(canvas);
  const cell = document.createElement('div'); cell.className = 'dial-cell'; cell.dataset.index = index;
  const knob = document.createElement('button'); knob.className = 'knob'; knob.dataset.index = index; knob.setAttribute('aria-label', `Molette ${index + 1} : appuyer`);
  const face = document.createElement('span'); face.className = 'knob-face'; const marker = document.createElement('span'); marker.className = 'knob-marker'; face.append(marker); knob.append(face);
  const label = document.createElement('button'); label.className = 'dial-label'; label.onclick = () => { selectDial(index); drawScreens(); };
  let drag;
  knob.onpointerdown = event => { if (event.button !== 0) return; selectDial(index); drawScreens(); knob.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY, moved: false, remainder: 0 }; };
  knob.onpointermove = event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = drag.y - event.clientY;
    drag.x = event.clientX; drag.y = event.clientY; drag.remainder += dx + dy;
    const ticks = Math.trunc(drag.remainder / 14);
    if (ticks) { drag.moved = true; drag.remainder -= ticks * 14; rotate(index, Math.max(-32, Math.min(32, ticks))); }
  };
  knob.onpointerup = () => { if (drag && !drag.moved) push(index); drag = undefined; };
  knob.onpointercancel = () => { drag = undefined; };
  knob.onclick = event => { if (event.detail === 0) push(index); };
  knob.addEventListener('wheel', event => { event.preventDefault(); if (event.deltaY) rotate(index, -Math.sign(event.deltaY) * Math.min(8, Math.max(1, Math.round(Math.abs(event.deltaY) / 100)))); }, { passive: false });
  cell.append(knob, label); $('dials').append(cell);
}
function render(next) {
  state = next;
  $('connection').textContent = state.ready ? 'SDK Elgato connecté' : 'SDK déconnecté';
  $('sdk-led').style.background = state.ready ? 'var(--mint)' : '#c28268';
  if (state.error) showError(state.error);
  document.querySelectorAll('button').forEach(button => { button.disabled = !state.ready; });
  document.querySelectorAll('.dial-label').forEach((label, index) => {
    label.replaceChildren(); const number = document.createElement('span'); number.textContent = '0' + (index + 1);
    label.append(number, state.dials[index].action === 'multimedia' ? 'MULTIMEDIA' : 'VOLUME');
  });
  state.keys.forEach((entry, index) => {
    const button = document.querySelector(`.key[data-index="${index}"]`);
    button.setAttribute('aria-label', labels[entry.action]); button.title = labels[entry.action];
    const image = button.querySelector('img'), src = source(entry.image || `imgs/${entry.icon}${entry.state ? '-active' : ''}.png`);
    if (image.getAttribute('src') !== src) image.src = src;
    button.querySelector('small').textContent = entry.title || '';
    if (Number(button.dataset.alerts || 0) !== entry.alerts) { button.classList.add('alert'); setTimeout(() => button.classList.remove('alert'), 900); }
    button.dataset.alerts = entry.alerts;
  });
  const player = state.player;
  if (player.scenario) $('scenario').value = player.scenario;
  $('player-title').textContent = !player.online ? 'Spotifast hors ligne' : player.title || 'Aucun morceau';
  $('player-artist').textContent = !player.online ? 'Reviens à « Lecture normale » pour reconnecter.' : player.artists || 'Choisis un autre scénario.';
  $('play-state').classList.toggle('playing', player.online && player.state === 'playing');
  $('volume-value').textContent = (player.volume ?? 0) + ' %'; $('volume-meter').style.width = (player.volume ?? 0) + '%';
  $('shuffle-state').textContent = 'Aléatoire · ' + (player.shuffle ? 'oui' : 'non');
  $('repeat-state').textContent = 'Répéter · ' + ({ off: 'non', context: 'liste', track: 'titre' }[player.repeat] || 'non');
  const trace = state.trace.filter(item => item.id > clearedAt), signature = trace.map(item => item.id).join(',');
  if (signature !== lastTrace) {
    lastTrace = signature; $('journal').replaceChildren();
    for (const row of trace) {
      const node = document.createElement('div'); node.className = 'journal-row' + (row.event === 'Commande' ? ' command' : '');
      const time = document.createElement('time'); time.textContent = new Date(row.at).toLocaleTimeString('fr-CA', { hour12: false });
      const event = document.createElement('span'); event.className = 'event'; event.textContent = row.event;
      const detail = document.createElement('span'); detail.className = 'detail'; detail.textContent = row.detail;
      node.append(time, event, detail); $('journal').append(node);
    }
    if (!trace.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'À toi de jouer. Les événements et commandes apparaîtront ici.'; $('journal').append(empty); }
  }
  $('event-count').textContent = trace.length + ' événement' + (trace.length !== 1 ? 's' : '');
  updateInspector(); selectDial(selected); drawScreens();
}
$('rotate-left').onclick = () => rotate(selected, -Number($('ticks').value));
$('rotate-right').onclick = () => rotate(selected, Number($('ticks').value));
$('push').onclick = () => push(selected);
$('ticks').oninput = () => { $('ticks-value').textContent = $('ticks').value; };
async function configure() { await post('config', { index: selected, action: $('action').value, step: Number($('step').value) }); }
$('action').onchange = configure; $('step').onchange = configure;
$('scenario').onchange = () => post('scenario', { scenario: $('scenario').value });
$('reset').onclick = async () => {
  if (await post('scenario', { scenario: 'reset' })) {
    $('scenario').value = 'normal'; $('ticks').value = '1'; $('ticks-value').textContent = '1'; rotation = [0, 0, 0, 0];
    document.querySelectorAll('.knob').forEach(knob => knob.style.setProperty('--rotation', '0deg'));
    selectDial(0); drawScreens();
  }
};
$('clear-log').onclick = () => { clearedAt = state?.trace[0]?.id || 0; lastTrace = 'clear'; if (state) render(state); };
document.addEventListener('keydown', event => {
  if (event.target.closest('input,select,textarea') || !state?.ready || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^[1-4]$/.test(event.key)) { selectDial(Number(event.key) - 1); drawScreens(); }
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); rotate(selected, (event.key === 'ArrowLeft' ? -1 : 1) * Number($('ticks').value)); }
  else if (event.code === 'Space' && !event.target.closest('button,canvas')) { event.preventDefault(); push(selected); }
});
const events = new EventSource('/api/events');
events.onmessage = event => { showError(''); render(JSON.parse(event.data)); };
events.onerror = () => { $('connection').textContent = 'Serveur déconnecté'; showError('Connexion interrompue. Le simulateur tente de se reconnecter…'); };
