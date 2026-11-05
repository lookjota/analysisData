import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeCandle, validateDataset, exportCsv, importCsv, timestamp, writeExclusive } from '../market-data/historical.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
test('candles: UTC, provenance, OHLC, sorting, duplicates and historical cutoff', () => {
  const rows = syntheticCandles({ count: 10 });
  assert.equal(validateDataset(rows).synthetic, true);
  assert.equal(timestamp('2024-01-08T01:00:00+01:00'), rows[0].timestamp);
  for (const value of ['2024-01-08T00:00:00', '2024-02-30T00:00:00Z']) assert.throws(() => timestamp(value));
  for (const override of [{ open: 0 }, { high: 1 }, { low: 2 }, { volume: -1 }, { source: '' }, { synthetic: undefined }, { timeframe: 'M1' }, { bid: 1 }, { timestamp: '2024-01-08T00:30:00Z' }]) assert.throws(() => normalizeCandle({ ...rows[0], ...override }));
  assert.throws(() => validateDataset([rows[0], rows[0]]), /DUPLICATE/);
  assert.throws(() => validateDataset([...rows].reverse()), /UNORDERED/);
  assert.deepEqual(validateDataset([...rows].reverse(), { sort: true }).candles, validateDataset(rows).candles);
  assert.throws(() => validateDataset(rows, { asOf: rows.at(-1).timestamp }), /INCOMPLETE/);
  assert.throws(() => validateDataset(syntheticCandles({ regime: 'invalid' })));
});
test('gaps distinguish approximate weekend closure from missing session hours', () => {
  const c = syntheticCandles({ count: 2 });
  const gap = validateDataset([c[0], { ...c[1], timestamp: '2024-01-08T04:00:00Z' }]);
  assert.equal(gap.warnings[0].missingHours, 3);
  const weekend = validateDataset([{ ...c[0], timestamp: '2024-01-05T21:00:00Z' }, { ...c[1], timestamp: '2024-01-07T22:00:00Z' }]);
  assert.equal(weekend.warnings[0].code, 'WEEKEND_CLOSURE');
});
test('streaming CSV roundtrip, malformed input, symlink and overwrite rejection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orion-data-'));
  try {
    const path = join(dir, 'candles.csv'), rows = syntheticCandles({ count: 5 });
    await writeExclusive(path, exportCsv(rows));
    assert.deepEqual((await importCsv(path)).candles, rows.map(normalizeCandle));
    await assert.rejects(writeExclusive(path, 'overwrite'));
    const link = join(dir, 'link.csv'); await symlink(path, link);
    await assert.rejects(importCsv(link));
    for (const bad of ['a,b\n1,2', exportCsv(rows).replace('1.1', ''), exportCsv(rows).replace('EUR/USD', '"EUR/USD'), exportCsv(rows).replace('true', 'maybe')]) {
      await writeFile(join(dir, 'bad.csv'), bad); await assert.rejects(importCsv(join(dir, 'bad.csv')));
    }
  } finally { await rm(dir, { recursive: true }); }
});
