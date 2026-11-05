import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteSnapshot } from '../market-data/prices.js';
import { validateDataset, exportCsv } from '../market-data/historical.js';
import { candleExecutionPrice, protectiveFill, executionConfig } from '../execution/prices.js';
import { backtest } from '../backtesting/index.js';
import { passiveHold } from '../backtesting/passive.js';
import { enrich, htmlReport } from '../reporting/index.js';
const bar = (price = 1.1) => ({ open: price, high: price, low: price, close: price });
const rows = (observed = false) => Array.from({ length: 4 }, (_, i) => ({ instrument: 'EUR/USD', timeframe: 'H1', timestamp: `2024-01-08T0${i}:00:00.000Z`, ...bar(), source: 'deterministic-test', synthetic: true,
  ...(observed ? { quoteBars: { bid: bar(1.0999), ask: bar(1.1001) } } : {}) }));
const strategy = side => ({ id: 'test-only', signal: () => ({ action: 'target', side, stopDistance: .01, takeDistance: .02 }) });

test('B1 snapshot validates contemporaneous sides, strict schema, freshness and instrument', () => {
  const q = { instrument: 'EUR/USD', timestamp: rows()[0].timestamp, bid: 1.0999, ask: 1.1001, source: 'fixture' };
  const result = quoteSnapshot(q); assert.equal(result.mid, 1.1); assert.equal(result.assumedSpread, null);
  assert.equal(result.priceBasis, 'OBSERVED_BID_ASK');
  for (const patch of [{ bid: 2 }, { ask: 0 }, { bid: NaN }, { ask: Infinity }, { timestamp: 'bad' }, { instrument: 'GBP/USD' }, { surprise: true }, { ask: undefined }]) assert.throws(() => quoteSnapshot({ ...q, ...patch }));
  assert.throws(() => quoteSnapshot(q, { asOf: rows()[1].timestamp, maxAgeMs: 1000 }), /STALE/);
  assert.throws(() => quoteSnapshot(q, { asOf: '2024-01-07T23:00:00Z' }), /TIME/);
});

test('B1 aggregated extrema are independent; quote hash changes and CSV cannot silently drop quotes', () => {
  const data = rows(true); data[0].quoteBars.bid = { open: 1.0999, close: 1.0999, high: 1.2, low: 1 };
  assert.doesNotThrow(() => validateDataset(data)); // high bid > low ask is allowed.
  const hash = validateDataset(data).contentHash;
  data[0].quoteBars.ask.high = 1.3; assert.notEqual(validateDataset(data).contentHash, hash);
  data[0].quoteBars.bid.open = 1.11; assert.throws(() => validateDataset(data), /CROSSED/);
  assert.throws(() => exportCsv(rows(true)), /JSON/);
  assert.throws(() => validateDataset([{ ...rows()[0], x: 1 }], { strict: true }), /UNKNOWN/);
  assert.throws(() => validateDataset([{ ...rows()[0], timeframe: 'M1' }]));
});

test('B2 independent unchanged-price long/short oracle: spread/slippage once and both commissions', () => {
  for (const observed of [false, true]) for (const side of [1, -1]) {
    const r = backtest(rows(observed), { strategy: strategy(side), costs: { ...(observed ? {} : { spreadPips: 2 }), slippagePips: 1, commissionPerUnit: .00001 } });
    const t = r.trades[0]; assert.equal(r.trades.length, 1);
    assert.ok(Math.abs(t.entry - (side === 1 ? 1.1002 : 1.0998)) < 1e-14);
    assert.ok(Math.abs(t.exit - (side === 1 ? 1.0998 : 1.1002)) < 1e-14);
    // Decimal reference independent of engine pricing/PnL helpers.
    const expected = -BigInt(t.units) * 42000n;
    assert.equal(t.netPnlUsd8, String(expected));
    assert.equal(r.equityCurve.at(-1).exactUsd8.cash, String(100000000000n + expected));
    assert.ok(Date.parse(r.orders[0].timestamp) >= Date.parse(r.orders[0].signalAvailableAt));
    assert.equal(r.fills[0].executionMode, observed ? 'OBSERVED_BID_ASK' : 'ASSUMED_SPREAD');
    assert.equal(r.fills[0].slippageCostUsd, t.units / 10000);
  }
});

