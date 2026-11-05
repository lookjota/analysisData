import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualPortfolio } from '../portfolio/virtual.js';
const time = '2024-01-08T00:00:00.000Z';
const intent = { side: 1, entry: 1.1, units: 100, margin: 11, commission: .01, timestamp: time, stopDistance: .01, takeDistance: .02 };
test('financial state cannot be mutated through public references', () => {
  const p = new VirtualPortfolio(1000); p.open(intent);
  const before = p.snapshot(1.1, time);
  const position = p.position; position.units = 9000;
  p.ledger.pop(); p.trades.push({ netPnlUsd8: '999999' });
  assert.throws(() => { p.position = null; }, TypeError);
  assert.throws(() => { p.initialCapital = 9000; }, TypeError);
  assert.deepEqual(p.snapshot(1.1, time), before);
});
test('freezing returned ledger cannot cause a partial booking', () => {
  const p = new VirtualPortfolio(1000); Object.freeze(p.ledger);
  p.open(intent); assert.equal(p.cash, 999.99); assert.ok(p.position);
  Object.freeze(p.trades); p.close(1.101, time, 'test', .01);
  assert.equal(p.snapshot(1.1, time).exactUsd8.cash, '100008000000');
});
test('insufficient capital and financial overflow reject without mutation', () => {
  const p = new VirtualPortfolio(1000), before = p.snapshot(1.1, time);
  for (const patch of [{ margin: 1000 }, { commission: 1001 }, { entry: 1e9 }, { stopDistance: Number.MIN_VALUE }]) {
    assert.throws(() => p.open({ ...intent, ...patch }));
    assert.deepEqual(p.snapshot(1.1, time), before);
  }
  p.open(intent); const opened = p.snapshot(1.1, time);
  assert.throws(() => p.close(1e9, time, 'overflow', 0));
  assert.deepEqual(p.snapshot(1.1, time), opened);
});
test('marks cannot precede booked events and trailing changes are validated', () => {
  const p = new VirtualPortfolio(1000); p.open(intent);
  assert.throws(() => p.snapshot(1.1, '2024-01-07T00:00:00Z'), /CHRONOLOGY/);
  assert.throws(() => p.updateTrailingStop(NaN), /INVALID/);
  assert.throws(() => p.updateTrailingStop(1.08), /INVALID/);
  p.updateTrailingStop(1.095); assert.equal(p.position.stop, 1.095);
});
test('USD8 booking preserves low units at the Number boundary', () => {
  const p = new VirtualPortfolio(90000000);
  // Independent integer oracle, including the unit lost by a Number round trip.
  const fee = 4503599627370497n;
  p.open({ ...intent, margin: 1100000001n, commission: fee });
  const opened = p.snapshot(1.1, time);
  assert.equal(opened.exactUsd8.cash, String(9000000000000000n - fee));
  assert.equal(opened.exactUsd8.marginUsed, '1100000001');
  const before = JSON.stringify(p.snapshot(1.1, time));
  assert.throws(() => p.close(1.1, time, {}, 0), /INVALID_CLOSE/);
  assert.equal(JSON.stringify(p.snapshot(1.1, time)), before);
  p.close(1.1, time, 'exact-units', 1n);
  assert.equal(p.snapshot(1.1, time).exactUsd8.cash, String(9000000000000000n - fee - 1n));
});
test('adverse long and short gaps retain losses, costs and release all margin', () => {
  for (const side of [1, -1]) {
    const p = new VirtualPortfolio(1000);
    p.open({ ...intent, side, units: 10000, margin: 900, commission: 1 });
    const exit = side === 1 ? .9 : 1.3;
    const pre = p.snapshot(exit, time);
    assert.equal(pre.exactUsd8.unrealizedPnl, '-200000000000');
    assert.equal(pre.exactUsd8.equity, '-100100000000');
    const trade = p.close(exit, time, 'STOP_OUT', 2);
    const post = p.snapshot(exit, time);
    assert.equal(trade.netPnlUsd8, '-200300000000');
    assert.equal(post.exactUsd8.cash, '-100300000000');
    assert.equal(post.exactUsd8.freeMargin, post.exactUsd8.equity);
    assert.equal(post.marginUsed, 0); assert.equal(post.grossExposure, 0);
    assert.equal(post.position, null);
    assert.throws(() => p.open(intent), /INSUFFICIENT_MARGIN/);
  }
});
