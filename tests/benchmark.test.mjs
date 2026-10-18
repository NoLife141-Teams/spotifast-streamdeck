import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { benchmarkCase, distribution } from '../scripts/benchmark.mjs';
test('benchmark distributions are deterministic and empty data is not a zero latency claim', () => {
  assert.deepEqual(distribution([]), { samples: 0, p50: null, p95: null, max: null });
  assert.deepEqual(distribution([4, 1, 3, 2, NaN]), { samples: 4, p50: 2, p95: 4, max: 4 });
});
test('benchmark reports real runtime measurements while labelling synthetic transport', async () => {
  for (const state of ['playing', 'paused', 'offline']) {
    const result = await benchmarkCase({ state, keys: 4, samples: 2 });
    assert.equal(result.mode, 'synthetic-runtime-no-cli-no-hardware');
    assert.equal(result.refreshMs.samples, 2); assert.ok(result.rssPeakBytes > 0);
    assert.equal(result.commands, state === 'offline' ? 0 : 2);
    assert.equal(result.simulatedCommandToRefreshMs.samples, result.commands);
    assert.ok(result.snapshotReads >= 3); assert.ok(result.outputWrites > 0);
  }
});
test('benchmark rejects unbounded or invalid scenarios', async () => {
  for (const options of [{ keys: 0 }, { keys: 65 }, { samples: 0 }, { state: 'unknown' }, { minDurationMs: -1 }, { minDurationMs: Infinity }, { minDurationMs: 60001 }]) await assert.rejects(benchmarkCase(options), /Invalid/);
});

test('benchmark repeats its workload through the requested measurement window', async () => {
  const result = await benchmarkCase({ samples: 1, minDurationMs: 50 });
  assert.ok(result.elapsedMs >= 50);
  assert.equal(result.samples, result.refreshMs.samples);
  assert.equal(result.commands, result.samples);
  assert.equal(result.animationMs.samples, result.samples);
});

test('paused benchmark keeps playback position stable between samples', async () => {
  const short = await benchmarkCase({ state: 'paused', keys: 1, samples: 1 });
  const longer = await benchmarkCase({ state: 'paused', keys: 1, samples: 30 });
  assert.equal(short.commands, 1); assert.equal(longer.commands, 30);
  assert.deepEqual(short.syntheticPositions, { firstMs: 10000, lastMs: 10000 });
  assert.deepEqual(longer.syntheticPositions, short.syntheticPositions);
});

test('Windows process sampler reports the peak of its memory samples', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'spotifast-process-baseline-'));
  try {
    const output = path.join(directory, 'baseline.json');
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../scripts/measure-process.ps1', import.meta.url)), '-ProcessId', String(process.pid), '-Seconds', '2', '-Output', output], { windowsHide: true, timeout: 15000 });
    const report = JSON.parse((await readFile(output, 'utf8')).replace(/^\uFEFF/, ''));
    assert.ok(report.samples.length > 0);
    assert.ok(report.peakWorkingSetBytes > 0);
    assert.ok(report.peakPrivateBytes > 0);
    assert.equal(report.peakWorkingSetBytes, Math.max(...report.samples.map(sample => sample.workingSetBytes)));
    assert.equal(report.peakPrivateBytes, Math.max(...report.samples.map(sample => sample.privateBytes)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