test('B2 incompatible price assumptions reject, missing observed quotes reject', () => {
  assert.throws(() => backtest(rows(), { executionMode: 'MID_ONLY_REFERENCE' }), /NON_EXECUTABLE/);
  assert.throws(() => backtest(rows(), { executionMode: 'OBSERVED_BID_ASK' }), /MISMATCH/);
  assert.throws(() => backtest(rows(true), { costs: { spreadPips: 1 } }), /ALREADY_INCLUDED/);
  const mixed = rows(true); delete mixed[2].quoteBars; assert.throws(() => backtest(mixed), /MISMATCH/);
  for (const spreadPips of [0, 500]) {
    const r = backtest(rows(), { strategy: strategy(1), costs: { spreadPips, slippagePips: 0 } });
    assert.ok(r.trades[0].netPnl <= 0);
  }
});

test('B4 stop/target, adverse/favorable gap, ambiguity and adverse slippage have independent oracles', () => {
  const costs = executionConfig({ spreadPips: 0, slippagePips: 1 });
  for (const side of [1, -1]) {
    const p = { side, stop: side === 1 ? 1.09 : 1.11, take: side === 1 ? 1.12 : 1.08 };
    const cases = side === 1 ? [
      [{ open: 1.08, low: 1.07, high: 1.1 }, 1.0799, 'stop-gap'],
      [{ open: 1.13, low: 1.1, high: 1.14 }, 1.1199, 'take-profit'],
      [{ open: 1.1, low: 1.085, high: 1.105 }, 1.0899, 'stop-loss'],
      [{ open: 1.1, low: 1.095, high: 1.125 }, 1.1199, 'take-profit'],
    ] : [
      [{ open: 1.12, low: 1.1, high: 1.13 }, 1.1201, 'stop-gap'],
      [{ open: 1.07, low: 1.06, high: 1.1 }, 1.0801, 'take-profit'],
      [{ open: 1.1, low: 1.095, high: 1.115 }, 1.1101, 'stop-loss'],
      [{ open: 1.1, low: 1.075, high: 1.105 }, 1.0801, 'take-profit'],
    ];
    for (const [c, expected, reason] of cases) {
      const fill = protectiveFill(p, c, costs); assert.ok(Math.abs(fill.price - expected) < 1e-14); assert.equal(fill.reason, reason);
      const observed = protectiveFill(p, { ...bar(), quoteBars: { bid: c, ask: c } }, executionConfig({ spreadPips: 20, slippagePips: 1 }));
      assert.deepEqual(observed, fill); // observed sides do not pay assumed spread.
    }
    const ambiguous = { open: 1.1, low: 1.07, high: 1.13 };
    assert.equal(protectiveFill(p, ambiguous, costs).reason, 'stop-loss');
    assert.throws(() => protectiveFill(p, ambiguous, costs, false, 'reject-ambiguous'), /AMBIGUOUS/);
  }
  assert.throws(() => executionConfig({ slippagePips: -1 }));
  assert.ok(candleExecutionPrice(rows(true)[0], 'open', 1, true, costs) > 1.1001);
});

test('B3 passive legacy equivalence and integrated weekend/DST provenance, one round trip', () => {
  const legacy = passiveHold(rows(), { costs: { spreadPips: 0, slippagePips: 0 } });
  assert.equal(legacy.trades.length, 1); assert.equal(legacy.trades[0].netPnlUsd8, '0'); assert.equal(legacy.trades[0].units, 909);
  const data = rows(true).slice(0, 3).map((c, i) => ({ ...c, timestamp: ['2024-03-08T21:00:00Z', '2024-03-10T21:00:00Z', '2024-03-10T22:00:00Z'][i] }));
  const r = passiveHold(data, { dataValidation: { calendarMode: 'calendar-v1' }, provenance: { acquiredAt: '2026-11-05T00:00:00Z', license: { status: 'synthetic', reference: 'fixture', redistributionAllowed: false } }, costs: { slippagePips: 1 } });
  assert.equal(r.trades.length, 1); assert.equal(r.fills.length, 2); assert.equal(r.dataset.quality.missingHours, 0);
  assert.equal(r.dataset.manifest.schemaVersion, 'orion.dataset-manifest.v2'); assert.equal(r.config.executionModel.mode, 'OBSERVED_BID_ASK');
  assert.equal(r.trades[0].netPnlUsd8, String(-40000n * BigInt(r.trades[0].units)));
  assert.ok(htmlReport(enrich(r)).includes('OBSERVED_BID_ASK'));
  assert.throws(() => passiveHold(rows().slice(0, 1)));
  const missing = rows().filter((_, i) => i !== 1); assert.throws(() => passiveHold(missing), /GAP/);
});

