# Spotifast Stream Deck

[Français](#français) · [English](#english)

Independent Stream Deck controls for [Spotifast](https://spotifast.rocks/) on Windows, maintained by NoLife141-Teams.

## Français

Ce plugin contrôle Spotifast depuis un Stream Deck : lecture/pause, précédent/suivant, pochette et morceau, volume, sourdine, favoris, lecture aléatoire, répétition, ouverture de liens Spotify et contrôle par molette sur Stream Deck +.

Il contrôle **Spotifast**, qui doit être installé, ouvert et connecté à Spotify. Ce n’est pas un contrôleur direct de l’application Spotify officielle.

### Installation et utilisation

1. Installer Spotifast sur Windows et se connecter à Spotify. La lecture nécessite Spotify Premium.
2. Installer Stream Deck 7.1 ou plus récent. Le plugin utilise le SDK Elgato 3.x et nécessite cette version pour ses réglages.
3. Télécharger le fichier .streamDeckPlugin dans les [versions GitHub](https://github.com/NoLife141-Teams/spotifast-streamdeck/releases), puis ouvrir le fichier.
4. Ajouter les actions Spotifast aux touches.
5. Dans **Lancer une playlist**, coller un lien Spotify ou une URI `spotify:playlist:…`. Les liens d’album et de morceau sont également acceptés.

La fenêtre de réglages suit la langue de Stream Deck. Le choix **Langue → English / Français** change les réglages et les messages du plugin pour toutes les touches. Les noms de la liste d’actions suivent la langue de Stream Deck.

La détection automatique couvre l’installation Windows standard. Un emplacement personnalisé de `spotifast.exe` peut être indiqué dans les réglages.

### État de la version

Version 0.2.1 : texte du titre et de l’artiste ajusté à la touche, anglais et français, correction de la communication de la fenêtre de réglages et conservation des identifiants des actions existantes. L’ouverture d’une playlist depuis un lien Spotify a été testée par l’utilisateur. Les deux langues, les réglages et les commandes ont des tests automatisés; la validation du paquet Elgato réussit. Les molettes nécessitent un Stream Deck +; leur fonctionnement physique reste à vérifier sur ce modèle.

## English

This plugin controls Spotifast from a Stream Deck: play/pause, previous/next, track and artwork, volume, mute, favorites, shuffle, repeat, Spotify links, and dial controls on Stream Deck +.

It controls **Spotifast**, which must be installed, open and signed in to Spotify. It does not directly control the official Spotify desktop app.

### Installation and use

1. Install Spotifast on Windows and sign in to Spotify. Playback requires Spotify Premium.
2. Install Stream Deck 7.1 or newer. The plugin uses Elgato SDK 3.x and requires this version for its settings.
3. Download the .streamDeckPlugin installer from [GitHub Releases](https://github.com/NoLife141-Teams/spotifast-streamdeck/releases), then open it.
4. Add Spotifast actions to your keys.
5. For **Play a playlist**, paste a Spotify link or a `spotify:playlist:…` URI. Album and track links are also supported.

Settings follow the Stream Deck language. **Language → English / Français** changes the settings and runtime messages for all plugin buttons. Names in the action list follow the Stream Deck language.

Automatic detection supports the standard Windows installation. You can set a custom `spotifast.exe` location in the settings.

### Version status

Version 0.2.1 fits the title and artist inside the key and includes English and French, fixes property-inspector messaging, and preserves existing action identifiers. A user has successfully tested opening a playlist from a Spotify link. Automated tests cover both languages, settings and commands; Elgato package validation passes. Dial controls require a Stream Deck + and still need a hardware test on that model.

## Development / Développement

Node.js 20.5.1 or newer is required.

```sh
npm ci
npm run build
npm test
npm run validate
npm run pack
```

The installable package is written to `dist/`. Build files are generated in `build/rocks.spotifast.streamdeck.sdPlugin/`.

```sh
node scripts/preview.mjs
```

Open `http://127.0.0.1:4317/?lang=en` or `?lang=fr` to preview settings with a simulated Stream Deck connection. The preview does not send playback commands.

The plugin communicates with the running Spotifast instance through its documented CLI. Artwork is fetched from approved Spotify image hosts. Authentication remains in Spotifast.

This repository contains the controller source, icons and bilingual UI. It does not include personal Stream Deck profiles, Spotify credentials, local logs or machine-specific settings.

Repository / Dépôt : [NoLife141-Teams/spotifast-streamdeck](https://github.com/NoLife141-Teams/spotifast-streamdeck).

## License / Licence

Copyright (c) 2026 NoLife141-Teams.

Ce projet est distribué sous la [licence MIT](LICENSE). La licence du projet et les avis de licence des dépendances sont inclus dans le paquet.

This project is distributed under the [MIT license](LICENSE). The project license and dependency license notices are included in the installer.
