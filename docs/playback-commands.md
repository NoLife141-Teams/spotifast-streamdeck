# Additional playback commands / Commandes de lecture

## Set volume / Définir le volume

Add **Set volume**, choose 0–100% in its settings, then press the key. The new
key defaults to 50%; existing volume buttons and dial settings are unchanged.
The title shows the configured target. 0 means silence. The command is
`spotifast volume <percent>`, verified in [Spotifast v0.13.3's official CLI](https://github.com/crmne/spotifast/blob/v0.13.3/src/entrypoint.rs).

Ajoute **Définir le volume**, choisis 0–100 % et appuie sur la touche. La nouvelle
touche utilise 50 % par défaut; les boutons et réglages existants ne changent
pas. Le titre indique le volume cible. 0 coupe le son.

All Multi Action commands are FIFO barriers. A later playback command cannot
jump over a volume or mute step; macro inputs are never combined. Interactive
rotations still combine only adjacent same-direction changes, without crossing
mute, absolute volume, or a macro. Interactive transport retains its existing
priority outside macro barriers. Busy/expired commands report an error rather
than being replayed later.

Les commandes des multi-actions conservent leur ordre, y compris le volume,
la sourdine et la lecture. Elles ne sont jamais regroupées. Les rotations hors
multi-action peuvent encore être regroupées dans le même sens, sans franchir
une autre commande. Une commande expirée ou une file pleine produit une erreur.

These changes are covered by simulated command/runtime tests. They still need
Windows and physical Stream Deck qualification, including rapid macro presses.

## Seek and restart / Avance, retour et redémarrage

**Seek backward** and **Seek forward** default to 10 seconds, configurable from
1 to 3600 whole seconds per key. **Restart track** seeks to 0:00. Paused tracks
remain paused. Targets are clamped to the track duration and rounded down to
whole seconds because upstream `seek-to` accepts seconds, not milliseconds.

**Reculer** et **Avancer** utilisent 10 secondes par défaut, réglables de 1 à
3600 secondes par touche. **Recommencer le morceau** revient à 0:00. Un morceau
en pause reste en pause. Les positions sont bornées à la durée et arrondies à
la seconde inférieure, conformément à la commande amont.

The plugin requires a known title, position and positive duration sampled no
more than five seconds ago. It reads the track again inside the serialized
command queue immediately before issuing `seek-to`. It refuses unknown timing,
changed track metadata/duration/device, an intervening local next/previous/link
command, expired work, configuration changes and removed keys. No speculative
seek is sent on error. Macro seeks use the same FIFO barriers as other commands.

Compatibility was checked against **Spotifast v0.13.3**, specifically the
[CLI argument definitions](https://github.com/crmne/spotifast/blob/v0.13.3/src/entrypoint.rs)
and [control protocol](https://github.com/crmne/spotifast/blob/v0.13.3/src/single_instance.rs).
Earlier versions and later protocol changes are not qualified by this check.
An unsupported command reports failure; it never falls back to Previous,
Next, launching another app or a guessed position.

Important upstream limit: `now-playing --raw` exposes track metadata but no
stable track ID, and `seek-to` has no atomic "only if this track is still
playing" argument. An external track change between the final read and write,
or two tracks with identical metadata, cannot be completely ruled out.
CLI acceptance also does not confirm that remote playback has applied the
change. These controls are best-effort guarded, not an atomic track-safe API.

Limite amont : le statut ne fournit pas d’identifiant stable du morceau et la
commande ne permet pas de conditionner atomiquement le saut au morceau attendu.
Un changement externe entre la vérification et l’écriture, ou des morceaux aux
métadonnées identiques, reste possible. Une commande acceptée ne confirme pas
son application sur un appareil distant. La protection réduit les commandes
obsolètes sans pouvoir supprimer cette course côté Spotifast.