test('B4 fixed/minimum fees, per-side fees and swap reconcile without changing USD8 ledger', () => {
  for (const costs of [
    { commissionPerOrder: .03 }, { minimumCommission: .04 },
    { commissionPerOrder: .01, commissionPerUnit: .00001 },
    { commissionPerUnit: .000000001, minimumCommission: .00000001 },
  ]) {
    const r = passiveHold(rows(), { costs: { spreadPips: 0, slippagePips: 0, ...costs } });
    const t = r.trades[0];
    const expectedFee = Math.max(costs.minimumCommission ?? 0, (costs.commissionPerOrder ?? 0) + t.units * (costs.commissionPerUnit ?? 0));
    const feeUsd8 = BigInt(Math.round(expectedFee * 1e8));
    assert.equal(t.netPnlUsd8, String(-2n * feeUsd8));
    assert.equal(r.ledger.filter(x => x.type === 'OPEN').length, 1);
    assert.equal(r.equityCurve.at(-1).exactUsd8.cash, String(100000000000n - 2n * feeUsd8));
  }
  const data = rows().map((c, i) => ({ ...c, timestamp: new Date(Date.parse('2024-01-08T22:00:00Z') + i * 3600000).toISOString() }));
  const r = passiveHold(data, { costs: { spreadPips: 0, slippagePips: 0, swapPerUnitPerDay: .00001 } });
  assert.equal(r.trades[0].netPnlUsd8, String(-BigInt(r.trades[0].units) * 1000n));
  assert.equal(r.ledger.filter(e => e.type === 'SWAP').length, 1);
});

test('B experiment variable observed spread uses entry ask/bid and final opposite side', () => {
  const data = rows(true);
  data[1].quoteBars = { bid: bar(1.0997), ask: bar(1.1003) };
  data[3].quoteBars = { bid: bar(1.0996), ask: bar(1.1004) };
  for (const side of [1, -1]) {
    const r = backtest(data, { strategy: strategy(side), costs: { slippagePips: 0 } });
    const t = r.trades[0];
    assert.equal(t.entry, side === 1 ? 1.1003 : 1.0997);
    assert.equal(t.exit, side === 1 ? 1.0996 : 1.1004);
    assert.equal(t.netPnlUsd8, String(-70000n * BigInt(t.units)));
    assert.equal(r.fills[0].spreadCostUsd, t.units * 3 / 10000);
    assert.ok(enrich(r).warnings.includes('AGGREGATED_QUOTES_NOT_TICK_FRESHNESS'));
  }
  assert.ok(enrich(backtest(rows())).warnings.includes('HYPOTHETICAL_SPREAD'));
});

test('B passive CLI accepts calendar and provenance without network or credentials', async () => {
  const { runOffline } = await import('../cli/offline.js');
  const lines = [], prior = globalThis.fetch;
  globalThis.fetch = () => assert.fail('NETWORK_FORBIDDEN');
  try {
    const exit = await runOffline(['backtest', '--strategy', 'passive-hold-benchmark', '--count', '4', '--calendar-mode', 'calendar-v1', '--acquired-at', '2026-11-05T00:00:00Z'], { output: x => lines.push(x), errorOutput: assert.fail });
    assert.equal(exit, 0); assert.ok(lines.join('').includes('orion.dataset-manifest.v2'));
  } finally { globalThis.fetch = prior; }
});

test('B3 benchmark cost schedule applies each side once with independent oracle', () => {
  const r = passiveHold(rows(), { costs: { spreadPips: 0, slippagePips: 0 }, costSchedule: [{}, { commissionPerOrder: .01 }, {}, { commissionPerOrder: .02 }] });
  assert.equal(r.trades[0].netPnlUsd8, '-3000000');
  assert.equal(r.fills[0].commissionUsd, .01); assert.equal(r.fills[1].commissionUsd, .02);
  assert.throws(() => passiveHold(rows(), { costSchedule: [{}] }), /SCHEDULE/);
});

test('B observed intrabar protective spread is unknown, never fabricated from opening spread', () => {
  const data = rows(true); data[1].quoteBars.bid.low = 1.08;
  const r = backtest(data, { strategy: strategy(1) });
  const fill = r.fills.find(f => f.reason === 'stop-loss');
  assert.ok(fill); assert.equal(fill.spreadCostUsd, null); assert.equal(fill.spreadBasis, 'UNKNOWN_AT_PROTECTIVE_LEVEL');
});
