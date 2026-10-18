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
