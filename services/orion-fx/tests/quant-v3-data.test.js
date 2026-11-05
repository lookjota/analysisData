import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSession } from '../calendar/forex.js';
import { datasetManifest, verifyManifest, writeManifest } from '../market-data/manifest.js';
import { validateDataset } from '../market-data/historical.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('V3 weekly NY17 calendar shifts with US DST, sessions respect UK/US mismatch weeks', () => {
  assert.equal(marketSession('2024-03-08T21:00:00Z').status, 'OPEN');
  assert.equal(marketSession('2024-03-08T22:00:00Z').status, 'WEEKLY_CLOSED');
  assert.equal(marketSession('2024-03-15T21:00:00Z').status, 'WEEKLY_CLOSED');
  assert.equal(marketSession('2024-03-10T20:00:00Z').status, 'WEEKLY_CLOSED');
  assert.equal(marketSession('2024-03-10T21:00:00Z').status, 'OPEN');
  assert.deepEqual(marketSession('2024-03-18T16:00:00Z').sessions, ['LONDON', 'NEW_YORK']);
  assert.deepEqual(marketSession('2024-04-08T16:00:00Z').sessions, ['NEW_YORK']);
  assert.deepEqual(marketSession('2024-10-28T16:00:00Z').sessions, ['LONDON', 'NEW_YORK']);
  assert.equal(marketSession('2024-11-03T21:00:00Z').status, 'WEEKLY_CLOSED');
  assert.equal(marketSession('2024-11-03T22:00:00Z').status, 'OPEN');
});
test('V3 declared holidays and reduced liquidity are explicit, no automatic holiday inference', () => {
  const t = '2024-12-25T12:00:00Z';
  assert.equal(marketSession(t).status, 'OPEN');
  assert.equal(marketSession(t, { closures: ['2024-12-25'] }).status, 'DECLARED_HOLIDAY');
  assert.equal(marketSession(t, { reducedDates: ['2024-12-25'] }).status, 'REDUCED_LIQUIDITY');
  assert.throws(() => marketSession(t, { closures: ['2024-02-30'] }));
});
test('V3 manifest preserves existing canonical hash, declares gaps, rejects content and metadata tampering', async () => {
  const rows = syntheticCandles({ count: 8 });
  const options = { acquiredAt: '2026-11-05T00:00:00Z', license: { status: 'synthetic', reference: 'local-generator-v1', redistributionAllowed: false } };
  const m = datasetManifest(rows, options);
  assert.equal(m.canonicalContentHash, validateDataset(rows).contentHash);
  assert.equal(m.synthetic, true); assert.equal(m.quality.missingHours, 0);
  assert.ok(Object.isFrozen(m.quality.warnings));
  assert.equal(verifyManifest(rows, JSON.parse(JSON.stringify(m))), true);
  const changed = rows.map(c => ({ ...c })); changed[0].high += .01;
  assert.throws(() => verifyManifest(changed, m), /INTEGRITY/);
  assert.throws(() => verifyManifest(rows, { ...m, rawFileHash: 'a'.repeat(64) }), /INTEGRITY/);
  const gap = datasetManifest(rows.filter((_, i) => i !== 3), options);
  assert.equal(gap.quality.missingHours, 1);
  const dir = await mkdtemp(join(tmpdir(), 'orion-v3-'));
  try {
    const file = join(dir, 'manifest.json'); await writeManifest(file, m);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), m);
    await assert.rejects(writeManifest(file, m), /EEXIST/);
  } finally { await rm(dir, { recursive: true }); }
});
test('V3 manifest CLI requires explicit acquisition timestamp and stays offline', async () => {
  const { runOffline } = await import('../cli/offline.js');
  const lines = [], errors = [];
  const io = { output: x => lines.push(x), errorOutput: x => errors.push(x) };
  const prior = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
  try {
    assert.equal(await runOffline(['data:manifest', '--count', '8', '--acquired-at', '2026-11-05T00:00:00Z'], io), 0);
    assert.equal(JSON.parse(lines[0]).license.status, 'synthetic');
    assert.equal(await runOffline(['data:manifest', '--count', '8'], io), 1);
    assert.equal(errors.length, 1);
  } finally { globalThis.fetch = prior; }
});
