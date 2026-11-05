import test from 'node:test';
import assert from 'node:assert/strict';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { sma, ema, rsi, macd, atr } from '../indicators/index.js';
import { evaluateWalkForward } from '../optimization/research.js';
import { createResearchSession } from '../optimization/session.js';
const parameters = { fast: 2, slow: 5, period: 3, rsiPeriod: 2, atrPeriod: 2 };
const candidates = [{ id: 'no-trade', parameters }, { id: 'trend', parameters }];
const rows = () => syntheticCandles({ count: 100 });
const mutateFuture = (data, boundary) => data.map((c, i) => i < boundary ? c : { ...c, open: c.open * 2, high: c.high * 2, low: c.low * 2, close: c.close * 2 });

test('C2 context is indicator history only: flat account and no pending context signals', () => {
  const data = rows(), seen = [];
  const strategy = { id: 'probe', warmup: 5, signal: prefix => {
    seen.push(prefix.length); assert.ok(Object.isFrozen(prefix)); assert.ok(Object.isFrozen(prefix[0]));
    return { action: 'target', side: 1, stopDistance: .01, takeDistance: .02 };
  } };
  const r = backtest(data.slice(0, 30), { strategy, evaluation: { start: 20, end: 30, set: 'VALIDATION' } });
  assert.equal(r.equityCurve.length, 10); assert.equal(seen[0], 21);
  assert.equal(r.fills[0].timestamp, data[21].timestamp);
  assert.equal(r.orders[0].signalAvailableAt, data[21].timestamp);
  assert.equal(r.config.evaluation.warmupBars, 20); assert.equal(r.config.evaluation.indicatorReady, true);
  assert.equal(r.equityCurve[0].equity, 1000); assert.equal(r.trades.at(-1).closedAt, r.equityCurve.at(-1).timestamp);
  assert.ok(r.ledger.every(e => e.timestamp >= data[20].timestamp));
  const cold = backtest(data.slice(0, 3), { strategy: createStrategy('trend', parameters), evaluation: { start: 1, end: 3 } });
  assert.equal(cold.config.evaluation.indicatorReady, false); assert.equal(cold.fills.length, 0);
});

test('C2 SMA EMA RSI MACD ATR agree with continuous prefixes using same origin', () => {
  const data = rows(), xs = data.map(c => c.close), boundary = 70;
  for (const fn of [x => sma(x, 5), x => ema(x, 5), x => rsi(x, 5), x => macd(x, 2, 5, 3)]) {
    assert.deepEqual(fn(xs).slice(0, boundary), fn(xs.slice(0, boundary)));
    assert.deepEqual(fn(xs).slice(0, boundary), fn(mutateFuture(data, boundary).map(c => c.close)).slice(0, boundary));
  }
  assert.deepEqual(atr(data, 5).slice(0, boundary), atr(data.slice(0, boundary), 5));
  for (const id of ['trend', 'mean-reversion', 'breakout']) {
    const a = [], b = [], factory = createStrategy(id, parameters);
    backtest(data, { strategy: { ...factory, signal: p => { const s = factory.signal(p); a.push({ length: p.length, signal: s }); return s; } } });
    backtest(mutateFuture(data, boundary), { strategy: { ...factory, signal: p => { const s = factory.signal(p); b.push({ length: p.length, signal: s }); return s; } } });
    assert.deepEqual(a.filter(s => s.length <= boundary), b.filter(s => s.length <= boundary));
    const first = backtest(data, { strategy: factory }), second = backtest(mutateFuture(data, boundary), { strategy: factory });
    assert.deepEqual(first.orders.filter(o => o.timestamp < data[boundary].timestamp), second.orders.filter(o => o.timestamp < data[boundary].timestamp));
    assert.deepEqual(first.fills.filter(o => o.timestamp < data[boundary].timestamp), second.fills.filter(o => o.timestamp < data[boundary].timestamp));
  }
});

test('C3 protected research freezes selection, rejects raw data injection, explicitly consumes and labels reuse', () => {
  const data = rows(), session = createResearchSession(data);
  assert.equal(session.status().holdoutConsumptionCount, 0);
  assert.throws(() => session.evaluateFinal({ authorization: 'review-1' }), /NOT_FROZEN/);
  assert.throws(() => session.optimize(candidates, { rows: data }), /UNAUTHORIZED/);
  assert.throws(() => session.optimize([{ id: 'trend', signal: () => data }]), /CANDIDATE/);
  const tuning = session.optimize(candidates, { useValidation: true });
  assert.equal(tuning.training[0].metricOrigin, 'TRAIN'); assert.equal(tuning.validation[0].metricOrigin, 'VALIDATION');
  assert.ok(!JSON.stringify(tuning).includes(data[99].timestamp));
  const frozen = session.freeze(); assert.match(frozen.identity, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(frozen.selected.parameters));
  assert.throws(() => session.optimize(candidates), /FROZEN/);
  assert.throws(() => session.evaluateFinal(), /AUTHORIZATION/);
  data[90].close = 999; // session owns a canonical immutable copy.
  const final = session.evaluateFinal({ authorization: 'review-1' });
  assert.equal(final.metricOrigin, 'FINAL_HOLDOUT'); assert.equal(final.research.holdoutReused, false);
  assert.equal(session.status().holdoutConsumptionCount, 1);
  assert.throws(() => session.evaluateFinal({ authorization: 'review-2' }), /ALREADY_CONSUMED/);
  const reused = session.evaluateFinal({ authorization: 'review-2', allowReuse: true });
  assert.ok(reused.warnings.includes('FINAL_HOLDOUT_REUSED_NOT_INDEPENDENT'));
  assert.equal(session.status().holdoutConsumptionCount, 2);
  assert.deepEqual(reused.trades, final.trades);
});

