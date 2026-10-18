import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { createRuntime } from '../src/runtime.mjs';
import { UUID } from '../src/core.mjs';

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = fraction => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  return { samples: sorted.length, p50: at(.5), p95: at(.95), max: sorted.at(-1) ?? null };
}

// Real runtime and caption renderer; fake transport/player. Never invokes Spotifast.
export async function benchmarkCase({ state = 'playing', keys = 1, samples = 20, minDurationMs = 0 } = {}) {
  if (!['playing', 'paused', 'offline'].includes(state) || !Number.isInteger(keys) || keys < 1 || keys > 64 || !Number.isInteger(samples) || samples < 1 || samples > 10000 || !Number.isFinite(minDurationMs) || minDurationMs < 0 || minDurationMs > 60000) throw new Error('Invalid benchmark case');
  let clock = 0, reads = 0, writes = 0, bytes = 0, commands = 0, firstPositionMs, lastPositionMs;
  const callbacks = {}, noop = () => {}, timers = { setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop };
  const client = { configure: noop, async run() { commands++; }, async snapshot() {
    reads++;
    if (state === 'offline') throw new Error('Synthetic offline');
    lastPositionMs = state === 'playing' ? 10000 + clock : 10000; firstPositionMs ??= lastPositionMs;
    return { state, title: 'Benchmark scrolling title with several words', artists: 'Synthetic artist', album: '', position: state === 'playing' ? 10000 + clock : 10000, duration: 240000, volume: 50, saved: 'no', shuffle: false, repeat: 'off', artUrl: '' };
  } };
  const sdk = { info: { application: { language: 'en' } }, connect: async () => {}, logger: { info: noop, warn: noop, error: error => { throw error; } }, actions: {},
    settings: { getGlobalSettings: async () => ({}), onDidReceiveSettings: noop, onDidReceiveGlobalSettings: noop },
    ui: { onDidAppear: noop, onDidDisappear: noop, onSendToPlugin: noop, sendToPropertyInspector: async () => {} }, system: { onSystemDidWakeUp: noop } };
  for (const event of ['onWillAppear', 'onWillDisappear', 'onKeyDown', 'onDialRotate', 'onDialDown', 'onTouchTap']) sdk.actions[event] = callback => { callbacks[event] = callback; };
  const runtime = createRuntime(sdk, { client, timers, now: () => clock, artwork: { async get() {} } });
  const output = async value => { writes++; bytes += Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)); };
  await runtime.start();
  for (let index = 0; index < keys; index++) {
    const action = { id: String(index), manifestId: UUID + '.nowplaying', isKey: () => true, setImage: output, setTitle: output, setState: output, showAlert: async () => {} };
    runtime.visible.set(action.id, { action, settings: {} });
  }
  await runtime.refresh(); // Warm fonts and caches before measuring.
  const refreshMs = [], commandToRefreshMs = [], animationMs = [];
  const cpuStart = process.cpuUsage(), start = performance.now(), rssStart = process.memoryUsage().rss;
  let rssPeak = rssStart;
  const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
  try {
    for (let index = 0; index < samples || performance.now() - start < minDurationMs; index++) {
      clock += 100;
      let before = performance.now(); await runtime.refresh(); refreshMs.push(performance.now() - before);
      before = performance.now(); await runtime.animate(); animationMs.push(performance.now() - before);
      if (state !== 'offline') {
        before = performance.now();
        await runtime.perform({ action: runtime.visible.values().next().value.action }, ['volume-up', '1']);
        await runtime.refresh(); commandToRefreshMs.push(performance.now() - before);
      }
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
      await new Promise(resolve => setImmediate(resolve));
    }
  } finally { runtime.stop(); delay.disable(); }
  const elapsedMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
  return { mode: 'synthetic-runtime-no-cli-no-hardware', state, keys, samples: refreshMs.length, elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1000, cpuPercentOneCore: (cpu.user + cpu.system) / 10 / elapsedMs,
    rssStartBytes: rssStart, rssPeakBytes: rssPeak, refreshMs: distribution(refreshMs), animationMs: distribution(animationMs),
    simulatedCommandToRefreshMs: distribution(commandToRefreshMs), eventLoopP95Ms: delay.count ? delay.percentile(95) / 1e6 : null,
    syntheticPositions: { firstMs: firstPositionMs ?? null, lastMs: lastPositionMs ?? null }, snapshotReads: reads, commands, outputWrites: writes, outputBytes: bytes };
}

export async function runBaseline({ samples = 20, minDurationMs = 1000 } = {}) {
  const results = [];
  // Windows process CPU counters have a coarser resolution than a few refreshes.
  for (const state of ['playing', 'paused', 'offline']) for (const keys of [1, 4, 16]) results.push(await benchmarkCase({ state, keys, samples, minDurationMs }));
  return { schemaVersion: 1, measuredAt: new Date().toISOString(), environment: { platform: process.platform, arch: process.arch, node: process.version, logicalCpus: cpus().length }, limitation: 'Synthetic player and SDK transport; excludes process start, network, real Stream Deck latency and hardware resource usage. No performance pass/fail thresholds.', results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = JSON.stringify(await runBaseline(), null, 2) + '\n';
  if (process.argv[2]) await writeFile(process.argv[2], result); else process.stdout.write(result);
}
