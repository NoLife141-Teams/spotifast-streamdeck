# Next Spotifast Stream Deck release — draft beta notes

<!-- release-blocker: choose version and replace this draft with releases/v<version>.md only after review and qualification -->

## English

Planned: repeatable performance measurements; absolute-volume buttons and ordered Multi Actions; guarded seek/restart; local redacted diagnostics; named music shortcuts with accurate content types; live appearance preview and optional elapsed/progress; explicit playback-device selection; reproducible installer verification and tag-only release automation.

Existing action IDs and defaults remain compatible. The plugin remains free and MIT licensed. Install manually using the official `.streamDeckPlugin` after approval. No telemetry or automatic installation.

Validation: TODO — record exact Windows Node 20/22 results, installer SHA256, and hardware evidence. Real hardware, whole-system resource usage and Stream Deck + controls must remain marked untested until measured. Upstream lacks atomic seek-by-track-ID, so an external transition between final read and seek cannot be fully excluded.

## Français

Prévu : mesures de performance reproductibles ; volume absolu et ordre des Multi Actions ; avance/retour et redémarrage protégés ; diagnostics locaux nettoyés ; noms de raccourcis et types de liens exacts ; aperçu et temps écoulé/progression ; sélection explicite de l'appareil de lecture ; vérification de l'installateur et publication sur tag seulement.

Les identifiants et les réglages par défaut restent compatibles. Le plugin reste gratuit sous licence MIT. Installation manuelle du fichier officiel `.streamDeckPlugin` après accord, sans télémétrie ni remplacement automatique.

Validation : TODO — inscrire les résultats exacts Windows Node 20/22, l'empreinte de l'installateur et les essais physiques. Le matériel, les ressources système et Stream Deck + restent non testés sans mesure. L'API amont ne permet pas un déplacement atomique lié à l'identifiant du morceau : une transition externe entre la dernière lecture et la commande reste possible.