test('C3 final holdout perturbations cannot affect optimization or selected parameters', () => {
  const data = rows(), a = createResearchSession(data), b = createResearchSession(mutateFuture(data, 80));
  const one = a.optimize(candidates, { useValidation: true }), two = b.optimize(candidates, { useValidation: true });
  assert.deepEqual(one, two); assert.deepEqual(a.freeze().selected, b.freeze().selected);
  assert.notEqual(a.status().datasetHash, b.status().datasetHash);
});

test('C4 rolling/expanding windows freeze before OOS, warm context, validation and independent accounts', () => {
  const data = rows();
  for (const expanding of [false, true]) {
    const options = { trainSize: 30, validationSize: 10, testSize: 20, expanding };
    const result = evaluateWalkForward(data, candidates, options);
    assert.equal(result.length, 3);
    for (const [i, w] of result.entries()) {
      assert.equal(w.window.validation[0], w.window.train[1]);
      assert.equal(w.window.test[0], w.window.validation[1]);
      assert.equal(w.outOfSample.metricOrigin, 'OOS');
      assert.equal(w.outOfSample.config.evaluation.warmupBars, w.window.test[0]);
      assert.equal(w.outOfSample.equityCurve.length, 20);
      assert.equal(w.outOfSample.config.initialCapital, 1000);
      assert.equal(w.metadata.windowId, i); assert.ok(Object.isFrozen(w.selected));
      if (i) assert.equal(w.window.test[0], result[i - 1].window.test[1]);
    }
    const changed = evaluateWalkForward(mutateFuture(data, 40), candidates, options);
    assert.deepEqual(result[0].selected, changed[0].selected);
    assert.deepEqual(result[0].trainingMetrics, changed[0].trainingMetrics);
    assert.deepEqual(result[0].validationMetrics, changed[0].validationMetrics);
  }
});

test('C2 calendar gaps/DST context does not create evaluated trades before boundary', () => {
  const times = ['2024-03-08T20:00:00Z', '2024-03-08T21:00:00Z', '2024-03-10T21:00:00Z', '2024-03-10T22:00:00Z', '2024-03-10T23:00:00Z'];
  const data = rows().slice(0, 5).map((c, i) => ({ ...c, timestamp: times[i] }));
  const r = backtest(data, { strategy: createStrategy('breakout', parameters), evaluation: { start: 2, end: 5, set: 'VALIDATION' }, dataValidation: { calendarMode: 'calendar-v1' } });
  assert.equal(r.equityCurve.length, 3); assert.equal(r.dataset.quality.missingHours, 0); assert.equal(r.config.evaluation.warmupBars, 2);
  assert.ok(r.fills.every(f => f.timestamp >= new Date(Date.parse(times[3])).toISOString()));
  assert.equal(r.decisions.at(-1).tradingEligible, false);
  assert.equal(r.decisions.at(-1).earliestEligibleExecutionTimestamp, null);
});

test('C4 aggregation rejects overlap and explicitly describes independent window returns', async () => {
  const { aggregateWalkForward } = await import('../optimization/research.js');
  const result = evaluateWalkForward(rows(), candidates, { trainSize: 40, testSize: 20 });
  const aggregate = aggregateWalkForward(result);
  assert.equal(aggregate.windowCount, 3); assert.equal(aggregate.metricOrigin, 'OOS');
  assert.equal(aggregate.tradeCount, result.reduce((s, w) => s + w.outOfSample.trades.length, 0));
  assert.ok(aggregate.warnings.includes('NOT_A_CONTINUOUS_PORTFOLIO_EQUITY_CURVE'));
  assert.throws(() => aggregateWalkForward([result[0], result[0]]), /OVERLAPPING/);
});

test('C3 research rejects callback configuration and records failed holdout attempts', () => {
  assert.throws(() => createResearchSession(rows(), { config: { strategy: { signal() {} } } }), /UNAUTHORIZED/);
  assert.throws(() => createResearchSession(rows(), { config: { evaluation: { start: 0, end: 100 } } }), /UNAUTHORIZED/);
  const session = createResearchSession(rows(), { config: { initialCapital: .00000001 } });
  session.optimize([{ id: 'no-trade', parameters }]); session.freeze();
  assert.equal(session.status().holdoutConsumptionCount, 0);
  assert.throws(() => session.evaluateFinal({ authorization: '' }), /AUTHORIZATION/);
  assert.equal(session.status().holdoutConsumptionCount, 0);
  session.evaluateFinal({ authorization: 'small-capital' });
  assert.equal(session.status().consumption[0].status, 'COMPLETED');
  const failed = createResearchSession(rows().filter((_, i) => i !== 90));
  failed.optimize([{ id: 'no-trade', parameters }]); failed.freeze();
  assert.throws(() => failed.evaluateFinal({ authorization: 'review-gap' }), /GAP/);
  assert.equal(failed.status().consumption[0].status, 'FAILED');
  assert.throws(() => failed.evaluateFinal({ authorization: 'retry' }), /ALREADY_CONSUMED/);
});
