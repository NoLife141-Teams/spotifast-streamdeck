import translations from '../streamdeck/ui/i18n.js';
import spotifyLinks from '../streamdeck/ui/spotify.js';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import path from 'node:path';
import { compactArtwork } from './compact-artwork.mjs';

class LocalizedError extends Error {
  constructor(messageKey) { super(translations.createTranslator('en')(messageKey)); this.messageKey = messageKey; }
}
var UUID = "rocks.spotifast.streamdeck";
var actions = [
  ["playpause","Play / Pause (icon)","play"],
  ["next","Next","next"],
  ["previous","Previous","previous"],
  ["nowplaying","Play / Pause with artwork","music"],
  ["volumeup","Volume +","volumeup"],
  ["volumedown","Volume −","volumedown"],
  ["mute","Mute","mute"],
  ["shuffle","Shuffle","shuffle"],
  ["repeat","Repeat","repeat"],
  ["like","Favorite","heart"],
  ["playlist","Play a playlist","playlist"],
  ["open","Open Spotifast","music"],
  ["volume","Volume (dial)","volumeup"]
];
function parseNowPlaying(raw) {
  const fields = String(raw).replace(/[\r\n]+$/, "").split("	");
  const [state2, title = "", artists = "", album = "", position = "0", duration3 = "0", volume = "0", shuffle = "", repeat = "off", artUrl = "", saved = "unknown", device = ""] = fields;
  if (!["stopped", "playing", "paused"].includes(state2)) throw new LocalizedError("unknownResponse");
  if (state2 !== "stopped" && fields.length < 9) throw new LocalizedError("incompleteResponse");
  const numeric = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return { state: state2, title, artists, album, position: numeric(position), duration: numeric(duration3), volume: fields.length > 6 ? Math.min(100, numeric(volume)) : null, shuffle: ["on", "true", "yes", "1"].includes(shuffle), repeat, artUrl, saved, device };
}
function volumeStep(settings2 = {}) {
  const step = Number(settings2.step ?? 5);
  return Number.isFinite(step) ? Math.max(1, Math.min(25, Math.round(step))) : 5;
}
function remainingTime(snapshot, elapsedMs = 0) {
  if (!snapshot || snapshot.state === 'stopped' || !Number.isFinite(snapshot.duration) || snapshot.duration <= 0 || !Number.isFinite(snapshot.position)) return undefined;
  const elapsed = snapshot.state === 'playing' && Number.isFinite(elapsedMs) ? Math.max(0, Math.min(5000, elapsedMs)) : 0;
  return Math.max(0, snapshot.duration - Math.max(0, snapshot.position) - elapsed);
}
function spotifyUri(value) {
  const uri = spotifyLinks.spotifyUri(value);
  if (uri) return uri;
  throw new LocalizedError("invalidUri");
}
function commandFor(id, settings2 = {}, ticks, desiredState) {
  if (desiredState !== undefined) {
    if (![0, 1].includes(desiredState)) throw new LocalizedError('unknownAction');
    if (['playpause', 'nowplaying'].includes(id)) return [desiredState ? 'play' : 'pause'];
    if (id === 'shuffle') return ['shuffle', desiredState ? 'on' : 'off'];
    if (id === 'repeat') return ['repeat', desiredState ? 'context' : 'off'];
    if (id === 'like') throw new LocalizedError('unsupportedMultiAction');
  }
  const simple = { playpause: "play-pause", nowplaying: "play-pause", next: "next", previous: "previous", mute: "mute", shuffle: "shuffle", repeat: "repeat", like: "like", open: "show" };
  if (simple[id]) return [simple[id]];
  if (id === "playlist") return ["play-uri", spotifyUri(settings2.uri)];
  if (id === "volumeup" || id === "volumedown") return [id === "volumeup" ? "volume-up" : "volume-down", String(volumeStep(settings2))];
  if (id === "volume") {
    if (!Number.isFinite(ticks) || !Number.isInteger(ticks)) throw new LocalizedError("unknownRotation");
    return [ticks < 0 ? "volume-down" : "volume-up", String(Math.min(100, Math.abs(ticks) * volumeStep(settings2)))];
  }
  throw new LocalizedError("unknownAction");
}
var CommandQueue = class {
  pending = [];
  active;
  scheduled = false;
  constructor({ now = Date.now, maxPending = 32 } = {}) {
    this.now = now;
    this.maxPending = maxPending;
  }
  run(job, { key, priority = 0, maxWait = 5000, data, merge, renewOnMerge = false, dedupe = false } = {}) {
    const duplicate = dedupe && [this.active, ...this.pending].find(task => task?.key === key);
    if (duplicate) return duplicate.promise;
    const previous = this.pending.at(-1);
    if (merge && previous?.key === key && this.now() <= previous.expires) {
      merge(previous.data, data);
      if (renewOnMerge) previous.expires = this.now() + maxWait;
      return previous.promise;
    }
    if (this.pending.length >= this.maxPending) {
      let lowest = 0;
      for (let i = 1; i < this.pending.length; i++) if (this.pending[i].priority < this.pending[lowest].priority) lowest = i;
      if (priority <= this.pending[lowest].priority) return Promise.reject(new LocalizedError('commandQueueBusy'));
      this.pending.splice(lowest, 1)[0].reject(new LocalizedError('commandExpired'));
    }
    let resolve, reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    this.pending.push({ job, key, priority, data, promise, resolve, reject, expires: this.now() + maxWait });
    if (!this.active && !this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => { this.scheduled = false; this.drain(); });
    }
    return promise;
  }
  async drain() {
    if (this.active) return;
    while (this.pending.length) {
      let index = 0;
      for (let i = 1; i < this.pending.length; i++) if (this.pending[i].priority > this.pending[index].priority) index = i;
      const task = this.pending.splice(index, 1)[0];
      this.active = task;
      try {
        if (this.now() > task.expires) throw new LocalizedError('commandExpired');
        task.resolve(await task.job(task.data));
      } catch (error) { task.reject(error); }
      this.active = undefined;
    }
  }
  cancelPending() {
    for (const task of this.pending.splice(0)) task.reject(new LocalizedError('commandExpired'));
  }
};
var execute = promisify(execFile);
var Spotifast = class {
  customPath = "";
  cachedPath;
  configuration = 0;
  constructor({ queue = new CommandQueue(), executeFile = execute, spawnFile = spawn } = {}) {
    this.queue = queue;
    this.executeFile = executeFile;
    this.spawnFile = spawnFile;
  }
  configure(customPath = "") {
    const next = String(customPath).trim();
    if (this.customPath !== next) this.queue.cancelPending();
    this.customPath = next;
    this.cachedPath = void 0;
    this.configuration++;
  }
  async executable() {
    if (this.cachedPath) return this.cachedPath;
    const configuration = this.configuration;
    const candidates = this.customPath ? [this.customPath] : [
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Spotifast", "spotifast.exe"),
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Spotifast", "spotifast.exe"),
      ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "spotifast.exe"))
    ];
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate) || !candidate.toLowerCase().endsWith(".exe")) continue;
      try {
        await access(candidate);
        if (configuration !== this.configuration) return this.executable();
        this.cachedPath = candidate;
        return candidate;
      } catch {
      }
    }
    if (configuration !== this.configuration) return this.executable();
    throw new LocalizedError("executableMissing");
  }
  run(args) {
    const volume = ['volume-up', 'volume-down'].includes(args[0]);
    const snapshot = args[0] === 'now-playing';
    const data = { args: [...args] };
    // Playback changes retain input order; controls may still overtake volume and status.
    const options = { data, priority: snapshot ? -10 : volume ? 0 : 20, maxWait: volume ? 2500 : 5000 };
    if (volume) {
      options.key = args[0];
      data.parts = [{ amount: Number(args[1]), expires: this.queue.now() + options.maxWait }];
      options.renewOnMerge = true;
      options.merge = (previous, next) => {
        previous.parts = previous.parts.filter(part => part.expires >= this.queue.now());
        const last = previous.parts.at(-1), incoming = next.parts[0];
        if (last?.expires === incoming.expires) last.amount = Math.min(100, last.amount + incoming.amount);
        else previous.parts.push(incoming);
      };
    }
    if (snapshot) { options.key = 'snapshot'; options.dedupe = true; }
    return this.queue.run(async ({ args: queuedArgs, parts }) => {
      const exe = await this.executable();
      if (parts) {
        const fresh = parts.filter(part => part.expires >= this.queue.now());
        if (!fresh.length) throw new LocalizedError('commandExpired');
        queuedArgs[1] = String(Math.min(100, fresh.reduce((sum, part) => sum + part.amount, 0)));
      }
      // Only the short-lived status CLI gets the smaller budget; writes stay serialized.
      const { stdout } = await this.executeFile(exe, queuedArgs, { windowsHide: true, timeout: snapshot ? 1000 : 5000, maxBuffer: 1024 * 1024, encoding: "utf8", shell: false });
      return stdout;
    }, options);
  }
  async snapshot() {
    return parseNowPlaying(await this.run(["now-playing", "--raw"]));
  }
  open() {
    return this.queue.run(async () => {
      const exe = await this.executable();
      // A bare launch starts the app, or surfaces its existing instance. Do not
      // run the GUI through execFile: its timeout would kill a cold launch.
      await new Promise((resolve, reject) => {
        const child = this.spawnFile(exe, [], {
          cwd: path.dirname(exe), detached: true, stdio: "ignore", windowsHide: false, shell: false
        });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    }, { key: 'open', priority: 20, dedupe: true });
  }
};
function isArtworkUrl(value) {
  try {
    const url2 = new URL(value);
    return url2.protocol === "https:" && !url2.username && !url2.password && !url2.port && ["i.scdn.co", "mosaic.scdn.co", "image-cdn-ak.spotifycdn.com"].includes(url2.hostname);
  } catch {
    return false;
  }
}
var ArtworkCache = class {
  cache = /* @__PURE__ */ new Map();
  pending = new Map();
  controllers = new Map();
  bytes = 0;
  constructor(fetcher = fetch, { maxEntries = 8, maxBytes = 1024 * 1024, now = Date.now } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid artwork cache budget');
    this.fetcher = fetcher;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.now = now;
  }
  remember(url, value) {
    const previous = this.cache.get(url);
    if (previous) { this.bytes -= previous.bytes; this.cache.delete(url); }
    const bytes = value ? Buffer.byteLength(value) : 0;
    if (this.maxEntries < 1 || bytes > this.maxBytes) return;
    this.cache.set(url, { value, bytes, expires: this.now() + (value ? 36e5 : 3e4) });
    this.bytes += bytes;
    while (this.cache.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.cache.keys().next().value;
      this.bytes -= this.cache.get(oldest).bytes;
      this.cache.delete(oldest);
    }
  }
  async get(url2) {
    if (!isArtworkUrl(url2)) return void 0;
    const cached2 = this.cache.get(url2);
    if (cached2 && cached2.expires > this.now()) return cached2.value;
    if (this.pending.has(url2)) return this.pending.get(url2);
    const controller = new AbortController();
    const task = this.load(url2, controller.signal).finally(() => {
      if (this.pending.get(url2) === task) { this.pending.delete(url2); this.controllers.delete(url2); }
    });
    this.controllers.set(url2, controller);
    this.pending.set(url2, task);
    return task;
  }
  cancelExcept(url) {
    for (const [pendingUrl, controller] of this.controllers) {
      if (pendingUrl === url) continue;
      controller.abort();
      this.controllers.delete(pendingUrl);
      this.pending.delete(pendingUrl);
    }
  }
  async load(url2, cancellation = new AbortController().signal) {
    let value;
    try {
      const response = await this.fetcher(url2, { signal: AbortSignal.any([cancellation, AbortSignal.timeout(4e3)]), redirect: "error" });
      cancellation.throwIfAborted();
      if (!response.ok || !response.body) throw new LocalizedError("artworkUnavailable");
      const type = (response.headers.get("content-type") ?? "").split(";")[0];
      if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new LocalizedError("artworkFormat");
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new LocalizedError("artworkTooLarge");
        }
        chunks.push(part.value);
      }
      cancellation.throwIfAborted();
      const compact = await compactArtwork(Buffer.concat(chunks), type);
      value = `data:${compact.contentType};base64,${compact.bytes.toString("base64")}`;
    } catch {
    }
    // A cancelled request is not an artwork failure and must remain immediately retryable.
    if (cancellation.aborted) return undefined;
    this.remember(url2, value);
    return value;
  }
  isFresh(url, value) {
    // Check the original deadline even when a key already holds this image.
    const cached = this.cache.get(url);
    return !!value && cached?.value === value && cached.expires > (this.now?.() ?? Date.now());
  }
};
function shortText(value, max = 13) {
  const chars = Array.from(String(value));
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}


export {LocalizedError, UUID, actions, parseNowPlaying, remainingTime, volumeStep, spotifyUri, commandFor, CommandQueue, Spotifast, isArtworkUrl, ArtworkCache, shortText};
