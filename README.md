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

Les multi-actions peuvent définir explicitement Lecture/Pause avec la touche icône ou la touche avec pochette, Aléatoire activé/désactivé et Répétition désactivée/contexte. Relancer une multi-action Lecture ou Pause conserve l’état demandé. Sur une touche normale, les deux actions Lecture/Pause basculent toujours la lecture. Favori reste disponible comme touche, mais est exclu des multi-actions. Les commandes en attente sont limitées et les rotations proches dans le même sens sont regroupées.

### État de la version

La version 0.2.3 ajoute le défilement des titres et noms d’artistes trop longs sur **Lecture / Pause avec pochette**, ainsi qu’un compteur du temps restant en haut de la touche. Le texte revient progressivement au début, avec un ralentissement aux extrémités et jusqu’à dix images par seconde. Les textes courts restent immobiles. Le compteur se fige en pause et disparaît si la durée est inconnue. Les options **Faire défiler les titres et noms d’artistes longs** et **Afficher le temps restant du morceau** sont activées par défaut et peuvent être désactivées séparément; le compteur peut aussi s’afficher sans les légendes.

**Lecture / Pause (icône)** et **Lecture / Pause avec pochette** contrôlent toutes deux la lecture. La pochette n’a pas de symbole permanent. Après un appui confirmé par le lecteur, un grand symbole s’affiche au centre pendant une seconde : ▶ quand la lecture reprend, ⏸ quand elle se met en pause. Le symbole disparaît progressivement, puis la pochette retrouve son affichage normal. Cette confirmation fonctionne aussi quand les légendes et le compteur sont masqués.

**Favori** affiche un cœur plein quand le morceau est ajouté, et un cœur vide sinon. Les deux états gardent un fond noir.

La pochette affiche par défaut une seule ligne **titre • artiste**, défilante si nécessaire. Son bandeau mesure 18 pixels de haut au lieu de 30, avec un dégradé transparent et un léger contour pour lire les lettres sans masquer autant la pochette. **Disposition du texte** permet de revenir à deux lignes; décocher **Afficher le titre et l’artiste sur la pochette** masque entièrement la légende. La lecture/pause et le compteur restent indépendants de ce choix.

Le temps restant apparaît en haut à droite, en chiffres blancs gras avec un fin contour noir, sans rectangle de fond. La pochette reste visible autour des chiffres.

Version 0.2.2 corrige les constats R01 à R13 : états des boutons synchronisés, multi-actions explicites, conservation des réglages, file de commandes limitée, erreurs localisées, légendes Unicode ajustées et pochettes téléchargées sans bloquer les mises à jour. Les identifiants des actions sont conservés. L’ouverture d’une playlist depuis un lien Spotify a été testée par l’utilisateur. Les tests couvrent Node 20 et 22, les deux langues et le SDK Elgato; la validation du paquet Elgato réussit. Les molettes nécessitent un Stream Deck +; leur fonctionnement physique reste à vérifier sur ce modèle.

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

Multi Actions can explicitly set Play/Pause with either the icon key or the artwork key, Shuffle on/off, and Repeat off/context. Repeating a Play or Pause Multi Action keeps the requested state. On a regular key, both Play/Pause actions still toggle playback. Favorite remains available as a key but is excluded from Multi Actions. Pending commands are bounded and nearby rotations in the same direction are combined.

### Version status

Version 0.2.3 adds scrolling for long titles and artist names on **Play / Pause with artwork**, plus a remaining-time counter at the top of the key. Text returns gradually to the beginning, easing at both ends with up to ten frames per second. Short text stays stationary. The counter freezes when paused and hides when duration is unknown. **Scroll long titles and artist names** and **Show the remaining track time** default to enabled and can be disabled separately; the timer can also appear without captions.

**Play / Pause (icon)** and **Play / Pause with artwork** both control playback. Artwork has no permanent playback symbol. After a press is confirmed by the player, a large symbol appears in the center for one second: ▶ when playback resumes, ⏸ when it pauses. The symbol fades out and the cover returns to its normal display. This feedback also works when captions and the countdown are hidden.

**Favorite** shows a filled heart when the track is saved and an outlined heart otherwise. Both states use a black background.

Artwork defaults to one **title • artist** line, scrolling when needed. Its band is 18 pixels high instead of 30, using a transparent gradient and a thin text outline to keep more artwork visible. **Text layout** can switch back to two lines; unchecking **Show the title and artist on the artwork** hides the caption entirely. Playback controls and the countdown remain independent of this choice.

Remaining time appears at the top right as bold white digits with a thin black outline and no background rectangle. The artwork remains visible around the digits.

Version 0.2.2 addresses review findings R01–R13: synchronized button states, explicit Multi Actions, preserved settings, bounded command queue, localized errors, fitted Unicode captions and background artwork downloads. Existing action identifiers are preserved. A user has successfully tested opening a playlist from a Spotify link. Tests cover Node 20 and 22, both languages and the Elgato SDK; Elgato package validation passes. Dial controls require a Stream Deck + and still need a hardware test on that model.

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

Add `&action=nowplaying` to preview the scrolling and timer settings. Run `node scripts/artwork-preview.mjs` and open `http://127.0.0.1:4318/` for an animated preview at actual key size and twice that size. Its playback controls only affect the preview.

The plugin communicates with the running Spotifast instance through its documented CLI. Artwork is fetched from approved Spotify image hosts. Authentication remains in Spotifast.

This repository contains the controller source, icons and bilingual UI. It does not include personal Stream Deck profiles, Spotify credentials, local logs or machine-specific settings.

Repository / Dépôt : [NoLife141-Teams/spotifast-streamdeck](https://github.com/NoLife141-Teams/spotifast-streamdeck).

## License / Licence

Copyright (c) 2026 NoLife141-Teams.

Ce projet est distribué sous la [licence MIT](LICENSE). La licence du projet et les avis de licence des dépendances sont inclus dans le paquet.

This project is distributed under the [MIT license](LICENSE). The project license and dependency license notices are included in the installer.

Release a new version from its own verified tag; build, test, validate and pack that checkout before uploading the installer. Never replace an older tag to include later fixes.

Pour publier une version, compiler, tester, valider et empaqueter le checkout du nouveau tag. La commande suivante vérifie le tag, les versions, la licence MIT et l’absence de modifications locales avant publication; la CI l’exécute aussi pour les tags de version.

Before publishing, verify the release tag, matching versions, MIT license and clean checkout. CI also runs this check for version tags:

```sh
npm run release:check -- v0.2.3
```
