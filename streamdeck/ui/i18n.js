(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpotifastI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const messages = {
    en: {
      language: 'Language', automatic: 'Follow Stream Deck', checking: 'Checking connection…',
      open: 'Open Spotifast', check: 'Check connection', playlistLabel: 'Playlist, album or track link',
      playlistHint: 'Copy a Spotify link or use a spotify:playlist:… URI.', volumeLabel: 'Volume step (%)',
      showText: 'Show the title and artist on the artwork', executableLabel: 'Spotifast location (optional)',
      executablePlaceholder: 'Automatic detection', executableHint: 'Applies to all buttons. Leave empty for the standard Windows installation.',
      help: 'Spotifast must be open and connected to Spotify. Playback requires Spotify Premium.',
      artworkHelp: 'The artwork and track update automatically. Press the button to play or pause.',
      dialHelp: 'Turn to adjust Spotifast volume. Press to mute. Tap the screen to play or pause.',
      connected: 'Spotifast is open. Choose a track in the app.', signIn: 'Open Spotifast and sign in to Spotify.',
      nowPlaying: 'Now playing: {title}', offline: 'Offline', openButton: 'Open\nSpotifast',
      noTrack: 'No\ntrack', volumeTitle: 'Spotifast volume', unavailable: 'Spotifast is unavailable. Open the app.',
      unknownResponse: 'Unrecognized Spotifast response.', incompleteResponse: 'Incomplete Spotifast response.',
      invalidUri: 'Add a valid Spotify link or URI in this button’s settings.', unknownRotation: 'Unrecognized dial rotation.',
      unknownAction: 'Unrecognized action.', executableMissing: 'Spotifast was not found. Check its location in the plugin settings.',
      commandFailed: 'The command failed. Check that Spotifast is open and signed in.', commandTimeout: 'Spotifast did not respond. Try again.',
      artworkUnavailable: 'Artwork is unavailable.', artworkFormat: 'Unsupported artwork format.', artworkTooLarge: 'Artwork is too large.',
      started: 'Spotifast plugin started ({count} actions).',
      description: 'Local Spotifast controls: playback, artwork, favorites, playlists and volume.',
      action_playpause: 'Play / Pause', action_next: 'Next', action_previous: 'Previous',
      action_nowplaying: 'Track and artwork', action_volumeup: 'Volume +', action_volumedown: 'Volume −',
      action_mute: 'Mute', action_shuffle: 'Shuffle', action_repeat: 'Repeat', action_like: 'Favorite',
      action_playlist: 'Play a playlist', action_open: 'Open Spotifast', action_volume: 'Volume (dial)',
      dialTooltip: 'Turn: volume. Press: mute. Tap: play/pause.', rotate: 'Adjust volume', push: 'Mute', touch: 'Play / Pause'
    },
    fr: {
      language: 'Langue', automatic: 'Suivre Stream Deck', checking: 'Vérification de la connexion…',
      open: 'Ouvrir Spotifast', check: 'Vérifier la connexion', playlistLabel: 'Lien de playlist, album ou morceau',
      playlistHint: 'Copie un lien Spotify ou utilise une URI spotify:playlist:…', volumeLabel: 'Variation du volume (%)',
      showText: 'Afficher le titre et l’artiste sur la pochette', executableLabel: 'Emplacement de Spotifast (facultatif)',
      executablePlaceholder: 'Détection automatique', executableHint: 'Ce réglage s’applique à tous les boutons. Laisse vide pour l’installation Windows standard.',
      help: 'Spotifast doit être ouvert et connecté à Spotify. La lecture nécessite Spotify Premium.',
      artworkHelp: 'La pochette et le morceau se mettent à jour automatiquement. Appuie sur le bouton pour lire ou mettre en pause.',
      dialHelp: 'Tourne pour régler le volume de Spotifast. Appuie pour couper le son. Touche l’écran pour lire ou mettre en pause.',
      connected: 'Spotifast est ouvert. Choisis un morceau dans l’application.', signIn: 'Ouvre Spotifast et connecte-toi à Spotify.',
      nowPlaying: 'Lecture en cours : {title}', offline: 'Hors ligne', openButton: 'Ouvrir\nSpotifast',
      noTrack: 'Aucun\nmorceau', volumeTitle: 'Volume Spotifast', unavailable: 'Spotifast indisponible. Ouvre l’application.',
      unknownResponse: 'Réponse Spotifast inconnue.', incompleteResponse: 'Réponse Spotifast incomplète.',
      invalidUri: 'Ajoute un lien ou une URI Spotify valide dans les réglages de ce bouton.', unknownRotation: 'Rotation inconnue.',
      unknownAction: 'Action inconnue.', executableMissing: 'Spotifast introuvable. Vérifie son emplacement dans les réglages du plugin.',
      commandFailed: 'La commande a échoué. Vérifie que Spotifast est ouvert et connecté.', commandTimeout: 'Spotifast ne répond pas. Réessaie.',
      artworkUnavailable: 'Pochette indisponible.', artworkFormat: 'Format de pochette non pris en charge.', artworkTooLarge: 'Pochette trop grande.',
      started: 'Plugin Spotifast démarré ({count} actions).',
      description: 'Contrôle local de Spotifast : lecture, pochette, favoris, playlists et volume.',
      action_playpause: 'Lecture / Pause', action_next: 'Suivant', action_previous: 'Précédent',
      action_nowplaying: 'Morceau et pochette', action_volumeup: 'Volume +', action_volumedown: 'Volume −',
      action_mute: 'Sourdine', action_shuffle: 'Lecture aléatoire', action_repeat: 'Répétition', action_like: 'Favori',
      action_playlist: 'Lancer une playlist', action_open: 'Ouvrir Spotifast', action_volume: 'Volume (molette)',
      dialTooltip: 'Tourner : volume. Appuyer : sourdine. Toucher : lecture/pause.', rotate: 'Régler le volume', push: 'Sourdine', touch: 'Lecture / Pause'
    }
  };
  function resolveLanguage(preference, hostLanguage) {
    if (preference === 'en' || preference === 'fr') return preference;
    return /^fr(?:[-_]|$)/i.test(String(hostLanguage || '')) ? 'fr' : 'en';
  }
  function createTranslator(language) {
    const locale = resolveLanguage(language);
    return function translate(key, values = {}) {
      const value = messages[locale][key] ?? messages.en[key] ?? key;
      return value.replace(/\{(\w+)\}/g, (match, name) => values[name] === undefined ? match : String(values[name]));
    };
  }
  return { messages, resolveLanguage, createTranslator };
});
