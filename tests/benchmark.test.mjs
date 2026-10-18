import test from 'node:test';
import assert from 'node:assert/strict';
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
  for (const options of [{ keys: 0 }, { keys: 65 }, { samples: 0 }, { state: 'unknown' }]) await assert.rejects(benchmarkCase(options), /Invalid/);
});

test('paused benchmark keeps playback position stable between samples', async () => {
  const short = await benchmarkCase({ state: 'paused', keys: 1, samples: 1 });
  const longer = await benchmarkCase({ state: 'paused', keys: 1, samples: 30 });
  assert.equal(short.commands, 1); assert.equal(longer.commands, 30);
  assert.deepEqual(short.syntheticPositions, { firstMs: 10000, lastMs: 10000 });
  assert.deepEqual(longer.syntheticPositions, short.syntheticPositions);
});
