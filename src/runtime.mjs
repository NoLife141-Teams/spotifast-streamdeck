import { artworkSettings, playbackDisplay, playbackOverlays } from './playback-display.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { ArtworkRenderer } from './artwork.mjs';
import { LocalizedError, UUID, actions, Spotifast, ArtworkCache, shortText, commandFor, absoluteVolume, seekSeconds, seekTrack } from './core.mjs';
import translations from '../streamdeck/ui/i18n.js';
import spotifyLinks from '../streamdeck/ui/spotify.js';

export function createRuntime(streamDeck, {
  client = new Spotifast(), artwork = new ArtworkCache(), artworkRenderer = new ArtworkRenderer(),
  timers = { setTimeout, clearTimeout, setInterval, clearInterval }, now = () => performance.now()
} = {}) {
  let t = translations.createTranslator(translations.resolveLanguage('auto', streamDeck.info.application.language));
  const visible = new Map(), artworkRequests = new Map();
  let state, online = false, refreshing, refreshAgain = false, configured = false, configuration = 0;
  let lastError = '', uiSession = 0, refreshTimer;
  const uiRevisions = new Map(), diagnostics = createDiagnostics();
  let failures = 0, retryRevision = 0;
  let sampledAt = 0, animationInterval, animationPeriod, animating, started = false;
  let playbackRequest, preview;
  let resolveConfigured;
  const ready = new Promise(resolve => { resolveConfigured = resolve; });
  const suffix = action => action.manifestId.slice(UUID.length + 1);
  const report = error => streamDeck.logger.error(error);
  const userError = error => error.messageKey || (error.killed ? 'commandTimeout' : 'commandFailed');
  const statusPayload = (connected, messageKey, title, activeDevice) => ({
    type: 'status', online: connected, messageKey, trackTitle: title, activeDevice, message: t(messageKey, { title })
  });
  const invalidate = entry => { entry.signature = undefined; entry.renderRevision = (entry.renderRevision || 0) + 1; };
  const trackKey = snapshot => JSON.stringify([snapshot?.title, snapshot?.artists, snapshot?.album, snapshot?.artUrl]);
  function clearPlaybackFeedback(entry) {
    timers.clearTimeout(entry.playbackFeedbackTimer);
    entry.playbackFeedbackTimer = undefined;
    entry.playbackFeedback = undefined;
  }
  function resetPlaybackFeedback() {
    playbackRequest = undefined;
    for (const entry of visible.values()) {
      if (entry.playbackFeedback) invalidate(entry);
      clearPlaybackFeedback(entry);
    }
  }
  function showPlaybackFeedback(entry, playbackState, snapshot) {
    clearPlaybackFeedback(entry);
    const feedback = entry.playbackFeedback = { state: playbackState, track: trackKey(snapshot), until: now() + 1000 };
    invalidate(entry);
    entry.playbackFeedbackTimer = timers.setTimeout(() => {
      if (visible.get(entry.action.id) !== entry || entry.playbackFeedback !== feedback) return;
      clearPlaybackFeedback(entry);
      invalidate(entry);
      updateAnimationTimer();
      render(entry).catch(report);
    }, 1000);
  }
  function confirmPlayback(snapshot) {
    const request = playbackRequest;
    if (!request?.accepted) return;
    if (now() >= request.until || (request.track && request.track !== trackKey(snapshot))) {
      playbackRequest = undefined;
      return;
    }
    if (snapshot.state === request.before || !['playing', 'paused'].includes(snapshot.state) || (request.target && snapshot.state !== request.target)) return;
    playbackRequest = undefined;
    for (const entry of request.entries) {
      if (visible.get(entry.action.id) === entry) showPlaybackFeedback(entry, snapshot.state, snapshot);
    }
  }
  function configure(settings = {}) {
    resetPolling();
    client.configure(settings.exePath ?? '');
    t = translations.createTranslator(translations.resolveLanguage(settings.language, streamDeck.info.application.language));
    configuration++;
    resetPlaybackFeedback();
    configured = true;
    resolveConfigured();
    for (const entry of visible.values()) invalidate(entry);
  }
  function inspectorToken(action, requestId, scope = 'status') {
    if (streamDeck.ui.action?.id !== action.id) return;
    const revision = (uiRevisions.get(scope) ?? 0) + 1;
    uiRevisions.set(scope, revision);
    return { actionId: action.id, session: uiSession, revision, scope, requestId };
  }
  function currentInspector(token) {
    return token && token.session === uiSession && token.revision === uiRevisions.get(token.scope) && streamDeck.ui.action?.id === token.actionId;
  }
  async function sendStatus(token, payload) {
    if (currentInspector(token)) await streamDeck.ui.sendToPropertyInspector({ ...payload, ...(token.requestId === undefined ? {} : { requestId: token.requestId }) });
  }
  async function render(entry, image, imageUrl) {
    const snapshot = state, connected = online, config = configuration;
    const revision = entry.renderRevision = (entry.renderRevision || 0) + 1;
    const current = () => started && visible.get(entry.action.id) === entry && revision === entry.renderRevision && snapshot === state && connected === online && config === configuration;
    const { action, settings } = entry;
    const artUrl = connected ? snapshot.artUrl : '';
    if (entry.artUrl !== artUrl) { entry.artUrl = artUrl; entry.artImage = undefined; entry.artSampledAt = undefined; }
    if (image && imageUrl === artUrl) { entry.artImage = image; entry.artSampledAt = now(); }
    const id = suffix(action);
    let title = '', picture, feedback, buttonState;
    if (!connected) {
      clearPlaybackFeedback(entry);
      entry.captionKey = undefined;
      entry.scrolling = false;
      title = t('openButton');
      if (id === 'nowplaying') picture = 'imgs/music.png';
      feedback = { title: 'Spotifast', value: t('offline'), indicator: 0, icon: 'imgs/music.png' };
      if (['playpause', 'nowplaying', 'shuffle', 'repeat', 'like'].includes(id)) buttonState = 0;
    } else {
      if (['playpause', 'nowplaying'].includes(id)) buttonState = snapshot.state === 'playing' ? 1 : 0;
      if (id === 'shuffle') buttonState = snapshot.shuffle ? 1 : 0;
      if (id === 'repeat') { buttonState = snapshot.repeat === 'off' ? 0 : 1; title = snapshot.repeat === 'track' ? '1' : ''; }
      if (id === 'like') buttonState = snapshot.saved === 'yes' ? 1 : 0;
      if (id === 'nowplaying') {
        picture = entry.artImage ?? 'imgs/music.png';
        const clock = now();
        const captionKey = JSON.stringify([snapshot.title, snapshot.artists, snapshot.album, snapshot.duration, snapshot.artUrl, settings.showText, settings.scrollText, settings.captionLayout]);
        if (entry.captionKey !== captionKey) { entry.captionKey = captionKey; entry.captionStartedAt = clock; entry.lastAnimationAt = undefined; }
        const overlays = playbackOverlays(snapshot, settings, clock - sampledAt);
        if (entry.playbackFeedback && (clock >= entry.playbackFeedback.until || entry.playbackFeedback.state !== snapshot.state || entry.playbackFeedback.track !== trackKey(snapshot))) clearPlaybackFeedback(entry);
        const playbackFeedback = entry.playbackFeedback;
        const captionTitle = snapshot.title || t('noTrack'), captionArtists = snapshot.title ? snapshot.artists : '';
        const options = {
          showText: settings.showText !== false, scrollText: settings.scrollText !== false,
          captionLayout: settings.captionLayout === 'twoLines' ? 'twoLines' : 'compact',
          elapsedMs: Math.max(0, clock - entry.captionStartedAt), ...overlays,
          playbackFeedback: playbackFeedback?.state,
          feedbackOpacity: playbackFeedback ? Math.min(1, Math.max(0, (playbackFeedback.until - clock) / 200)) : undefined
        };
        picture = await artworkRenderer.render(entry.artImage, captionTitle, captionArtists, options);
        const scrolling = await artworkRenderer.hasScrollingText(captionTitle, captionArtists, options);
        if (!current()) return;
        entry.scrolling = scrolling;
        Object.assign(entry, overlays);
        entry.lastAnimationAt ??= clock;
      }
      if (id === 'playlist') title = spotifyLinks.shortcutName(settings.displayName);
      if (['volumeup', 'volumedown', 'mute'].includes(id)) title = snapshot.volume === null ? '' : snapshot.volume + '%';
      if (['seekback', 'seekforward'].includes(id)) title = (id === 'seekback' ? '−' : '+') + seekSeconds(settings) + 's';
      if (id === 'restart') title = '0:00';
      if (id === 'device') title = shortText(snapshot.device || t('noDevice'), 18);
      if (id === 'setvolume') title = absoluteVolume(settings) + '%';
      if (id === 'volume') feedback = { title: shortText(snapshot.title || t('volumeTitle'), 24), value: snapshot.volume === null ? '—' : snapshot.volume + '%', indicator: snapshot.volume ?? 0, icon: entry.artImage ?? 'imgs/volumeup.png' };
    }
    // Keep image strings out of JSON serialization on every animation frame.
    const signature = { title, picture, feedback: feedback && [feedback.title, feedback.value, feedback.indicator, feedback.icon], buttonState };
    const previous = entry.signature;
    if (!current() || (previous && previous.title === title && previous.picture === picture && previous.buttonState === buttonState &&
      (previous.feedback === signature.feedback || (previous.feedback && signature.feedback && previous.feedback.every((value, index) => value === signature.feedback[index]))))) return;
    if (action.isKey()) {
      if (buttonState !== undefined && (entry.signature === undefined || entry.renderedState !== buttonState)) await action.setState(buttonState);
      if (!current()) return;
      if (picture !== undefined) await action.setImage(picture);
      if (!current()) return;
      if (entry.signature === undefined || entry.renderedTitle !== title) await action.setTitle(title);
    } else if (feedback) await action.setFeedback(feedback);
    if (current()) { entry.signature = signature; entry.renderedTitle = title; entry.renderedState = buttonState; }
  }
  async function renderEntries(entries, image, url) {
    const results = await Promise.allSettled(entries.map(entry => render(entry, image, url)));
    for (const result of results) if (result.status === 'rejected') report(result.reason);
    if (entries.length) await renderPreview();
  }
  function entryAnimationPeriod(entry, clock = now()) {
    if (!started || !online || suffix(entry.action) !== 'nowplaying') return undefined;
    // Render an expired badge once as well, in case its expiry callback was delayed.
    if (entry.playbackFeedback) return 100;
    if (entry.scrolling && entry.settings.showText !== false && entry.settings.scrollText !== false) return 100;
    const elapsed = Math.max(0, clock - sampledAt);
    const display = playbackDisplay(state, elapsed), overlays = playbackOverlays(state, entry.settings, elapsed);
    const hasClock = Object.values(overlays).some(value => value !== undefined);
    const finalFrame = Object.entries(overlays).some(([key, value]) => value !== undefined && entry[key] !== value);
    // Every optional clock shares the existing one-second animation lane,
    // including its last clamped frame before a stale sample goes idle.
    if (state.state === 'playing' && hasClock && ((elapsed < 5000 && display.remainingMs !== 0) || finalFrame)) return 1000;
    return undefined;
  }
  function animate() {
    if (animating) return animating;
    if (!started || !online) return Promise.resolve();
    const clock = now();
    const entries = [...visible.values()].filter(entry => {
      const period = entryAnimationPeriod(entry, clock);
      return period !== undefined && (entry.lastAnimationAt === undefined || clock - entry.lastAnimationAt >= period);
    });
    for (const entry of entries) entry.lastAnimationAt = clock;
    animating = renderEntries(entries).finally(() => { animating = undefined; updateAnimationTimer(); });
    return animating;
  }
  function updateAnimationTimer() {
    const periods = [...visible.values()].map(entry => entryAnimationPeriod(entry)).filter(period => period !== undefined);
    const period = periods.length ? Math.min(...periods) : undefined;
    if (period === animationPeriod) return;
    timers.clearInterval(animationInterval);
    animationInterval = undefined;
    animationPeriod = period;
    if (period !== undefined) animationInterval = timers.setInterval(() => animate().catch(report), period);
  }
  function requestArtwork() {
    const url = started && online && [...visible.values()].some(entry => ['nowplaying', 'volume'].includes(suffix(entry.action))) ? state?.artUrl : undefined;
    if (artwork.cancelExcept) {
      artwork.cancelExcept(url);
      for (const pendingUrl of artworkRequests.keys()) if (pendingUrl !== url) artworkRequests.delete(pendingUrl);
    }
    const needsArtwork = entry => ['nowplaying', 'volume'].includes(suffix(entry.action)) &&
      (entry.artUrl !== url || !entry.artImage || (artwork.isFresh ? !artwork.isFresh(url, entry.artImage) : now() - entry.artSampledAt >= 36e5));
    if (!url || artworkRequests.has(url) || artworkRequests.size >= 4 || ![...visible.values()].some(needsArtwork)) return;
    const task = Promise.resolve().then(() => {
      if (!started || !online || state?.artUrl !== url || artworkRequests.get(url) !== task) return;
      return artwork.get(url);
    }).then(async image => {
      if (!image || !started || !online || state?.artUrl !== url || artworkRequests.get(url) !== task) return;
      const changed = [];
      for (const entry of visible.values()) {
        if (!['nowplaying', 'volume'].includes(suffix(entry.action))) continue;
        if (entry.artUrl !== url || entry.artImage !== image) changed.push(entry);
        else entry.artSampledAt = now();
      }
      await renderEntries(changed, image, url);
    }).catch(report).finally(() => { if (artworkRequests.get(url) === task) artworkRequests.delete(url); });
    artworkRequests.set(url, task);
  }
  function resetPolling() {
    timers.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    failures = 0;
    retryRevision++;
  }
  function schedulePoll() {
    if (!started || !configured || !visible.size || refreshTimer !== undefined) return;
    const delay = failures ? [3000, 6000, 15000, 30000][Math.min(failures, 4) - 1] : 1500;
    refreshTimer = timers.setTimeout(() => {
      refreshTimer = undefined;
      refresh({ background: true }).catch(report);
    }, delay);
  }
  function refresh({ background = false } = {}) {
    if (!background) resetPolling();
    if (!started || !configured || !visible.size) return Promise.resolve();
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = (async () => {
      do {
        refreshAgain = false;
        const config = configuration;
        const retry = retryRevision;
        try {
          const next = await client.snapshot();
          if (!started || !visible.size) break;
          if (config !== configuration) { refreshAgain = true; continue; }
          state = next; sampledAt = now(); online = true; lastError = '';
          diagnostics.recordSuccess('status');
          failures = 0;
          confirmPlayback(next);
        } catch (error) {
          if (!started || !visible.size) break;
          if (config !== configuration) { refreshAgain = true; continue; }
          if (retry === retryRevision) failures = Math.min(failures + 1, 4);
          online = false;
          diagnostics.recordError(error, 'status');
          resetPlaybackFeedback();
          const message = error.message ?? t('unavailable');
          if (message !== lastError) streamDeck.logger.warn(t('unavailable'));
          lastError = message;
        }
        await renderEntries([...visible.values()]);
        updateAnimationTimer();
        requestArtwork();
      } while (refreshAgain && started && visible.size);
    })().finally(() => { refreshing = undefined; schedulePoll(); });
    return refreshing;
  }
  function scheduleRefresh() {
    resetPolling();
    if (!started || !visible.size) return;
    refreshTimer = timers.setTimeout(() => { refreshTimer = undefined; refresh().catch(report); }, 250);
  }
  async function failed(event, error, token) {
    diagnostics.recordError(error, 'command');
    const entry = visible.get(event.action.id);
    if (entry) invalidate(entry);
    streamDeck.logger.warn('Action ' + suffix(event.action) + ': ' + error.message);
    await event.action.showAlert();
    await sendStatus(token, statusPayload(false, userError(error)));
    await refresh();
  }
  async function perform(event, args, launch = false) {
    const token = inspectorToken(event.action);
    // Capture the pressed key's identity before the first await. Settings or
    // profile events can otherwise rebind an old command to a new selection.
    const originEntry = visible.get(event.action.id), originConfiguration = configuration;
    const transferTarget = args?.[0] === 'transfer' ? args[1] : undefined;
    const pressedAt = now();
    const seekRequest = ['seek', 'seek-to'].includes(args?.[0]) ? {
      snapshot: state, track: seekTrack(state), ageMs: online ? pressedAt - sampledAt : Infinity
    } : undefined;
    const currentSeek = () => started && configuration === originConfiguration &&
      (!originEntry || visible.get(event.action.id) === originEntry) && seekTrack(state) === seekRequest?.track;
    const currentTransfer = () => started && configuration === originConfiguration &&
      visible.get(event.action.id) === originEntry && (!originEntry || originEntry.settings.deviceId === transferTarget);
    let request;
    try {
      await ready;
      resetPolling();
      if (['play-pause', 'play', 'pause'].includes(args?.[0])) {
        resetPlaybackFeedback();
        request = playbackRequest = {
          before: state?.state, track: state?.title ? trackKey(state) : undefined, accepted: false,
          target: args[0] === 'play' ? 'playing' : args[0] === 'pause' ? 'paused' : undefined,
          entries: [...visible.values()].filter(entry => suffix(entry.action) === 'nowplaying')
        };
        updateAnimationTimer();
        renderEntries(request.entries).catch(report);
      }
      const ordered = event.payload?.isInMultiAction === true;
      if (launch || suffix(event.action) === 'open') await client.open({ ordered });
      else if (args?.[0] === 'transfer') {
        if (!currentTransfer()) throw new LocalizedError('deviceStale');
        await client.transfer(transferTarget, { valid: currentTransfer });
      } else if (['seek', 'seek-to'].includes(args?.[0])) {
        if (!currentSeek()) throw new LocalizedError('seekStale');
        await client.seek(args, { snapshot: seekRequest.snapshot, ageMs: seekRequest.ageMs + Math.max(0, now() - pressedAt), valid: currentSeek });
      } else await client.run(args, { ordered });
      diagnostics.recordSuccess(launch || suffix(event.action) === 'open' ? 'open' : 'command');
      if (!started) return;
      if (request && playbackRequest === request) { request.accepted = true; request.until = now() + 5000; }
      const entry = visible.get(event.action.id);
      if (entry) invalidate(entry);
      scheduleRefresh();
    } catch (error) {
      if (request && playbackRequest === request) playbackRequest = undefined;
      if (!started) return;
      await failed(event, error, token);
    }
  }
  async function performInvalid(event, error) { await failed(event, error, inspectorToken(event.action)); }
  async function renderPreview() {
    const request = preview;
    if (!request || !currentInspector(request.token)) return;
    const snapshot = state, config = configuration, connected = online;
    const entry = visible.get(request.token.actionId), clock = now();
    let image;
    if (connected) {
      const options = { ...request.settings, ...playbackOverlays(snapshot, request.settings, clock - sampledAt),
        elapsedMs: Math.max(0, clock - (entry?.captionStartedAt ?? request.startedAt)) };
      const cover = entry?.artUrl === snapshot.artUrl ? entry.artImage : undefined;
      image = await artworkRenderer.render(cover, snapshot.title || t('noTrack'), snapshot.title ? snapshot.artists : '', options);
    }
    if (request !== preview || snapshot !== state || config !== configuration || connected !== online) return;
    const messageKey = !connected ? 'previewOffline' : !snapshot.title || snapshot.state === 'stopped' ? 'previewNoPlayback' : 'previewLive';
    if (request.image === image && request.messageKey === messageKey) return;
    await sendStatus(request.token, { type: 'preview', online: connected, image, messageKey });
    request.image = image; request.messageKey = messageKey;
  }
  async function previewRequest(event) {
    if (suffix(event.action) !== 'nowplaying') return;
    const token = inspectorToken(event.action, event.payload.requestId, 'preview');
    if (!token) return;
    // Preview settings are allowlisted and never persisted or applied to keys.
    preview = { token, settings: artworkSettings(event.payload.settings ?? visible.get(event.action.id)?.settings), startedAt: now() };
    await renderPreview();
  }
  async function diagnosticRequest(event) {
    const token = inspectorToken(event.action, event.payload.requestId, 'diagnostics');
    if (!token) return;
    await ready;
    let detected = null, upstreamVersion;
    const config = configuration;
    try {
      if (client.executable) { await client.executable(); detected = true; }
      // --version is handled by Spotifast before startup. Only this explicit
      // local diagnostic request invokes it; polling and previews never do.
      if (detected) { try { upstreamVersion = await client.run(['--version']); } catch {} }
    } catch (error) { detected = false; diagnostics.recordError(error, 'inspector'); }
    if (config !== configuration) return;
    const report = diagnostics.snapshot({
      pluginVersion: streamDeck.info.plugin?.version, hostVersion: streamDeck.info.application.version,
      upstreamVersion, detected, pathMode: client.customPath ? 'custom' : 'automatic',
      online, hasPlayback: online && Boolean(state?.title) && state?.state !== 'stopped'
    });
    await sendStatus(token, { type: 'diagnostics', report });
  }
  async function inspectorRequest(event) {
    if (event.payload?.type === 'preview') return previewRequest(event);
    if (event.payload?.type === 'diagnostics') return diagnosticRequest(event);
    if (!['open', 'status', 'devices'].includes(event.payload?.type)) return;
    const token = inspectorToken(event.action, event.payload.requestId, event.payload.type === 'devices' ? 'devices' : 'status');
    if (!token) return;
    try {
      await ready;
      resetPolling();
      if (event.payload.type === 'devices') {
        const config = configuration;
        const devices = await client.devices({ valid: () => started && config === configuration && currentInspector(token) });
        await sendStatus(token, { type: 'devices', devices, messageKey: devices.length ? 'devicesRefreshed' : 'devicesEmpty' });
        return;
      }
      if (event.payload.type === 'open') await client.open();
      let config, snapshot;
      do { config = configuration; snapshot = await client.snapshot(); } while (config !== configuration && currentInspector(token));
      diagnostics.recordSuccess('inspector');
      await sendStatus(token, statusPayload(true, snapshot.title ? 'nowPlaying' : 'connected', snapshot.title, snapshot.device));
      if (event.payload.type === 'open') await refresh();
    } catch (error) { diagnostics.recordError(error, 'inspector'); await sendStatus(token, event.payload.type === 'devices' ? { type: 'devices', devices: [], messageKey: userError(error), failed: true } : statusPayload(false, userError(error))); }
    finally { if (!refreshing) schedulePoll(); }
  }
  streamDeck.ui.onDidAppear(() => { uiSession++; uiRevisions.clear(); preview = undefined; });
  streamDeck.ui.onDidDisappear(() => {
    // SDK 3 updates ui.action before invoking this listener and retains it for
    // late unrelated or overlapping disappearance events. Only a true close
    // ends the current session; every appearance still starts a fresh one.
    if (!streamDeck.ui.action) { uiSession++; uiRevisions.clear(); preview = undefined; }
  });
  streamDeck.actions.onWillAppear(event => {
    visible.set(event.action.id, { action: event.action, settings: event.payload.settings ?? {} });
    refresh().catch(report);
  });
  streamDeck.actions.onWillDisappear(event => {
    const entry = visible.get(event.action.id); if (entry) invalidate(entry);
    if (entry) clearPlaybackFeedback(entry);
    visible.delete(event.action.id);
    requestArtwork();
    if (!visible.size) resetPolling();
    updateAnimationTimer();
  });
  streamDeck.settings.onDidReceiveSettings(event => {
    const entry = visible.get(event.action.id);
    if (!entry) return;
    const next = event.payload.settings ?? {};
    const visual = settings => Object.values(artworkSettings(settings));
    const changed = (suffix(entry.action) === 'nowplaying' && visual(entry.settings).some((value, index) => value !== visual(next)[index])) ||
      (suffix(entry.action) === 'setvolume' && absoluteVolume(entry.settings) !== absoluteVolume(next)) ||
      (['seekback', 'seekforward'].includes(suffix(entry.action)) && seekSeconds(entry.settings) !== seekSeconds(next)) ||
      (suffix(entry.action) === 'playlist' && spotifyLinks.shortcutName(entry.settings.displayName) !== spotifyLinks.shortcutName(next.displayName));
    entry.settings = next;
    if (!changed) return;
    invalidate(entry);
    updateAnimationTimer();
    render(entry).then(async () => { updateAnimationTimer(); await renderPreview(); }).catch(report);
  });
  streamDeck.settings.onDidReceiveGlobalSettings(event => { configure(event.settings); refresh().catch(report); });
  streamDeck.actions.onKeyDown(event => {
    // Offline keys display Open Spotifast, regardless of their usual action.
    // Honor that label before validating playlist settings; macros keep their commands.
    if (!online && !event.payload.isInMultiAction) {
      perform(event, undefined, true).catch(report);
      return;
    }
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
    resetPolling();
    client.configure(client.customPath);
    configuration++;
    resetPlaybackFeedback();
    for (const entry of visible.values()) invalidate(entry);
    refresh().catch(report);
  });
  return {
    client, visible, artworkRequests, configure, render, refresh, animate, perform, performInvalid, inspectorRequest,
    async start() {
      await streamDeck.connect();
      started = true;
      configure(await streamDeck.settings.getGlobalSettings());
      streamDeck.logger.info(t('started', { count: actions.length }));
      await refresh();
    },
    stop() { started = false; preview = undefined; requestArtwork(); resetPolling(); resetPlaybackFeedback(); timers.clearInterval(animationInterval); animationInterval = undefined; animationPeriod = undefined; }
  };
}
