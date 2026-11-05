import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualPortfolio } from '../portfolio/virtual.js';
import { usdUnits, usdNumber, forexPnl } from '../financial/decimal.js';
import { passiveHold } from '../backtesting/passive.js';
import { backtest } from '../backtesting/index.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { createStrategy } from '../strategies/research.js';
import { analyze } from '../analytics/index.js';
const time = '2024-01-08T00:00:00.000Z';
const open = (p, side = 1) => p.open({ side, entry: 1.1, units: 1000, stopDistance: .01, takeDistance: .02, timestamp: time, margin: 110, commission: .01 });
test('decimal reference: binary cancellation, half-away rounding, sign symmetry and overflow', () => {
  assert.notEqual(1000 * (.3 - .1), 200); // Reproduces pre-fix IEEE cancellation.
  assert.equal(forexPnl(1, 1000, .1, .3), 20000000000n);
  assert.equal(forexPnl(-1, 1000, .1, .3), -20000000000n);
  assert.equal(usdUnits(.000000005), 1n); assert.equal(usdUnits(-.000000005), -1n);
  assert.equal(usdUnits(1e-9), 0n); assert.equal(usdUnits(1e3), 100000000000n);
  for (const x of [NaN, Infinity, -Infinity, 1e9]) assert.throws(() => usdUnits(x));
  assert.throws(() => usdNumber(9007199254740992n), /OVERFLOW/);
});
test('ledger independent long/short references include each fee exactly once', () => {
  for (const side of [1, -1]) {
    const p = new VirtualPortfolio(1000); open(p, side); p.chargeSwap(.03, time);
    const t = p.close(1.101, time, 'test', .02);
    assert.equal(t.grossPnl, side); assert.equal(t.netPnl, side - .06);
    assert.equal(p.cash, 1000 + side - .06);
    assert.ok(Object.isFrozen(t)); assert.ok(p.ledger.every(Object.isFrozen));
    assert.throws(() => { t.netPnl = 100; }, TypeError);
    assert.equal(p.snapshot(1.1, time).equity, p.cash);
    assert.throws(() => p.close(1.1, time, 'duplicate', 0));
  }
});
test('deterministic property sweep reconciles 400 roundtrips without capital creation', () => {
  const p = new VirtualPortfolio(1000); let expected = 100000000000n;
  for (let i = 0; i < 400; i++) {
    const side = i % 2 ? -1 : 1, ticks = i % 11 - 5;
    open(p, side); p.chargeSwap(.03, time);
    p.close(1.1 + ticks / 10000, time, 'property', .02);
    // Each pip on 1000 EUR units = USD 0.10, fees = USD 0.06.
    expected += BigInt(side * ticks) * 10000000n - 6000000n;
    assert.equal(usdUnits(p.cash), expected);
    p.snapshot(1.1, time);
  }
  assert.equal(p.ledger.reduce((s, e) => s + BigInt(e.amountUsd8), 100000000000n), expected);
});
test('invalid ledger operations and corrupt accounting fail closed without partial booking', () => {
  const p = new VirtualPortfolio(1000);
  for (const commission of [NaN, Infinity, -1]) {
    assert.throws(() => p.open({ side: 1, entry: 1.1, units: 10, stopDistance: .01, takeDistance: .02, margin: 1, timestamp: time, commission }));
    assert.equal(p.cash, 1000); assert.equal(p.position, null);
  }
  open(p); const before = p.cash;
  assert.throws(() => p.chargeSwap(Infinity, time)); assert.equal(p.cash, before);
  assert.throws(() => p.close(1.1, time, 'bad', NaN)); assert.ok(p.position);
  p.ledger.pop(); assert.equal(p.snapshot(1.1, time).cash, before); // Returned collection is defensive.
});
test('passive benchmark has one entry and exit, explicit semantics, independent price PnL', () => {
  const rows = syntheticCandles({ count: 720 });
  const passive = passiveHold(rows), managed = backtest(rows, { strategy: createStrategy('risk-managed-hold') });
  assert.equal(passive.trades.length, 1); assert.ok(managed.trades.length > 1);
  assert.equal(passive.trades[0].stop, null); assert.equal(passive.config.risk, null);
  assert.equal(passive.trades[0].openedAt, rows[1].timestamp);
  assert.equal(passive.trades[0].closedAt, passive.equityCurve.at(-1).timestamp);
  assert.equal(passive.trades[0].units, 909);
  assert.equal(passive.fills.length, 2);
});
test('breakout executes after deterministic rupture, future edits cannot change past decisions', () => {
  const rows = syntheticCandles({ count: 240, regime: 'flat' });
  for (let i = 210; i < rows.length; i++) Object.assign(rows[i], { open: 1.12, close: 1.12, high: 1.1201, low: 1.1199 });
  Object.assign(rows[210], { open: 1.1, low: 1.0999 });
  const a = backtest(rows, { strategy: createStrategy('breakout') });
  assert.ok(a.trades.length); assert.equal(a.trades[0].openedAt, rows[211].timestamp);
  const revised = rows.map((c, i) => i < 220 ? c : { ...c, open: 1.2, high: 1.21, low: 1.19, close: 1.2 });
  const b = backtest(revised, { strategy: createStrategy('breakout') });
  assert.deepEqual(a.orders.filter(x => x.timestamp < rows[220].timestamp), b.orders.filter(x => x.timestamp < rows[220].timestamp));
  assert.deepEqual(a.equityCurve.slice(0, 220), b.equityCurve.slice(0, 220));
});
test('independent analytics fixture: simple returns, sample Sharpe, drawdown and null losses', () => {
  const r = backtest(syntheticCandles({ count: 3 }), { strategy: createStrategy('no-trade') });
  r.equityCurve = [1100, 990, 1089].map((equity, i) => ({ equity, timestamp: new Date(Date.parse(time) + (i + 1) * 3600000).toISOString() }));
  const m = analyze(r, { periodsPerYear: 1 });
  // Returns +.1,-.1,+.1: mean 1/30, sample variance 1/75.
  assert.ok(Math.abs(m.sharpeRatio - (1 / 30) / Math.sqrt(1 / 75)) < 1e-12);
  assert.equal(m.maximumDrawdown, 110); assert.equal(m.maximumDrawdownPercentage, 10);
  assert.equal(m.netProfit, 89); assert.equal(m.profitFactor, null);
});

