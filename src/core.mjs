import translations from '../streamdeck/ui/i18n.js';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {access} from 'node:fs/promises';
import path from 'node:path';

class LocalizedError extends Error {
  constructor(messageKey) { super(translations.createTranslator('en')(messageKey)); this.messageKey = messageKey; }
}
var UUID = "rocks.spotifast.streamdeck";
var actions = [
  ["playpause","Play / Pause","play"],
  ["next","Next","next"],
  ["previous","Previous","previous"],
  ["nowplaying","Track and artwork","music"],
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
function spotifyUri(value) {
  const text = String(value ?? "").trim();
  if (/^spotify:(playlist|album|track|artist|show):[A-Za-z0-9]+$/.test(text)) return text;
  try {
    const url2 = new URL(text);
    if (url2.protocol !== "https:" || url2.hostname !== "open.spotify.com") throw new Error();
    const match = url2.pathname.match(/^\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show)\/([A-Za-z0-9]+)\/?$/);
    if (match) return `spotify:${match[1]}:${match[2]}`;
  } catch {
  }
  throw new LocalizedError("invalidUri");
}
function commandFor(id, settings2 = {}, ticks, desiredState) {
  if (desiredState !== undefined) {
    if (![0, 1].includes(desiredState)) throw new LocalizedError('unknownAction');
    if (id === 'playpause') return [desiredState ? 'play' : 'pause'];
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
  run(job, { key, priority = 0, maxWait = 5000, data, merge, dedupe = false } = {}) {
    const duplicate = dedupe && [this.active, ...this.pending].find(task => task?.key === key);
    if (duplicate) return duplicate.promise;
    const previous = this.pending.at(-1);
    if (merge && previous?.key === key && this.now() <= previous.expires) {
      merge(previous.data, data);
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
  constructor({ queue = new CommandQueue(), executeFile = execute } = {}) {
    this.queue = queue;
    this.executeFile = executeFile;
  }
  configure(customPath = "") {
    const next = String(customPath).trim();
    if (this.customPath !== next) this.queue.cancelPending();
    this.customPath = next;
    this.cachedPath = void 0;
  }
  async executable() {
    if (this.cachedPath) return this.cachedPath;
    const candidates = this.customPath ? [this.customPath] : [
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Spotifast", "spotifast.exe"),
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Spotifast", "spotifast.exe"),
      ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "spotifast.exe"))
    ];
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate) || !candidate.toLowerCase().endsWith(".exe")) continue;
      try {
        await access(candidate);
        this.cachedPath = candidate;
        return candidate;
      } catch {
      }
    }
    throw new LocalizedError("executableMissing");
  }
  run(args) {
    const volume = ['volume-up', 'volume-down'].includes(args[0]);
    const snapshot = args[0] === 'now-playing';
    const data = { args: [...args] };
    const transport = ['play', 'pause', 'play-pause', 'mute', 'show'].includes(args[0]);
    const options = { data, priority: snapshot ? -10 : volume ? 0 : transport ? 20 : 10, maxWait: volume ? 2500 : 5000 };
    if (volume) {
      options.key = args[0];
      options.merge = (previous, next) => { previous.args[1] = String(Math.min(100, Number(previous.args[1]) + Number(next.args[1]))); };
    }
    if (snapshot) { options.key = 'snapshot'; options.dedupe = true; }
    return this.queue.run(async ({ args: queuedArgs }) => {
      const exe = await this.executable();
      const { stdout } = await this.executeFile(exe, queuedArgs, { windowsHide: true, timeout: 5e3, maxBuffer: 1024 * 1024, encoding: "utf8", shell: false });
      return stdout;
    }, options);
  }
  async snapshot() {
    return parseNowPlaying(await this.run(["now-playing", "--raw"]));
  }
  async open() {
    try {
      await this.run(["show"]);
    } catch {
      const exe = await this.executable();
      await new Promise((resolve, reject) => {
        const child = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      });
    }
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
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
  }
  async get(url2) {
    if (!isArtworkUrl(url2)) return void 0;
    const cached2 = this.cache.get(url2);
    if (cached2 && cached2.expires > Date.now()) return cached2.value;
    let value;
    try {
      const response = await this.fetcher(url2, { signal: AbortSignal.timeout(4e3), redirect: "error" });
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
      value = `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
    } catch {
    }
    this.cache.set(url2, { value, expires: Date.now() + (value ? 36e5 : 3e4) });
    while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
};
function shortText(value, max = 13) {
  const chars = Array.from(String(value));
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}


export {LocalizedError, UUID, actions, parseNowPlaying, volumeStep, spotifyUri, commandFor, CommandQueue, Spotifast, isArtworkUrl, ArtworkCache, shortText};
