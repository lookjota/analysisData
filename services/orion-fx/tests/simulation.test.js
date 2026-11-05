import test from 'node:test';
import assert from 'node:assert/strict';
import { backtest } from '../backtesting/index.js';
import { assessIntent, riskConfig } from '../risk/simulation.js';
import { executionPrice, protectiveFill, executionConfig } from '../execution/prices.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const candles = () => syntheticCandles({ count: 4, regime: 'flat' }).map(c => ({ ...c, high: 1.1001, low: 1.0999 }));
const strategy = (side = 1, stopDistance = .01, takeDistance = .02) => ({ id: 'test', signal: history => history.length === 1 ? { action: 'target', side, stopDistance, takeDistance } : { action: 'hold' } });
test('next open execution, no future access, costed long and short ledger reconciliation', () => {
  for (const side of [1, -1]) {
    const rows = candles(); let calls = 0;
    const s = strategy(side), original = s.signal;
    s.signal = prefix => { assert.equal(prefix.length, ++calls); assert.ok(Object.isFrozen(prefix)); return original(prefix); };
    const result = backtest(rows, { strategy: s, costs: { commissionPerUnit: .00001 } });
    const trade = result.trades[0];
    assert.equal(trade.openedAt, rows[1].timestamp);
    near(trade.entry, rows[1].open + side * .00006);
    near(trade.exit, rows.at(-1).close - side * .00006);
    assert.ok(trade.netPnl < 0);
    near(result.equityCurve.at(-1).cash, 1000 + trade.netPnl);
    near(result.ledger.reduce((s, e) => s + e.amount, 1000), result.equityCurve.at(-1).equity);
    assert.equal(result.equityCurve.at(-1).marginUsed, 0);
    for (const state of result.equityCurve) near(state.equity, state.cash + state.unrealizedPnl);
  }
});
test('protective prices: conservative simultaneous stop/target, short stop and gap', () => {
  const costs = executionConfig({ spreadPips: 0, slippagePips: 0 });
  const p = { side: 1, stop: 1, take: 1.2 };
  assert.deepEqual(protectiveFill(p, { open: 1.1, low: .9, high: 1.3 }, costs), { price: 1, reason: 'stop-loss' });
  assert.deepEqual(protectiveFill(p, { open: .8, low: .7, high: .9 }, costs), { price: .8, reason: 'stop-gap' });
  assert.equal(protectiveFill({ side: -1, stop: 1.2, take: 1 }, { open: 1.1, high: 1.3, low: .9 }, costs).price, 1.2);
  assert.equal(protectiveFill(p, { open: 1.1, low: 1.05, high: 1.3 }, costs).reason, 'take-profit');
});
test('risk sizes by stop and caps margin/exposure, rejects limits and invalid intent', () => {
  const intent = { side: 1, entry: 1, stopDistance: .01, takeDistance: .02, equity: 1000, cash: 1000, peak: 1000, dayStart: 1000 };
  assert.equal(assessIntent(intent).units, 500);
  assert.equal(assessIntent({ ...intent, stopDistance: .001 }).units, 1000);
  for (const [override, code] of [[{ killSwitch: true }, 'KILL_SWITCH'], [{ equity: 970 }, 'DAILY_LOSS_LIMIT'], [{ equity: 890 }, 'DRAWDOWN_LIMIT'], [{ positions: 1 }, 'POSITION_LIMIT'], [{ stopDistance: 0 }, 'INVALID_INTENT'], [{ cash: .001 }, 'INSUFFICIENT_CAPITAL_OR_EXPOSURE']]) assert.equal(assessIntent({ ...intent, ...override }).code, code);
  assert.throws(() => riskConfig({ riskFraction: .02 }));
  assert.throws(() => riskConfig({ maxRiskFraction: .02 }));
});
test('stop, take, swap, trailing and reproducibility operate only in local ledger', () => {
  const rows = candles(); rows[2].low = 1.08;
  const stopped = backtest(rows, { strategy: strategy(1, .001), costs: { swapPerUnitPerDay: .00001 } });
  assert.equal(stopped.trades[0].reason, 'stop-loss');
  const targetRows = candles(); targetRows[2].high = 1.13;
  assert.equal(backtest(targetRows, { strategy: strategy() }).trades[0].reason, 'take-profit');
  const overnight = candles(); overnight[3].timestamp = '2024-01-09T00:00:00Z';
  const swap = backtest(overnight, { strategy: strategy(), allowSessionGaps: true, costs: { swapPerUnitPerDay: .0001 } });
  assert.ok(swap.trades[0].swap > 0);
  assert.throws(() => backtest(overnight, { strategy: strategy() }), /GAP/);
  const opts = { strategy: strategy(), trailingDistance: .002 };
  assert.deepEqual(backtest(candles(), opts), backtest(candles(), opts));
  const open = backtest(candles(), { strategy: strategy(), closeAtEnd: false });
  assert.ok(open.equityCurve.at(-1).position);
});

test('trailing stop updates after close, daily block and permanent drawdown halt', () => {
  const rows = candles();
  Object.assign(rows[1], { close: 1.105, high: 1.106, low: 1.0999 });
  Object.assign(rows[2], { open: 1.105, close: 1.104, high: 1.106, low: 1.103 });
  const trailing = backtest(rows, { strategy: strategy(), trailingDistance: .001, risk: { maxExposure: 100 } });
  assert.equal(trailing.trades[0].reason, 'stop-loss');
  assert.ok(trailing.trades[0].exit > trailing.trades[0].entry);
  const losses = syntheticCandles({ count: 20, regime: 'flat' }).map(c => ({ ...c, low: 1.098, high: 1.1001 }));
  const s = { id: 'repeated-loss', signal: () => ({ action: 'target', side: 1, stopDistance: .001, takeDistance: .01 }) };
  const daily = backtest(losses, { strategy: s, risk: { leverage: 10, maxExposure: 10000 } });
  assert.ok(daily.riskEvents.some(e => e.code === 'DAILY_LOSS_LIMIT' || e.code === 'KILL_SWITCH'));
  assert.ok(daily.trades.length < 19);
  const drawdown = backtest(losses, { strategy: s, risk: { leverage: 10, maxExposure: 10000, maxDrawdownFraction: .005 } });
  assert.ok(drawdown.riskEvents.some(e => e.code === 'DRAWDOWN_LIMIT' || e.code === 'KILL_SWITCH'));
  assert.ok(drawdown.trades.length < daily.trades.length);
});
