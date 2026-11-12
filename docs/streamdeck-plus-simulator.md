# Simulateur visuel Stream Deck +

Depuis la racine du projet :

```powershell
npm ci
npm run simulator
```

Ouvrir l’adresse affichée, normalement <http://127.0.0.1:4319>.
Sur Windows, après `npm ci`, un double-clic sur **Lancer le simulateur.cmd**
démarre le serveur et ouvre l’adresse dans le navigateur par défaut.
Le serveur écoute uniquement sur la boucle locale. `Ctrl+C` l’arrête.
Pour choisir un autre port : `$env:SIMULATOR_PORT = '4320'` avant le lancement.

## Interactions

- **Molettes :** glisser vers la droite ou le haut pour tourner dans le sens
  horaire, vers la gauche ou le bas pour tourner dans le sens antihoraire.
  La roulette de la souris fonctionne aussi. Un clic simule l’appui.
- **Écran tactile :** cliquer directement dans l’une des quatre zones.
  Pour Multimedia, les icônes du bas commandent aléatoire, précédent,
  lecture/pause et suivant. Les coordonnées sont converties vers 200 × 100 px.
- **Clavier :** `1` à `4` sélectionne une molette, les flèches gauche/droite
  tournent et Espace appuie. Les champs conservent leurs raccourcis habituels.
- **Réglages :** chaque molette peut recevoir Volume ou Multimedia. Le volume
  possède un pas de 1, 5, 10 ou 25 %. Le curseur permet des événements de plusieurs crans.
- **Scénarios :** lecture normale, métadonnées longues, durée inconnue, aucun
  morceau et lecteur hors ligne. Réinitialiser restaure le lecteur et les quatre molettes.
- **Journal :** les événements envoyés et les commandes reçues du plugin
  apparaissent séparément. Effacer la vue ne modifie pas le lecteur.

## Ce que le simulateur teste

Un serveur WebSocket local joue le rôle de l’application Stream Deck. Un
processus enfant charge le vrai SDK `@elgato/streamdeck` et `src/runtime.mjs`.
Le navigateur envoie des événements du protocole Stream Deck et affiche les
réponses `setFeedback`, `setImage`, `setState`, `setTitle` et `showAlert`.
Le layout Multimedia est lu directement dans `streamdeck/multimedia.json`.
Le passage des commandes, le choix des zones tactiles et l’animation temporelle
utilisent donc le code du plugin.

Le lecteur et les pochettes sont fictifs. Le simulateur ne cherche aucun
exécutable Spotifast, ne contrôle pas Spotify et n’utilise pas de compte.
Les réponses du lecteur sont immédiates ; il ne reproduit pas la file interne
de processus CLI, les latences réseau ni toutes les erreurs de Spotifast.

Le rendu Canvas est une approximation : polices, antialiasing, couleurs,
luminosité, toucher réel et sensation des molettes restent à vérifier sur du
matériel. Le layout Volume est une représentation du layout intégré `$B1`.
Ce simulateur ne fait pas apparaître un appareil virtuel dans l’application Elgato.

## Vérifications automatisées

```powershell
node --test tests/simulator.test.mjs
```

Le test démarre un serveur sur un port libre, traverse le vrai SDK, vérifie les
rotations multiples, l’appui, les commandes tactiles, les réglages indépendants,
les scénarios et les limites de l’API, puis ferme les processus et serveurs.
Il fait aussi partie de `npm test`.