test('three-way split reserves final chronology and rejects empty or invalid partitions', async () => {
  const { researchSplit } = await import('../optimization/temporal.js');
  assert.deepEqual(researchSplit(720), { train: [0, 432], validation: [432, 576], finalTest: [576, 720] });
  for (const options of [{ trainFraction: .8, validationFraction: .3 }, { trainFraction: NaN }, { validationFraction: 0 }]) assert.throws(() => researchSplit(720, options));
  assert.throws(() => researchSplit(3, { trainFraction: .01 }));
});

test('cost stress reverses an apparent winning trade; short gap is adverse', async () => {
  const { protectiveFill, executionConfig } = await import('../execution/prices.js');
  const rows = syntheticCandles({ count: 4, regime: 'flat' });
  Object.assign(rows[3], { close: 1.1002, high: 1.1004 });
  const strategy = { id: 'cost-fixture', signal: xs => xs.length === 1 ? { action: 'target', side: 1, stopDistance: .01, takeDistance: .02 } : { action: 'hold' } };
  assert.ok(backtest(rows, { strategy, costs: { spreadPips: 0, slippagePips: 0 } }).trades[0].netPnl > 0);
  assert.ok(backtest(rows, { strategy, costs: { spreadPips: 5, slippagePips: 1 } }).trades[0].netPnl < 0);
  assert.deepEqual(protectiveFill({ side: -1, stop: 1.11, take: 1.09 }, { open: 1.13, high: 1.14, low: 1.12 }, executionConfig({ spreadPips: 0, slippagePips: 0 })), { price: 1.13, reason: 'stop-gap' });
});

test('passive CLI is offline, legacy emits semantic warning, short history warns', async () => {
  const { runOffline } = await import('../cli/offline.js');
  const { enrich } = await import('../reporting/index.js');
  const lines = [];
  assert.equal(await runOffline(['backtest', '--strategy', 'passive-hold-benchmark', '--count', '30'], { output: s => lines.push(s), errorOutput: assert.fail }), 0);
  assert.equal(JSON.parse(lines[0]).metrics.totalTrades, 1);
  const report = enrich(backtest(syntheticCandles({ count: 30 }), { strategy: createStrategy('buy-hold') }));
  assert.ok(report.warnings.includes('LEGACY_BUY_HOLD_IS_RISK_MANAGED_HOLD'));
  assert.ok(report.warnings.includes('SHORT_HISTORY_ANNUALIZED_RATIOS_ARE_DESCRIPTIVE'));
});

test('variable cost schedule revalues quotes, charges current fees and is reported', () => {
  const rows = syntheticCandles({ count: 4, regime: 'flat' });
  const strategy = { id: 'variable-costs', signal: xs => xs.length === 1 ? { action: 'target', side: 1, stopDistance: .01, takeDistance: .02 } : { action: 'hold' } };
  const config = { strategy, costSchedule: [{}, {}, { spreadPips: 100 }, { spreadPips: 10, commissionPerUnit: .0001 }] };
  const r = backtest(rows, config);
  assert.equal(r.config.executionModel.spread, 'declared-per-candle-schedule');
  assert.equal(r.config.costs.spreadPips, 1);
  assert.ok(r.equityCurve[2].equity < r.equityCurve[1].equity);
  assert.equal(r.fills[1].commissionUsd, r.trades[0].exitCommission);
  assert.ok(Math.abs(r.fills[0].requestedPrice - 1.10005) < 1e-12);
  assert.equal(r.fills[1].spreadCostUsd, r.trades[0].units * .0005);
  assert.throws(() => backtest(rows, { costSchedule: [{}] }), /INVALID_COST_SCHEDULE/);
  assert.throws(() => backtest(rows, { costSchedule: [null, {}, {}, {}] }), /INVALID_COST_SCHEDULE/);
});

test('intrabar ambiguity can conservatively stop or reject the entire run', async () => {
  const { protectiveFill, executionConfig } = await import('../execution/prices.js');
  const p = { side: 1, stop: 1, take: 1.2 }, c = { open: 1.1, low: .9, high: 1.3 };
  const costs = executionConfig({ spreadPips: 0, slippagePips: 0 });
  assert.equal(protectiveFill(p, c, costs).reason, 'stop-loss');
  assert.throws(() => protectiveFill(p, c, costs, false, 'reject-ambiguous'), /AMBIGUOUS/);
  assert.throws(() => backtest(syntheticCandles({ count: 4 }), { intrabarPolicy: 'take-first' }), /INVALID_INTRABAR_POLICY/);
});
