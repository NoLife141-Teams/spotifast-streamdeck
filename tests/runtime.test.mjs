import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import translations from '../streamdeck/ui/i18n.js';
import { UUID, actions, shortText, commandFor } from '../src/core.mjs';

class TestRenderer { async render(image, title, artists) { return 'caption:' + title.replace(/\s+/g, ' ') + '|' + artists; } }
async function runtime() {
  const callbacks = {};
  const messages = [];
  const warnings = [];
  class Client {
    configure(p = '') { this.customPath = p; }
    async snapshot() {
      if (this.offline) throw new Error('not running');
      return { state: 'paused', title: '', artists: '', volume: 50, repeat: 'off', saved: 'no', artUrl: '' };
    }
    async run() { if (this.offline) throw new Error('not running'); }
    async open() {}
  }
  const sdk = {
    info: { application: { language: 'en' } }, connect: async () => {},
    settings: { getGlobalSettings: async () => ({ language: 'fr' }), onDidReceiveSettings: cb => { callbacks.settings = cb; }, onDidReceiveGlobalSettings: cb => { callbacks.global = cb; } },
    ui: { onSendToPlugin: cb => { callbacks.ui = cb; }, sendToPropertyInspector: async value => { messages.push(value); } },
    system: { onSystemDidWakeUp: cb => { callbacks.wake = cb; } },
    logger: { info() {}, warn(value) { warnings.push(value); }, error(e) { throw e; } },
    actions: {}
  };
  for (const name of ['onWillAppear','onWillDisappear','onKeyDown','onDialRotate','onDialDown','onTouchTap']) sdk.actions[name] = cb => { callbacks[name] = cb; };
  const context = vm.createContext({ streamDeck: sdk, UUID, actions, Spotifast: Client, ArtworkCache: class { async get() {} }, shortText, commandFor, translations, ArtworkRenderer: TestRenderer, setInterval() {}, setTimeout() {} });
  let source = (await readFile(new URL('../src/plugin.mjs', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  source = source.replace('main().catch(report);', 'globalThis.ready = main();');
  source += '\nglobalThis.api = {configure, render, refresh, performInvalid, client, visible};';
  vm.runInContext(source, context);
  await context.ready;
  return { api: context.api, callbacks, messages, warnings };
}
test('runtime labels follow French/English and survive a language switch', async () => {
  const { api } = await runtime();
  const titles = [];
  const images = [];
  const action = { id: 'test', manifestId: UUID + '.nowplaying', isKey: () => true, setImage: async value => { images.push(value); }, setTitle: async value => { titles.push(value); } };
  api.visible.set('test', { action, settings: {} });
  await api.refresh();
  assert.equal(images.at(-1), 'caption:Aucun morceau|');
  assert.equal(titles.at(-1), '');
  api.configure({ language: 'en' });
  await api.refresh();
  assert.equal(images.at(-1), 'caption:No track|');
  assert.equal(titles.at(-1), '');
  api.client.offline = true;
  await api.refresh();
  assert.equal(titles.at(-1), 'Open\nSpotifast');
  api.configure({ language: 'fr' });
  await api.refresh();
  assert.equal(titles.at(-1), 'Ouvrir\nSpotifast');
});
test('runtime errors are translated and carry a stable key for the UI', async () => {
  const { api, messages } = await runtime();
  let alerts = 0;
  const event = { action: { showAlert: async () => { alerts++; } } };
  await api.performInvalid(event, { messageKey: 'invalidUri' });
  assert.equal(alerts, 1);
  assert.equal(messages.at(-1).messageKey, 'invalidUri');
  assert.match(messages.at(-1).message, /Ajoute un lien/);
  api.configure({ language: 'en' });
  await api.performInvalid(event, { messageKey: 'invalidUri' });
  assert.match(messages.at(-1).message, /Add a valid Spotify/);
});

test('artwork caption clears the native title and can be hidden without losing the cover', async () => {
  const { api } = await runtime();
  api.client.snapshot = async () => ({ state: 'playing', title: 'Perfect', artists: 'Kaley, LYON', volume: 50, artUrl: '', repeat: 'off' });
  const images = [];
  const titles = [];
  const action = { id: 'cover', manifestId: UUID + '.nowplaying', isKey: () => true, setImage: async value => { images.push(value); }, setTitle: async value => { titles.push(value); } };
  const entry = { action, settings: {}, artImage: 'data:image/png;base64,cover', artUrl: '' };
  api.visible.set(action.id, entry);
  await api.refresh();
  assert.equal(images.at(-1), 'caption:Perfect|Kaley, LYON');
  assert.equal(titles.at(-1), '');
  entry.settings.showText = false;
  await api.refresh();
  assert.equal(images.at(-1), 'data:image/png;base64,cover');
  assert.equal(titles.at(-1), '');
});
