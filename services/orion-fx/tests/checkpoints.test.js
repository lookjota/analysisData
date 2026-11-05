import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDataset, exportCsv, importCsv, writeExclusive } from '../market-data/historical.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { backtest } from '../backtesting/index.js';
import { assessIntent, riskConfig } from '../risk/simulation.js';
import { atr, adx, stochastic, candleRange } from '../indicators/index.js';

test('canonical historical identity survives CSV roundtrip and detects revised prices', async () => {
  const rows = syntheticCandles({ count: 30 });
  const original = validateDataset(rows);
  assert.match(original.contentHash, /^[a-f0-9]{64}$/);
  const reorderedKeys = rows.map(c => Object.fromEntries(Object.entries(c).reverse()));
  assert.equal(validateDataset(reorderedKeys).contentHash, original.contentHash);
  const revised = rows.map(c => ({ ...c })); revised[0].high += .001;
  assert.notEqual(validateDataset(revised).contentHash, original.contentHash);
  const dir = await mkdtemp(join(tmpdir(), 'orion-checkpoints-'));
  try {
    const path = join(dir, 'history.csv');
    await writeExclusive(path, exportCsv(rows));
    assert.equal((await importCsv(path)).contentHash, original.contentHash);
  } finally { await rm(dir, { recursive: true, force: true }); }
  assert.equal(backtest(rows).dataset.contentHash, original.contentHash);
  for (const options of [{ maxRows: NaN }, { maxRows: Infinity }, { maxRows: 100001 }, { sort: 'true' }]) {
    assert.throws(() => validateDataset(rows, options), /INVALID_DATASET_OPTIONS/);
  }
});

test('public risk assessment rejects invalid configuration and ambiguous state', () => {
  const intent = { side: 1, entry: 1.1, stopDistance: .001, takeDistance: .002, equity: 1000, cash: 1000, peak: 1000, dayStart: 1000 };
  assert.equal(assessIntent(intent).allowed, true);
  for (const config of [{ riskFraction: .9 }, { leverage: Infinity }, { maxPositions: 2 }, null, { toString: 1 }]) {
    assert.equal(assessIntent(intent, config).code, 'INVALID_RISK_CONFIG');
  }
  for (const override of [{ positions: -1 }, { positions: NaN }, { positions: .5 }, { validData: 'true' }, { killSwitch: 0 }]) {
    assert.equal(assessIntent({ ...intent, ...override }).code, 'INVALID_INTENT');
  }
  assert.throws(() => riskConfig({ toString: 1 }), /UNKNOWN_RISK_OPTION/);
});

test('OHLC indicators reject invalid candles and preserve short-history warmup', () => {
  for (const fn of [atr, adx, stochastic, candleRange]) {
    for (const rows of [null, [null], [{ high: 1, low: 2, close: 1.5 }], [{ high: Infinity, low: 1, close: 1 }]]) {
      assert.throws(() => fn(rows), /INVALID_OHLC_SERIES/);
    }
    assert.deepEqual(fn([]), []);
  }
  const rows = syntheticCandles({ count: 30 });
  for (const fn of [atr, adx, stochastic]) {
    assert.deepEqual(fn(rows).slice(0, 10), fn(rows.slice(0, 10)));
  }
});

test('backtest copies only documented signal fields into pending decisions', () => {
  const rows = syntheticCandles({ count: 4, regime: 'flat' });
  const result = backtest(rows, { strategy: { id: 'untrusted-metadata', signal: () => ({ action: 'target', side: 1, stopDistance: .01, takeDistance: .02, timestamp: 'forged', signalTimestamp: 'forged', metadata: { mutable: true } }) } });
  assert.equal(result.orders[0].timestamp, rows[1].timestamp);
  assert.equal(result.orders[0].signalTimestamp, rows[0].timestamp);
  assert.equal(Object.hasOwn(result.orders[0], 'metadata'), false);
});
