import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../indicators/index.js';
import { createStrategy, strategyIds } from '../strategies/research.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
test('numeric SMA, EMA, RSI, MACD, ATR, bands and structural indicators', () => {
  assert.deepEqual(I.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(I.ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.equal(I.rsi([1, 2, 3, 2, 3], 3).at(-1), 77.77777777777777);
  near(I.standardDeviation([1, 2, 3], 3).at(-1), Math.sqrt(2 / 3));
  near(I.bollinger([1, 2, 3], 3).at(-1).upper, 2 + 2 * Math.sqrt(2 / 3));
  const candles = [1, 2, 3, 4, 5, 6, 7].map(close => ({ close, high: close + 0.5, low: close - 0.5 }));
  near(I.atr(candles, 2)[1], 1.25);
  assert.equal(I.adx(candles, 2).at(-1), 100);
  assert.equal(I.macd([1, 2, 3, 4, 5], 2, 3, 2).at(-1).histogram, 0);
  near(I.stochastic(candles, 2, 2).at(-1).k, 75);
  assert.deepEqual(I.rollingHigh([1, 3, 2], 2), [null, 3, 3]);
  assert.deepEqual(I.rollingLow([1, 3, 2], 2), [null, 1, 2]);
  assert.deepEqual(I.returns([1, 2, 1]), [null, 1, -0.5]);
  near(I.returns([1, 2], true)[1], Math.log(2));
  assert.throws(() => I.sma([1], 0));
});
test('indicator prefix invariance, explicit warmup and flat RSI', () => {
  const rows = syntheticCandles({ count: 250 }), xs = rows.map(c => c.close);
  for (const fn of [I.sma, I.ema, I.rsi, I.bollinger, I.standardDeviation]) assert.deepEqual(fn(xs, 14).slice(0, 100), fn(xs.slice(0, 100), 14));
  assert.deepEqual(I.adx(rows, 14).slice(0, 100), I.adx(rows.slice(0, 100), 14));
  assert.equal(I.rsi(Array(30).fill(1), 14).at(-1), 50);
  assert.equal(I.ema([1, 2], 3).at(-1), null);
});
test('strategies deterministic, warmup, trend directions, mean exits, breakout excludes current', () => {
  const up = syntheticCandles({ count: 250, regime: 'up' }), down = syntheticCandles({ count: 250, regime: 'down' });
  assert.equal(createStrategy('trend').signal(up).side, 1);
  assert.equal(createStrategy('trend').signal(down).side, -1);
  for (const id of strategyIds) {
    const s = createStrategy(id);
    assert.equal(s.signal(up.slice(0, 10)).action, 'hold');
    assert.deepEqual(s.signal(up), s.signal(up));
  }
  const spike = up.map(c => ({ ...c })); spike.at(-1).close = 2; spike.at(-1).high = 2;
  assert.equal(createStrategy('breakout').signal(spike).side, 1);
  const flat = syntheticCandles({ count: 250, regime: 'flat' });
  assert.equal(createStrategy('mean-reversion').signal(flat).exitLong, true);
  assert.equal(createStrategy('no-trade').signal(up).action, 'hold');
});

test('mean reversion entries and exits, crossover and breakout both directions', () => {
  const flat = syntheticCandles({ count: 250, regime: 'flat' });
  for (const side of [1, -1]) {
    const rows = flat.map(c => ({ ...c }));
    rows.at(-1).close = side === 1 ? .9 : 1.3;
    rows.at(-1).low = Math.min(rows.at(-1).close, 1.1);
    rows.at(-1).high = Math.max(rows.at(-1).close, 1.1);
    assert.equal(createStrategy('mean-reversion').signal(rows).side, side);
    assert.equal(createStrategy('breakout').signal(rows).side, -side);
    assert.equal(createStrategy('ma-cross', { fast: 2, slow: 3 }).signal(rows).side, -side);
  }
  assert.equal(createStrategy('mean-reversion').signal(flat).exitShort, true);
});
