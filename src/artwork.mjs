import opentype from 'opentype.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SIZE = 72;
const TEXT_WIDTH = 60;
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const normalized = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
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
  return Array.from(segments.segment(text)).length * size;
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
function drawLine(line, font, baseline, fill) {
  if (!line.text) return '';
  if (supported(font, line.text)) {
    const outline = font.getPath(line.text, 0, baseline, line.size);
    const box = outline.getBoundingBox();
    const x = (SIZE - (box.x2 - box.x1)) / 2 - box.x1;
    const d = font.getPath(line.text, x, baseline, line.size).toPathData(2);
    return '<path fill="' + fill + '" d="' + d + '"/>';
  }
  return '<text x="36" y="' + baseline + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="' + line.size + '" fill="' + fill + '">' + xml(line.text) + '</text>';
}
export function captionSvg(cover, title, artists, fonts = {}) {
  const track = fitCaption(title, fonts.bold, { maxSize: 10, minSize: 9 });
  const artist = fitCaption(artists, fonts.regular, { maxSize: 9, minSize: 8.5 });
  const image = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(cover || '') ?
    '<image x="0" y="0" width="72" height="72" preserveAspectRatio="xMidYMid slice" xlink:href="' + cover + '"/>' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 72 72">' +
    '<title>' + xml(normalized(title)) + '</title><desc>' + xml(normalized(artists)) + '</desc>' +
    '<defs><clipPath id="caption"><rect x="6" y="44" width="60" height="26"/></clipPath></defs>' +
    '<rect width="72" height="72" fill="#202020"/>' + image +
    '<rect y="42" width="72" height="30" fill="#000" fill-opacity=".84"/>' +
    '<g clip-path="url(#caption)">' + drawLine(track, fonts.bold, 55, '#fff') + drawLine(artist, fonts.regular, 67, '#dedede') + '</g></svg>';
}
export class ArtworkRenderer {
  fonts;
  fallback;
  cache = new Map();
  constructor({ loadFonts = loadSystemFonts, fallbackPath = path.join(process.cwd(), 'imgs', 'music.png') } = {}) {
    this.fonts = Promise.resolve().then(loadFonts).catch(() => ({}));
    this.fallbackPath = fallbackPath;
  }
  async render(cover, title, artists) {
    if (!cover) {
      this.fallback ??= readFile(this.fallbackPath).then(bytes => 'data:image/png;base64,' + bytes.toString('base64')).catch(() => '');
      cover = await this.fallback;
    }
    const key = JSON.stringify([cover, title, artists]);
    if (this.cache.has(key)) return this.cache.get(key);
    const svg = captionSvg(cover, title, artists, await this.fonts);
    const image = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    this.cache.set(key, image);
    while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
    return image;
  }
}
