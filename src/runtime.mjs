import { ArtworkRenderer } from './artwork.mjs';
import { UUID, actions, Spotifast, ArtworkCache, shortText, commandFor } from './core.mjs';
import translations from '../streamdeck/ui/i18n.js';

export function createRuntime(streamDeck, {
  client = new Spotifast(), artwork = new ArtworkCache(), artworkRenderer = new ArtworkRenderer(),
  timers = { setTimeout, clearTimeout, setInterval, clearInterval }
} = {}) {
  let t = translations.createTranslator(translations.resolveLanguage('auto', streamDeck.info.application.language));
  const visible = new Map(), artworkRequests = new Map();
  let state, online = false, refreshing, refreshAgain = false, configured = false, configuration = 0;
  let lastError = '', uiSession = 0, uiRevision = 0, refreshTimer, interval;
  let resolveConfigured;
  const ready = new Promise(resolve => { resolveConfigured = resolve; });
  const suffix = action => action.manifestId.slice(UUID.length + 1);
  const report = error => streamDeck.logger.error(error);
  const userError = error => error.messageKey || (error.killed ? 'commandTimeout' : 'commandFailed');
  const statusPayload = (connected, messageKey, title) => ({
    type: 'status', online: connected, messageKey, trackTitle: title, message: t(messageKey, { title })
  });
  const invalidate = entry => { entry.signature = undefined; entry.renderRevision = (entry.renderRevision || 0) + 1; };
  function configure(settings = {}) {
    client.configure(settings.exePath ?? '');
    t = translations.createTranslator(translations.resolveLanguage(settings.language, streamDeck.info.application.language));
    configuration++;
    configured = true;
    resolveConfigured();
    for (const entry of visible.values()) invalidate(entry);
  }
  function inspectorToken(action, requestId) {
    if (streamDeck.ui.action?.id !== action.id) return;
    return { actionId: action.id, session: uiSession, revision: ++uiRevision, requestId };
  }
  function currentInspector(token) {
    return token && token.session === uiSession && token.revision === uiRevision && streamDeck.ui.action?.id === token.actionId;
  }
  async function sendStatus(token, payload) {
    if (currentInspector(token)) await streamDeck.ui.sendToPropertyInspector({ ...payload, ...(token.requestId === undefined ? {} : { requestId: token.requestId }) });
  }
  async function render(entry, image, imageUrl) {
    const snapshot = state, connected = online, config = configuration;
    const revision = entry.renderRevision = (entry.renderRevision || 0) + 1;
    const current = () => visible.get(entry.action.id) === entry && revision === entry.renderRevision && snapshot === state && connected === online && config === configuration;
    const { action, settings } = entry;
    const artUrl = connected ? snapshot.artUrl : '';
    if (entry.artUrl !== artUrl) { entry.artUrl = artUrl; entry.artImage = undefined; }
    if (image && imageUrl === artUrl) entry.artImage = image;
    const id = suffix(action);
    let title = '', picture, feedback, buttonState;
    if (!connected) {
      title = t('openButton');
      if (id === 'nowplaying') picture = 'imgs/music.png';
      feedback = { title: 'Spotifast', value: t('offline'), indicator: 0, icon: 'imgs/music.png' };
      if (['playpause', 'shuffle', 'repeat', 'like'].includes(id)) buttonState = 0;
    } else {
      if (id === 'playpause') buttonState = snapshot.state === 'playing' ? 1 : 0;
      if (id === 'shuffle') buttonState = snapshot.shuffle ? 1 : 0;
      if (id === 'repeat') { buttonState = snapshot.repeat === 'off' ? 0 : 1; title = snapshot.repeat === 'track' ? '1' : ''; }
      if (id === 'like') buttonState = snapshot.saved === 'yes' ? 1 : 0;
      if (id === 'nowplaying') {
        picture = entry.artImage ?? 'imgs/music.png';
        if (settings.showText !== false) picture = await artworkRenderer.render(entry.artImage, snapshot.title || t('noTrack'), snapshot.title ? snapshot.artists : '');
      }
      if (['volumeup', 'volumedown', 'mute'].includes(id)) title = snapshot.volume === null ? '' : snapshot.volume + '%';
      if (id === 'volume') feedback = { title: shortText(snapshot.title || t('volumeTitle'), 24), value: snapshot.volume === null ? '—' : snapshot.volume + '%', indicator: snapshot.volume ?? 0, icon: entry.artImage ?? 'imgs/volumeup.png' };
    }
    const signature = JSON.stringify({ title, picture, feedback, buttonState });
    if (!current() || entry.signature === signature) return;
    if (action.isKey()) {
      if (buttonState !== undefined) await action.setState(buttonState);
      if (!current()) return;
      if (picture !== undefined) await action.setImage(picture);
      if (!current()) return;
      await action.setTitle(title);
    } else if (feedback) await action.setFeedback(feedback);
    if (current()) entry.signature = signature;
  }
  async function renderEntries(entries, image, url) {
    const results = await Promise.allSettled(entries.map(entry => render(entry, image, url)));
    for (const result of results) if (result.status === 'rejected') report(result.reason);
  }
  function requestArtwork() {
    const url = online && state?.artUrl;
    if (!url || artworkRequests.has(url) || artworkRequests.size >= 4 || ![...visible.values()].some(entry => ['nowplaying', 'volume'].includes(suffix(entry.action)))) return;
    const task = Promise.resolve().then(() => artwork.get(url)).then(async image => {
      if (!image || !online || state?.artUrl !== url) return;
      await renderEntries([...visible.values()].filter(entry => ['nowplaying', 'volume'].includes(suffix(entry.action))), image, url);
    }).catch(report).finally(() => artworkRequests.delete(url));
    artworkRequests.set(url, task);
  }
  function refresh() {
    if (!configured || !visible.size) return Promise.resolve();
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = (async () => {
      do {
        refreshAgain = false;
        const config = configuration;
        try {
          const next = await client.snapshot();
          if (config !== configuration) { refreshAgain = true; continue; }
          state = next; online = true; lastError = '';
        } catch (error) {
          if (config !== configuration) { refreshAgain = true; continue; }
          online = false;
          const message = error.message ?? t('unavailable');
          if (message !== lastError) streamDeck.logger.warn(t('unavailable'));
          lastError = message;
        }
        await renderEntries([...visible.values()]);
        requestArtwork();
      } while (refreshAgain && visible.size);
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }
  function scheduleRefresh() {
    timers.clearTimeout(refreshTimer);
    refreshTimer = timers.setTimeout(() => { refreshTimer = undefined; refresh().catch(report); }, 250);
  }
  async function failed(event, error, token) {
    const entry = visible.get(event.action.id);
    if (entry) invalidate(entry);
    streamDeck.logger.warn('Action ' + suffix(event.action) + ': ' + error.message);
    await event.action.showAlert();
    await sendStatus(token, statusPayload(false, userError(error)));
    await refresh();
  }
  async function perform(event, args) {
    const token = inspectorToken(event.action);
    try {
      await ready;
      if (suffix(event.action) === 'open') await client.open();
      else await client.run(args);
      const entry = visible.get(event.action.id);
      if (entry) invalidate(entry);
      scheduleRefresh();
    } catch (error) { await failed(event, error, token); }
  }
  async function performInvalid(event, error) { await failed(event, error, inspectorToken(event.action)); }
  async function inspectorRequest(event) {
    if (!['open', 'status'].includes(event.payload?.type)) return;
    const token = inspectorToken(event.action, event.payload.requestId);
    if (!token) return;
    try {
      await ready;
      if (event.payload.type === 'open') await client.open();
      let config, snapshot;
      do { config = configuration; snapshot = await client.snapshot(); } while (config !== configuration && currentInspector(token));
      await sendStatus(token, statusPayload(true, snapshot.title ? 'nowPlaying' : 'connected', snapshot.title));
      if (event.payload.type === 'open') await refresh();
    } catch (error) { await sendStatus(token, statusPayload(false, userError(error))); }
  }
  streamDeck.ui.onDidAppear(() => { uiSession++; uiRevision++; });
  streamDeck.ui.onDidDisappear(() => { uiSession++; uiRevision++; });
  streamDeck.actions.onWillAppear(event => {
    visible.set(event.action.id, { action: event.action, settings: event.payload.settings ?? {} });
    refresh().catch(report);
  });
  streamDeck.actions.onWillDisappear(event => {
    const entry = visible.get(event.action.id); if (entry) invalidate(entry);
    visible.delete(event.action.id);
  });
  streamDeck.settings.onDidReceiveSettings(event => {
    const entry = visible.get(event.action.id);
    if (entry) { entry.settings = event.payload.settings ?? {}; invalidate(entry); refresh().catch(report); }
  });
  streamDeck.settings.onDidReceiveGlobalSettings(event => { configure(event.settings); refresh().catch(report); });
  streamDeck.actions.onKeyDown(event => {
    try {
      const args = commandFor(suffix(event.action), event.payload.settings, undefined, event.payload.isInMultiAction ? event.payload.userDesiredState : undefined);
      perform(event, args).catch(report);
    } catch (error) { performInvalid(event, error).catch(report); }
  });
  streamDeck.actions.onDialRotate(event => {
    if (event.payload.ticks === 0) return;
    try { perform(event, commandFor('volume', event.payload.settings, event.payload.ticks)).catch(report); }
    catch (error) { performInvalid(event, error).catch(report); }
  });
  streamDeck.actions.onDialDown(event => perform(event, ['mute']).catch(report));
  streamDeck.actions.onTouchTap(event => perform(event, ['play-pause']).catch(report));
  streamDeck.ui.onSendToPlugin(event => { inspectorRequest(event).catch(report); });
  streamDeck.system.onSystemDidWakeUp(() => {
    client.configure(client.customPath);
    configuration++;
    for (const entry of visible.values()) invalidate(entry);
    refresh().catch(report);
  });
  return {
    client, visible, artworkRequests, configure, render, refresh, perform, performInvalid, inspectorRequest,
    async start() {
      await streamDeck.connect();
      configure(await streamDeck.settings.getGlobalSettings());
      streamDeck.logger.info(t('started', { count: actions.length }));
      await refresh();
      interval = timers.setInterval(() => refresh().catch(report), 1500);
    },
    stop() { timers.clearTimeout(refreshTimer); timers.clearInterval(interval); }
  };
}
