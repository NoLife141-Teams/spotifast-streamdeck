import {ArtworkRenderer} from './artwork.mjs';
import streamDeck from '@elgato/streamdeck';
import {UUID, actions, Spotifast, ArtworkCache, shortText, commandFor} from './core.mjs';

import translations from '../streamdeck/ui/i18n.js';
let t = translations.createTranslator(translations.resolveLanguage('auto', streamDeck.info.application.language));
function configure(settings) {
  client.configure(settings.exePath ?? '');
  t = translations.createTranslator(translations.resolveLanguage(settings.language, streamDeck.info.application.language));
  for (const entry of visible.values()) entry.signature = undefined;
}
function statusPayload(online, messageKey, trackTitle) {
  return { type: 'status', online, messageKey, trackTitle, message: t(messageKey, { title: trackTitle }) };
}
function userError(error) { return error.messageKey || (error.killed ? 'commandTimeout' : 'commandFailed'); }
var client = new Spotifast();
var artwork = new ArtworkCache();
const artworkRenderer = new ArtworkRenderer();
var visible = /* @__PURE__ */ new Map();
var state;
var online = false;
var refreshing;
var lastError = "";
var suffix = (action2) => action2.manifestId.slice(UUID.length + 1);
async function render(entry, image) {
  const { action: action2, settings: settings2 } = entry;
  const artUrl = online ? state.artUrl : "";
  if (entry.artUrl !== artUrl) {
    entry.artUrl = artUrl;
    entry.artImage = void 0;
  }
  if (image) entry.artImage = image;
  const id = suffix(action2);
  const key = action2.isKey();
  let title = "";
  let picture;
  let feedback;
  let buttonState;
  if (!online) {
    title = t("openButton");
    if (id === "nowplaying") picture = "imgs/music.png";
    feedback = { title: "Spotifast", value: t("offline"), indicator: 0, icon: "imgs/music.png" };
    if (["playpause", "shuffle", "repeat", "like"].includes(id)) buttonState = 0;
  } else {
    const playing = state.state === "playing";
    if (id === "playpause") buttonState = playing ? 1 : 0;
    if (id === "shuffle") buttonState = state.shuffle ? 1 : 0;
    if (id === "repeat") {
      buttonState = state.repeat === "off" ? 0 : 1;
      title = state.repeat === "track" ? "1" : "";
    }
    if (id === "like") buttonState = state.saved === "yes" ? 1 : 0;
    if (id === "nowplaying") {
      picture = entry.artImage ?? "imgs/music.png";
      if (settings2.showText !== false) {
        picture = await artworkRenderer.render(entry.artImage, state.title || t("noTrack"), state.title ? state.artists : "");
      }
      // The caption is part of the image, so native title wrapping cannot clip it.
      title = "";
    }
    if (["volumeup", "volumedown", "mute"].includes(id)) title = state.volume === null ? "" : `${state.volume}%`;
    if (id === "volume") feedback = { title: shortText(state.title || t("volumeTitle"), 24), value: state.volume === null ? "—" : `${state.volume}%`, indicator: state.volume ?? 0, icon: entry.artImage ?? "imgs/volumeup.png" };
  }
  const signature = JSON.stringify({ title, picture, feedback, buttonState });
  if (entry.signature === signature) return;
  if (key) {
    if (buttonState !== void 0) await action2.setState(buttonState);
    if (picture !== void 0) await action2.setImage(picture);
    await action2.setTitle(title);
  } else if (feedback) await action2.setFeedback(feedback);
  entry.signature = signature;
}
async function refresh() {
  if (refreshing) return refreshing;
  if (!visible.size) return;
  refreshing = (async () => {
    try {
      state = await client.snapshot();
      online = true;
      lastError = "";
    } catch (error40) {
      online = false;
      const message = error40.message ?? t("unavailable");
      if (message !== lastError) streamDeck.logger.warn(t("unavailable"));
      lastError = message;
    }
    await Promise.allSettled([...visible.values()].map((entry) => render(entry)));
    if (online && [...visible.values()].some((entry) => ["nowplaying", "volume"].includes(suffix(entry.action)))) {
      const image = await artwork.get(state.artUrl);
      if (image) await Promise.allSettled([...visible.values()].filter((entry) => ["nowplaying", "volume"].includes(suffix(entry.action))).map((entry) => render(entry, image)));
    }
  })().finally(() => {
    refreshing = void 0;
  });
  return refreshing;
}
async function perform(event, args) {
  try {
    if (suffix(event.action) === "open") await client.open();
    else await client.run(args);
    setTimeout(() => {
      refresh().catch(report);
    }, 250);
  } catch (error40) {
    streamDeck.logger.warn(`Action ${suffix(event.action)}: ${error40.message}`);
    await event.action.showAlert();
    await streamDeck.ui.sendToPropertyInspector(statusPayload(false, userError(error40)));
  }
}
var report = (error40) => streamDeck.logger.error(error40);
streamDeck.actions.onWillAppear((event) => {
  visible.set(event.action.id, { action: event.action, settings: event.payload.settings ?? {} });
  refresh().catch(report);
});
streamDeck.actions.onWillDisappear((event) => visible.delete(event.action.id));
streamDeck.settings.onDidReceiveSettings((event) => {
  const entry = visible.get(event.action.id);
  if (entry) {
    entry.settings = event.payload.settings ?? {};
    entry.signature = void 0;
    refresh().catch(report);
  }
});
streamDeck.settings.onDidReceiveGlobalSettings((event) => {
  configure(event.settings);
  refresh().catch(report);
});
streamDeck.actions.onKeyDown((event) => {
  try {
    perform(event, commandFor(suffix(event.action), event.payload.settings)).catch(report);
  } catch (error40) {
    performInvalid(event, error40).catch(report);
  }
});
async function performInvalid(event, error40) {
  await event.action.showAlert();
  await streamDeck.ui.sendToPropertyInspector(statusPayload(false, userError(error40)));
}
streamDeck.actions.onDialRotate((event) => {
  if (event.payload.ticks === 0) return;
  try {
    perform(event, commandFor("volume", event.payload.settings, event.payload.ticks)).catch(report);
  } catch (error40) {
    performInvalid(event, error40).catch(report);
  }
});
streamDeck.actions.onDialDown((event) => perform(event, ["mute"]).catch(report));
streamDeck.actions.onTouchTap((event) => perform(event, ["play-pause"]).catch(report));
streamDeck.ui.onSendToPlugin((event) => {
  if (event.payload?.type === "open") client.open().catch(report);
  if (event.payload?.type === "status") {
    client.snapshot().then((snapshot) => streamDeck.ui.sendToPropertyInspector(statusPayload(true, snapshot.title ? "nowPlaying" : "connected", snapshot.title))).catch(() => streamDeck.ui.sendToPropertyInspector(statusPayload(false, "signIn"))).catch(report);
  }
});
streamDeck.system.onSystemDidWakeUp(() => {
  client.configure(client.customPath);
  refresh().catch(report);
});
async function main() {
  await streamDeck.connect();
  configure(await streamDeck.settings.getGlobalSettings());
  streamDeck.logger.info(t("started", { count: actions.length }));
  setInterval(() => refresh().catch(report), 1500);
}
main().catch(report);
