(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpotifastSpotify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function spotifyUri(value) {
    const text = String(value ?? '').trim();
    if (/^spotify:(playlist|album|track|artist|show):[A-Za-z0-9]+$/.test(text)) return text;
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return undefined;
      const match = url.pathname.match(/^\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show)\/([A-Za-z0-9]+)\/?$/);
      if (match) return `spotify:${match[1]}:${match[2]}`;
    } catch {}
    return undefined;
  }
  function spotifyType(value) { return spotifyUri(value)?.split(':')[1]; }
  function shortcutName(value) {
    const text = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let result = '', count = 0;
    for (const { segment } of segments.segment(text)) { if (count++ === 40) break; result += segment; }
    return result;
  }
  return { spotifyUri, spotifyType, shortcutName };
});
