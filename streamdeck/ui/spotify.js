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
  return { spotifyUri };
});
