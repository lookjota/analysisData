import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { validateDataset, exportCsv, importCsv, writeExclusive } from '../market-data/historical.js';
import { marketSession } from '../calendar/forex.js';
import { datasetManifest, verifyManifest } from '../market-data/manifest.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';
import { enrich, htmlReport } from '../reporting/index.js';
import { runOffline } from '../cli/offline.js';
const options = { calendarMode: 'calendar-v1', calendar: { provider: 'DECLARED_RESEARCH' } };
const rowsAt = times => times.map(timestamp => ({ ...syntheticCandles({ count: 2 })[0], timestamp }));
test('V3.2 calendar classifies summer weekend without fictional candles; legacy hash preserved', () => {
  const rows = rowsAt(['2024-03-15T20:00:00Z', '2024-03-17T21:00:00Z']);
  const d = validateDataset(rows, options);
  assert.equal(d.quality.findings[0].classification, 'EXPECTED_MARKET_CLOSURE');
  assert.equal(d.quality.missingHours, 0);
  assert.equal(d.candles.length, 2);
  assert.equal(d.contentHash, validateDataset(rows).contentHash);
  assert.equal(d.temporal.timestampConvention, 'bar-open');
});
test('V3.2 missing, holiday, exception, unknown and strict policy are distinct', () => {
  const rows = rowsAt(['2024-12-25T10:00:00Z', '2024-12-25T12:00:00Z']);
  assert.equal(validateDataset(rows, options).quality.findings[0].classification, 'MISSING_DATA');
  for (const [calendar, expected] of [[{ closures: ['2024-12-25'] }, 'DECLARED_HOLIDAY'], [{ exceptions: [{ start: '2024-12-25T11:00:00Z', end: '2024-12-25T12:00:00Z', state: 'CLOSED' }] }, 'DECLARED_SCHEDULE_EXCEPTION']]) {
    assert.equal(validateDataset(rows, { ...options, calendar }).quality.findings[0].classification, expected);
  }
  const unknown = validateDataset(rows, { ...options, calendar: null });
  assert.equal(unknown.quality.findings[0].classification, 'UNKNOWN_GAP');
  assert.throws(() => validateDataset(rows, { ...options, gapPolicy: 'reject' }), /DATA_QUALITY/);
  assert.throws(() => validateDataset([rows[0], rows[0]], options), /DUPLICATE/);
  assert.throws(() => validateDataset([...rows].reverse(), options), /UNORDERED/);
  assert.throws(() => validateDataset([{ ...rows[0], timestamp: 'invalid' }], options));
});
test('V3.2 configured weekly schedule, US/UK DST divergence and invalid configuration', () => {
  assert.equal(marketSession('2024-03-17T21:00:00Z', { weeklyOpenHour: 18 }).status, 'WEEKLY_CLOSED');
  assert.equal(marketSession('2024-03-15T20:00:00Z', { weeklyCloseHour: 16 }).status, 'WEEKLY_CLOSED');
  assert.deepEqual(marketSession('2024-03-18T16:00:00Z').sessions, ['LONDON', 'NEW_YORK']);
  assert.deepEqual(marketSession('2024-04-08T16:00:00Z').sessions, ['NEW_YORK']);
  assert.equal(marketSession('2024-11-03T22:00:00Z').status, 'OPEN');
  assert.throws(() => marketSession('2024-01-08T00:00:00Z', { weeklyOpenHour: 24 }));
});
test('V3.2 local CSV → calendar → manifest → backtest → report and CLI stay offline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orion-v32-'));
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
  try {
    const file = join(dir, 'input.csv');
    await writeExclusive(file, exportCsv(syntheticCandles({ count: 8 })));
    const d = await importCsv(file, options);
    const provenance = { acquiredAt: '2026-11-05T00:00:00Z', license: { status: 'synthetic', reference: 'local-fixture', redistributionAllowed: false } };
    const report = enrich(backtest(d.candles, { strategy: createStrategy('no-trade'), dataValidation: options, provenance }));
    assert.equal(report.dataset.manifest.canonicalContentHash, d.contentHash);
    assert.equal(report.dataset.manifest.schemaVersion, 'orion.dataset-manifest.v2');
    assert.equal(verifyManifest(d.candles, report.dataset.manifest), true);
    assert.throws(() => verifyManifest(d.candles, { ...report.dataset.manifest, acquiredAt: '2025-01-01T00:00:00Z' }), /INTEGRITY/);
    const changed = d.candles.map(c => ({ ...c })); changed[0].high += .01;
    assert.throws(() => verifyManifest(changed, report.dataset.manifest), /INTEGRITY/);
    assert.match(htmlReport(report), /orion.dataset-manifest.v2/);
    const lines = [], errors = [];
    assert.equal(await runOffline(['backtest', '--input', file, '--strategy', 'no-trade', '--calendar-mode', 'calendar-v1', '--acquired-at', provenance.acquiredAt], { output: x => lines.push(x), errorOutput: x => errors.push(x) }), 0, errors.join());
    assert.equal(JSON.parse(lines[0]).dataset.manifest.schemaVersion, 'orion.dataset-manifest.v2');
  } finally { globalThis.fetch = previous; await rm(dir, { recursive: true }); }
});

test('V3.2 quality gate reaches backtest, errors are classified and replay uses calendar', async () => {
  const rows = rowsAt(['2024-01-08T00:00:00Z', '2024-01-08T02:00:00Z']);
  assert.throws(() => backtest(rows, { dataValidation: options }), /SESSION_GAP_REQUIRES_ACKNOWLEDGEMENT/);
  assert.throws(() => backtest(rows, { dataValidation: { ...options, calendar: null } }), /SESSION_GAP_REQUIRES_ACKNOWLEDGEMENT/);
  for (const [bad, classification] of [[[rows[0], rows[0]], 'DUPLICATE_CANDLE'], [[...rows].reverse(), 'OUT_OF_ORDER'], [[{ ...rows[0], timestamp: 'invalid' }], 'INVALID_TIMESTAMP']]) {
    assert.throws(() => validateDataset(bad, options), e => e.classification === classification);
  }
  assert.throws(() => validateDataset(rows, { ...options, calendar: { secret: 'not-allowed' } }), /INVALID_CALENDAR_CONFIG/);
  const { replay } = await import('../paper/replay.js');
  const weekend = rowsAt(['2024-03-15T20:00:00Z', '2024-03-17T21:00:00Z']);
  const config = { strategy: createStrategy('no-trade'), dataValidation: options };
  const batch = backtest(weekend, config), replayed = await replay(weekend, config);
  assert.deepEqual(replayed.dataset, batch.dataset);
  assert.deepEqual(replayed.equityCurve, batch.equityCurve);
  assert.deepEqual(batch, backtest(weekend, config));
});

test('V3.2 unknown calendar manifest remains unknown and v1 cannot omit custom schedule', () => {
  const rows = syntheticCandles({ count: 8 });
  const metadata = { acquiredAt: '2026-11-05T00:00:00Z', license: { status: 'synthetic', reference: 'fixture', redistributionAllowed: false } };
  const m = datasetManifest(rows, { ...metadata, calendarMode: 'calendar-v1', calendar: null });
  assert.equal(m.calendar, null);
  assert.equal(m.quality.status, 'WARNING');
  assert.equal(m.quality.recordsDuringClosure, null);
  assert.equal(verifyManifest(rows, m), true);
  assert.throws(() => datasetManifest(rows, { ...metadata, calendar: { weeklyCloseHour: 16 } }), /EXPLICIT_MODE/);
});
