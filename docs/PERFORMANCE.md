# Performance baseline / Mesures de référence

These are measurement tools, not a performance certification. No arbitrary timing threshold blocks CI. Existing deterministic tests protect polling backoff, overlapping snapshots, queue ordering, bounded caption shaping and duplicate image suppression.

## Repeatable synthetic baseline

Run `npm ci`, then `npm run benchmark -- baseline.json` on an unchanged checkout, before and after the feature stack. This invokes the actual runtime and caption renderer with synthetic playback and SDK transport. It never launches Spotifast, changes playback or sends telemetry. It covers playing/paused/offline with 1, 4 and 16 visible artwork keys; reports CPU time, one-core CPU percentage, RSS, refresh/render latency, simulated command-to-refresh p50/p95, output writes/bytes and event-loop lag when sampling is possible. `null` means no samples, not zero cost.

Record commit, OS, Node version, processor model, power mode, Stream Deck/Spotifast versions, warm-up and sample duration alongside local results. The JSON excludes usernames, executable paths, track titles and device identifiers. Synthetic command latency does not include the Windows CLI, network, physical button or display. RSS is process-wide and cumulative between scenarios; use separate processes when comparing memory precisely. Do not compare timings from different machines as regressions.

Each baseline scenario runs for at least one second and 20 samples so Windows CPU accounting has time to accumulate useful measurements. `samples` reports the actual iteration count. CPU percentage measures this continuous synthetic workload; it does not estimate idle CPU usage at the plugin's normal polling cadence.

## Windows process baseline

Identify the plugin's Node process in Stream Deck's process tree. Run the read-only sampler, supplying that verified PID:

`powershell -File scripts/measure-process.ps1 -ProcessId 1234 -Seconds 60 -Playback playing -ArtworkKeys 4 -Output baseline-playing-4.json`

Repeat each combination of playing/paused/offline and 1/4/16 visible artwork keys after 30 seconds of warm-up. Keep profile, text settings, artwork and machine load constant; repeat three times. No process is launched, killed or reconfigured. The report measures only the selected process, not the Stream Deck host or short-lived Spotifast CLI children. Capture those separately with Windows Performance Recorder if a whole-system estimate is needed; review recordings for private data before sharing.

## End-to-end latency and qualification

On physical Stream Deck, record button press to confirmed player state and visible feedback (video or timestamped capture), at least 30 samples per command/scenario; report p50/p95 and failures separately. Include relative/absolute volume → mute → volume, repeated seek at track boundaries, profile switching, reconnect and sleep/wake. Record CLI process launch/read and command queue wait separately if instrumented. Do not treat a synthetic transport or SDK protocol test as hardware evidence. Offline actions must fail clearly and retain bounded polling.

A baseline table must include commit, scenario, repetitions, CPU/memory, observed latency and limitations. If no device or measurement is available, write **not measured**. Do not infer hardware qualification from green tests. Select any future resource budgets only after these measurements establish a reproducible baseline.

## Français

`npm run benchmark -- baseline.json` mesure le vrai moteur avec un lecteur et un transport simulés, pour 1, 4 et 16 touches, en lecture, pause et hors ligne. Aucun appel au lecteur, aucune télémétrie. Les résultats simulés ne valident ni la latence Windows ni le matériel. Le script PowerShell mesure seulement le processus explicitement choisi. Pour chaque scénario, conserver les mêmes versions, réglages et charge machine, puis mesurer séparément le délai réel entre l'appui et l'affichage confirmé. Sans essai physique, indiquer **non mesuré**.
