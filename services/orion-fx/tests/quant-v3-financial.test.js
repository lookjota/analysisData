import test from 'node:test';
import assert from 'node:assert/strict';
import { usdProduct, usdUnits } from '../financial/decimal.js';
import { assessMargin } from '../financial/margin.js';
import { VirtualPortfolio } from '../portfolio/virtual.js';
import { assessIntent } from '../risk/simulation.js';
import { backtest } from '../backtesting/index.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
const time = '2024-01-08T00:00:00.000Z';
const opening = { side: 1, entry: 1.1, units: 1000, margin: 110, commission: 0, timestamp: time, stopDistance: .01, takeDistance: .02 };

test('V3 exact product and snapshot reference preserve decimal accounting', () => {
  assert.equal(usdProduct(.1, 3), 30000000n);
  assert.equal(usdProduct(1000, .000000005), 500n);
  assert.throws(() => usdProduct(1e9, 1000), /OVERFLOW/);
  const p = new VirtualPortfolio(1000);
  p.open({ ...opening, side: -1, commission: .01 });
  p.chargeSwap(.03, time);
  const s = p.snapshot(1.101, time);
  assert.deepEqual(s.exactUsd8, { cash: '99996000000', equity: '99896000000', unrealizedPnl: '-100000000', realizedPnl: '0', marginUsed: '11000000000', freeMargin: '88896000000', grossExposure: '110100000000', netExposure: '-110100000000' });
});

test('V3 rejects swap and close time reversal without booking partial events', () => {
  const p = new VirtualPortfolio(1000); p.open(opening);
  assert.throws(() => p.chargeSwap(1, '2024-01-07T00:00:00Z'), /INVALID_SWAP/);
  p.chargeSwap(.01, '2024-01-09T00:00:00Z');
  const before = JSON.stringify(p.ledger);
  assert.throws(() => p.close(1.2, time, 'reversal', 0), /INVALID_CLOSE/);
  assert.equal(JSON.stringify(p.ledger), before);
});

test('V3 margin independent threshold, negative equity, no position and invalid input references', () => {
  assert.equal(assessMargin(101, 100).status, 'NORMAL');
  assert.equal(assessMargin(100, 100).status, 'MARGIN_CALL');
  assert.equal(assessMargin(50, 100).status, 'STOP_OUT');
  assert.equal(assessMargin(-25, 100).freeMargin, -125);
  assert.equal(assessMargin(-25, 100).status, 'STOP_OUT');
  assert.equal(assessMargin(100, 0).ratio, null);
  for (const c of [{ stopOutRatio: 2 }, { stopOutRatio: 0 }, { marginCallRatio: NaN }, { unknown: 1 }]) assert.throws(() => assessMargin(100, 100, c));
  assert.throws(() => assessMargin(NaN, 100));
  assert.throws(() => assessMargin(100, -1));
});

test('V3 seeded 1200 alternating operations reconcile independent integer oracle including gaps and reentry', () => {
  // LCG seed 20261105; prices are integer decimal ticks, oracle uses integers only.
  let seed = 20261105, expected = 10000000000000n;
  const p = new VirtualPortfolio(100000);
  for (let i = 0; i < 1200; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const ticks = (seed % 2001) - 1000, side = i % 2 ? -1 : 1;
    const fee = i % 3 ? .02 : 0, swap = i % 5 ? 0 : .03;
    const stamp = new Date(Date.parse(time) + i * 3600000).toISOString();
    p.open({ ...opening, side, timestamp: stamp, commission: fee });
    if (swap) p.chargeSwap(swap, stamp);
    p.close((11000 + ticks) / 10000, stamp, 'seeded-gap', fee);
    expected += BigInt(side * ticks) * 10000000n - (fee ? 4000000n : 0n) - (swap ? 3000000n : 0n);
    const s = p.snapshot(1.1, stamp);
    assert.equal(s.exactUsd8.cash, String(expected));
    assert.equal(s.exactUsd8.equity, String(expected));
    assert.equal(s.marginUsed, 0); assert.equal(s.exposure, 0);
    assert.equal(usdUnits(p.cash), expected);
  }
  assert.equal(p.trades.length, 1200);
});

test('V3 virtual full stop-out records model, releases margin and reruns deterministically', () => {
  const rows = syntheticCandles({ count: 5, regime: 'flat' });
  const strategy = { id: 'margin-fixture', signal: xs => xs.length === 1 ? { action: 'target', side: 1, stopDistance: .001, takeDistance: .02 } : { action: 'hold' } };
  // Deliberately conservative 200% threshold: hypothesis, not a broker rule.
  const options = { strategy, risk: { maxExposure: 10000, riskFraction: .01 }, marginModel: { marginCallRatio: 2, stopOutRatio: 2 } };
  const r = backtest(rows, options);
  assert.deepEqual(r, backtest(rows, options));
  assert.equal(r.config.marginModel.version, 'fixed-entry-margin-v1');
  assert.ok(r.riskEvents.some(e => e.code === 'STOP_OUT'));
  assert.equal(r.trades[0].reason, 'STOP_OUT');
  assert.equal(r.equityCurve.at(-1).marginUsed, 0);
  assert.equal(r.tradingEnabled, false);
});

test('V3 risk denies extreme exposure, exhausted margin, halt and invalid sizing', () => {
  const intent = { side: 1, entry: 1.1, stopDistance: .01, takeDistance: .02, equity: 1000, cash: 1000, peak: 1000, dayStart: 1000 };
  for (const patch of [{ cash: 0 }, { equity: -1 }, { killSwitch: true }, { validData: false }, { entry: Infinity }, { positions: 1 }]) assert.equal(assessIntent({ ...intent, ...patch }).allowed, false);
  const d = assessIntent(intent);
  assert.ok(d.units * intent.entry <= 1000);
  assert.ok(d.margin <= intent.cash);
});
