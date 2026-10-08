import opentype from 'opentype.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SIZE = 72;
const TEXT_WIDTH = 60;
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const normalized = value => String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim();
async function loadSystemFonts() {
  const directory = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const load = async name => {
    const bytes = await readFile(path.join(directory, name));
    return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const [regular, bold] = await Promise.all([load('arial.ttf'), load('arialbd.ttf')]);
  return { regular, bold };
}
function supported(font, text) {
  return !!font && Array.from(text).every(char => font.charToGlyphIndex(char) !== 0);
}
function widthOf(text, size, font) {
  if (supported(font, text)) {
    const box = font.getPath(text, 0, 0, size).getBoundingBox();
    return Math.max(font.getAdvanceWidth(text, size), box.x2 - box.x1);
  }
  return Array.from(segments.segment(text), ({ segment }) => supported(font, segment) ? font.getAdvanceWidth(segment, size) : 2 * size).reduce((sum, width) => sum + width, 0);
}
export function fitCaption(value, font, { maxSize = 10, minSize = 8.5, maxWidth = TEXT_WIDTH } = {}) {
  const original = normalized(value);
  let size = maxSize;
  while (size > minSize && widthOf(original, size, font) > maxWidth) size = Math.max(minSize, size - 0.5);
  if (widthOf(original, size, font) <= maxWidth) return { text: original, size, width: widthOf(original, size, font) };
  const chars = Array.from(segments.segment(original), segment => segment.segment);
  while (chars.length && widthOf(chars.join('').trimEnd() + '…', size, font) > maxWidth) chars.pop();
  const text = chars.join('').trimEnd() + '…';
  return { text, size, width: widthOf(text, size, font) };
}
// Hold both ends, then ease back along the same line without a wraparound jump.
export function scrollOffset(width, elapsedMs = 0) {
  const distance = Number.isFinite(width) ? Math.max(0, width - TEXT_WIDTH) : 0;
  if (!distance) return 0;
  const hold = 1800, travel = Math.max(1200, distance / 12 * 1000);
  const phase = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) % (2 * (hold + travel));
  const ease = progress => (1 - Math.cos(Math.PI * progress)) / 2;
  let progress = 0;
  if (phase > hold && phase < hold + travel) progress = ease((phase - hold) / travel);
  else if (phase >= hold + travel && phase <= 2 * hold + travel) progress = 1;
  else if (phase > 2 * hold + travel) progress = 1 - ease((phase - 2 * hold - travel) / travel);
  return Math.round(distance * progress * 100) / 100;
}
export function formatRemaining(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const seconds = Math.ceil(milliseconds / 1000), minutes = Math.floor(seconds / 60);
  const pad = value => String(value).padStart(2, '0');
  return '-' + (minutes >= 60 ? Math.floor(minutes / 60) + ':' + pad(minutes % 60) : minutes) + ':' + pad(seconds % 60);
}
function prepareLine(value, font, sizes, scrollText = false) {
  let line;
  if (scrollText) {
    const text = normalized(value);
    let size = sizes.maxSize;
    while (size > sizes.minSize && widthOf(text, size, font) > TEXT_WIDTH) size = Math.max(sizes.minSize, size - 0.5);
    line = { text, size, width: widthOf(text, size, font) };
  } else line = fitCaption(value, font, sizes);
  if (supported(font, line.text) && line.text) {
    const outline = font.getPath(line.text, 0, 0, line.size), box = outline.getBoundingBox();
    return { ...line, left: box.x1, inkWidth: box.x2 - box.x1, path: outline.toPathData(2) };
  }
  return { ...line, left: 0, inkWidth: line.width };
}
function prepareCaption(title, artists, fonts, options) {
  const compact = options.captionLayout === 'compact';
  return {
    title: normalized(title), artists: normalized(artists), showText: options.showText !== false, compact,
    track: prepareLine(title, fonts.bold, { maxSize: 10, minSize: 9 }, options.scrollText),
    artist: prepareLine(artists, fonts.regular, { maxSize: 9, minSize: 8.5 }, options.scrollText),
    combined: compact ? prepareLine([normalized(title), normalized(artists)].filter(Boolean).join(' • '), fonts.bold, { maxSize: 10, minSize: 9 }, options.scrollText) : undefined
  };
}
function drawLine(line, baseline, fill, offset = 0, center = SIZE / 2) {
  if (!line.text) return '';
  const x = line.width > TEXT_WIDTH ? 6 - line.left - offset : center - line.inkWidth / 2 - line.left;
  const glyphs = line.path ? '<path fill="' + fill + '" d="' + line.path + '"/>' :
    '<text x="0" y="0" font-family="Arial,sans-serif" font-size="' + line.size + '" textLength="' + line.width + '" lengthAdjust="spacingAndGlyphs" fill="' + fill + '">' + xml(line.text) + '</text>';
  return '<g transform="translate(' + x + ' ' + baseline + ')">' + glyphs + '</g>';
}
function renderCaption(cover, layout, fonts, { elapsedMs = 0, remainingMs, playbackFeedback, feedbackOpacity = 1 } = {}) {
  const feedback = ['playing', 'paused'].includes(playbackFeedback);
  const opacity = Math.round(Math.max(0, Math.min(1, Number.isFinite(feedbackOpacity) ? feedbackOpacity : 1)) * 100) / 100;
  const timerWidth = TEXT_WIDTH;
  const remaining = formatRemaining(remainingMs);
  let time = prepareLine(remaining, fonts.regular, { maxSize: 9, minSize: 8.5, maxWidth: timerWidth });
  // Keep every digit even if system fonts are unavailable or the track lasts hours.
  if (time.text !== remaining) {
    const width = Math.min(timerWidth, remaining.length * 5.5);
    time = { text: remaining, size: 8.5, width, inkWidth: width, left: 0 };
  }
  const badgeWidth = Math.max(30, time.width + 8);
  const image = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(cover || '') ?
    '<image x="0" y="0" width="72" height="72" preserveAspectRatio="xMidYMid slice" xlink:href="' + cover + '"/>' : '';
  const textTop = layout.compact ? 56 : 48;
  const caption = layout.compact ? drawLine(layout.combined, 66, '#fff', scrollOffset(layout.combined.width, elapsedMs)) :
    '<g clip-path="url(#track)">' + drawLine(layout.track, 58, '#fff', scrollOffset(layout.track.width, elapsedMs)) +
    '</g><g clip-path="url(#artist)">' + drawLine(layout.artist, 69, '#dedede', scrollOffset(layout.artist.width, elapsedMs)) + '</g>';
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 72 72">' +
    '<title>' + xml(layout.title) + '</title><desc>' + xml(layout.artists) + '</desc>' +
    '<defs><linearGradient id="captionShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity=".88"/></linearGradient>' +
    '<clipPath id="caption"><rect x="6" y="' + textTop + '" width="60" height="' + (72 - textTop) + '"/></clipPath><clipPath id="track"><rect x="6" y="48" width="60" height="13"/></clipPath><clipPath id="artist"><rect x="6" y="60" width="60" height="12"/></clipPath></defs>' +
    '<rect width="72" height="72" fill="#202020"/>' + image +
    (feedback && opacity > 0 ? '<g id="playback-feedback" opacity="' + opacity + '"><rect x="20" y="20" width="32" height="32" rx="7" fill="#000" fill-opacity=".84"/>' +
      (playbackFeedback === 'paused' ? '<path id="playback-pause" d="M28 27h6v18h-6z M38 27h6v18h-6z" fill="#fff"/>' : '<path id="playback-play" d="M31 26l14 10-14 10z" fill="#fff"/>') + '</g>' : '') +
    (remaining ? '<rect x="' + (68 - badgeWidth) + '" y="4" width="' + badgeWidth + '" height="14" rx="3" fill="#000" fill-opacity=".84"/>' + drawLine(time, 14, '#fff', 0, 68 - badgeWidth / 2) : '') +
    (layout.showText ? '<rect y="' + (textTop - 2) + '" width="72" height="' + (74 - textTop) + '" fill="url(#captionShade)"/>' +
    '<g clip-path="url(#caption)"><g stroke="#000" stroke-width=".35" stroke-linejoin="round">' + caption + '</g></g>' : '') + '</svg>';
}
export function captionSvg(cover, title, artists, fonts = {}, options = {}) {
  return renderCaption(cover, prepareCaption(title, artists, fonts, options), fonts, options);
}
export class ArtworkRenderer {
  fonts;
  fallback;
  cache = new Map();
  layouts = new Map();
  constructor({ loadFonts = loadSystemFonts, fallbackPath = path.join(process.cwd(), 'imgs', 'music.png') } = {}) {
    this.fonts = Promise.resolve().then(loadFonts).catch(() => ({}));
    this.fallbackPath = fallbackPath;
  }
  async render(cover, title, artists, options = {}) {
    if (!cover) {
      this.fallback ??= readFile(this.fallbackPath).then(bytes => 'data:image/png;base64,' + bytes.toString('base64')).catch(() => '');
      cover = await this.fallback;
    }
    const fonts = await this.fonts;
    const layoutKey = JSON.stringify([title, artists, options.showText !== false, options.scrollText === true, options.captionLayout === 'compact']);
    let layout = this.layouts.get(layoutKey);
    if (!layout) {
      layout = prepareCaption(title, artists, fonts, options);
      this.layouts.set(layoutKey, layout);
      while (this.layouts.size > 8) this.layouts.delete(this.layouts.keys().next().value);
    }
    const key = JSON.stringify([cover, layoutKey, layout.showText ? scrollOffset((layout.combined ?? layout.track).width, options.elapsedMs) : 0, layout.showText && !layout.compact ? scrollOffset(layout.artist.width, options.elapsedMs) : 0, formatRemaining(options.remainingMs), options.playbackFeedback, Math.round((options.feedbackOpacity ?? 1) * 100) / 100]);
    if (this.cache.has(key)) return this.cache.get(key);
    const svg = renderCaption(cover, layout, fonts, options);
    const image = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    this.cache.set(key, image);
    while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    return image;
  }
}
