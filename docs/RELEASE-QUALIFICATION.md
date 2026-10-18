# Release qualification / Qualification de livraison

## Gates

The plugin remains free and MIT licensed. Existing Spotify account requirements are unchanged. No subscription, paid feature, automatic installer launch or silent update is introduced.

1. Review the eight focused draft PRs and their dependency order. Run the combined candidate on Windows x64, Node 20 (the embedded target) and Node 22 (compatibility). Record exact commit and commands/results, including dependency audit, all tests, Elgato validation, packaging and `npm run package:verify`.
2. `package:verify` checks every archived file against the tested build, rejects unsafe paths/omissions/modified bytes, extracts the actual installer to a temporary directory and runs the real-SDK protocol smoke test against those extracted bytes. It never installs the plugin or opens Stream Deck. This is not physical-device qualification.
3. Complete the hardware checklist below, or explicitly retain beta status and mark unavailable hardware **not tested**. Run the baseline and final performance scenarios on the same machine. No invented pass or latency target.
4. Obtain separate final approval before merging, changing versions, creating/pushing a tag, publishing a release, or installing/upgrading the user's plugin. These are not implied by preparing draft PRs.
5. Update package.json, package-lock.json and source manifest consistently, and commit `releases/v<version>.md` with `## English` and `## Français` sections. Explain tested hardware, unsupported conditions and limitations; remove TODO/TBD blockers. The current build requires a numeric three-component version; use GitHub prerelease status for beta releases rather than a semver suffix the manifest cannot represent.
6. An explicit `v<version>` tag invokes the release gates. Both Windows lanes must pass. Only the Node 20 lane's exact verified installer is staged; it is never rebuilt in the publication job. Checksums cover the installer and MIT LICENSE asset. The publishing job verifies them before `gh release create --verify-tag`. Existing releases are not overwritten. Publication is a GitHub prerelease by default; stable promotion requires a separate explicit decision.
7. Download the published canonical `.streamDeckPlugin` and SHA256SUMS.txt, verify their digest, then use the official installer manually when installation is approved. Do not substitute a copied build directory or a different lane's package.

## Ordinary CI and branch protection

This public repository retains Windows checks for every PR target (including stacked PRs) and pushes to main, plus explicit version tags. Other branch pushes do not duplicate PR runs. Main's existing required `check` protection remains unchanged. Private-project CI preferences are not applied to this public repository. Do not weaken protections, fabricate a passing status or bypass them. Publication is tag-only with minimal permissions; ordinary successful PR/main runs do not upload redundant binaries.

## Hardware checklist

For every result record date, exact commit/package SHA256, Windows version, Stream Deck app version/model, Spotifast version, scenario and observed result. Leave unchecked items unqualified.

- [ ] Fresh install via official installer, after approval
- [ ] Upgrade from 0.2.7 preserves old profiles, UUIDs, names and settings
- [ ] EN/FR inspector labels, language changes and long Unicode labels
- [ ] 1/4/16 artwork keys: playing, paused, offline; CPU/memory and button-to-confirmed-display latency
- [ ] Absolute volume 0/25/50/100; rapid relative → mute → absolute and Multi Action mixed playback order
- [ ] Seek ±10/configured seconds, track start/end, paused, unknown duration and track switch while queued
- [ ] Explicit restart at zero; known upstream read/write race documented
- [ ] Missing executable, timeout and malformed status show useful local diagnostics
- [ ] Copied diagnostic preview contains no personal paths, token, track metadata or device IDs
- [ ] Shortcut playlist/album/track/artist/show parsing and optional per-key labels
- [ ] Preview, elapsed/remaining/progress hot changes, pause/seek/new track/no playback; no added CLI reads
- [ ] Active-device display, explicit refresh, configured transfer, unavailable/disappeared/duplicate-name devices
- [ ] No arbitrary device transfer, including offline and profile change
- [ ] Profile switch, key removal/reappearance, unplug/replug, sleep/wake and Spotifast restart
- [ ] Stream Deck + rotate/push/touch/reconnect on actual Stream Deck + hardware (otherwise **not tested**)

## Français

Les huit PRs restent en brouillon jusqu'à revue. Les tests Windows Node 20/22 et la vérification du paquet sont distincts des essais sur matériel. L'archive officielle testée doit être exactement celle publiée, avec ses empreintes SHA-256 et la licence MIT. Le workflow ne publie que sur un tag de version explicite et attend les deux matrices. Aucun tag, fusion, publication ou remplacement de l'installation actuelle sans l'accord final distinct. Sans matériel accessible, conserver la mention bêta et **non testé**, notamment pour Stream Deck +.
