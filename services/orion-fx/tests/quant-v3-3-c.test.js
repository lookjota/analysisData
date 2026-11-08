import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStoredJson } from '../market-data/capital-history.js';
import { assessReadiness } from '../optimization/readiness.js';
import { runResearch } from '../cli/research.js';
const path = fileURLToPath(new URL('../data/capital-demo/eurusd-h1-20261026-31.json', import.meta.url));
// Optional local acceptance data is never required in a clean checkout.
const local = await readStoredJson(path).catch(() => null);
import { acquireHistory } from '../market-data/capital-history.js';
async function fixture() {
  return acquireHistory({ verifyContext: async () => {}, findEurUsd: async () => ({ epic: 'EURUSD', metadata: { symbol: 'EUR/USD', instrumentType: 'CURRENCIES' } }), historicalCandles: async () => ({ prices: [0, 1, 2].map(i => ({ snapshotTimeUTC: `2026-11-02T0${i}:00:00`, openPrice: { bid: 1.1, ask: 1.1002 }, highPrice: { bid: 1.101, ask: 1.1012 }, lowPrice: { bid: 1.099, ask: 1.0992 }, closePrice: { bid: 1.1, ask: 1.1002 } })) }) }, { from: '2026-11-02T00:00:00Z', to: '2026-11-02T03:00:00Z', expectedAccountId: 'offline-fixture', asOf: '2026-11-03T00:00:00Z' });
}
test('C readiness verifies envelope and rejects changed prices or hash', async () => {
  const a = await fixture();
  assert.equal(assessReadiness(a).classification, 'INSUFFICIENT_DATA');
  const b = structuredClone(a); b.candles[0].close += .01;
  assert.throws(() => assessReadiness(b), /HISTORY_INTEGRITY_MISMATCH/);
  assert.throws(() => assessReadiness({ ...a, artifactHash: '0'.repeat(64) }), /HISTORY_INTEGRITY_MISMATCH/);
});
test('C explicit smoke remains non-inferential with zero usable observations', async () => {
  const r = assessReadiness(await fixture(), { smoke: true });
  assert.equal(r.classification, 'ENGINEERING_SMOKE_TEST');
  assert.equal(r.evidenceStatus, 'INSUFFICIENT_EVIDENCE');
  assert.equal(r.partitions.train.usableObservations, 0);
  assert.equal(r.expectedIndependentTrades, null);
  assert.ok(Object.isFrozen(r.partitions.train));
});
test('C unsupported horizons and invalid planning policies fail closed', async () => {
  const a = await fixture();
  assert.throws(() => assessReadiness(a, { horizonBars: 1 }), /UNSUPPORTED_RESEARCH_HORIZON/);
  assert.throws(() => assessReadiness(a, { thresholds: { researchSessions: NaN } }), /INVALID_READINESS_THRESHOLDS/);
  assert.throws(() => assessReadiness(a, { thresholds: { arbitrary: 1 } }), /INVALID_READINESS_THRESHOLDS/);
  assert.throws(() => assessReadiness(a, { split: { trainFraction: .9, validationFraction: .2 } }), /INVALID_RESEARCH_SPLIT/);
});
test('C local real historical acceptance is insufficient, never inferred from 117 records', { skip: !local }, () => {
  assert.equal(assessReadiness(local).classification, 'INSUFFICIENT_DATA');
  assert.equal(assessReadiness(local).observations, 117);
});
test('C CLI offline smoke is deterministic, non-overwriting and never consumes holdout', async () => {
  const { saveHistory } = await import('../market-data/capital-history.js');
  const directory = await mkdtemp(join(tmpdir(), 'orion-c-'));
  const input = join(directory, 'history.json'); await saveHistory(input, await fixture());
  const lines = [], errors = [];
  const io = { output: s => lines.push(JSON.parse(s)), errorOutput: s => errors.push(s) };
  const args = ['research:evaluate', '--input', input, '--smoke', 'true', '--strategy', 'no-trade'];
  assert.equal(await runResearch(args, io), 0);
  assert.equal(await runResearch(args, io), 0);
  assert.deepEqual(lines[0], lines[1]);
  assert.equal(lines[0].holdout, 'UNCONSUMED_NO_FINAL_EVALUATION_API');
  assert.equal(lines[0].results.training[0].metrics.totalTrades, 0);
  assert.equal(lines[0].results.validation[0].metrics.totalTrades, 0);
  const out = join(directory, 'report');
  assert.equal(await runResearch([...args, '--out', out], io), 0);
  const before = await readFile(join(out, 'research.json'), 'utf8');
  assert.equal(await runResearch([...args, '--out', out], io), 1);
  assert.equal(await readFile(join(out, 'research.json'), 'utf8'), before);
  assert.equal(await runResearch(['research:evaluate', '--input', input], io), 1);
  assert.equal(errors.at(-1), 'INSUFFICIENT_DATA_USE_EXPLICIT_SMOKE');
});
