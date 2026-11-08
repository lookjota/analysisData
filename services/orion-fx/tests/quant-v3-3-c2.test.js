import { backtest } from '../backtesting/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireHistory, saveHistory } from '../market-data/capital-history.js';
import { compareStrategies, comparisonIds, comparisonSummary, comparisonText } from '../optimization/comparison.js';
import { run } from '../cli/index.js';
import { candleExecutionPrice, executionConfig, commissionFor } from '../execution/prices.js';
import { VirtualPortfolio } from '../portfolio/virtual.js';
import { htmlReport, tableCsv } from '../reporting/index.js';
import { aggregateWalkForward } from '../optimization/research.js';
const start = Date.parse('2026-11-02T00:00:00Z');
const fixture = async (changeFrom = 72) => acquireHistory({ verifyContext: async () => {}, findEurUsd: async () => ({ epic: 'EURUSD', metadata: { symbol: 'EUR/USD', instrumentType: 'CURRENCIES' } }), historicalCandles: async () => ({ prices: Array.from({ length: 72 }, (_, i) => {
  const p = 1.1 + Math.sin(i / 3) * .003 + (i >= changeFrom ? .02 : 0);
  const quote = x => ({ bid: x, ask: x + .0002 });
  return { snapshotTimeUTC: new Date(start + i * 3600000).toISOString().slice(0, 19), openPrice: quote(p), highPrice: quote(p + .001), lowPrice: quote(p - .001), closePrice: quote(p + .0001) };
}) }) }, { from: new Date(start).toISOString(), to: new Date(start + 72 * 3600000).toISOString(), expectedAccountId: 'offline-fixture', asOf: '2026-11-06T00:00:00Z' });
const artifact = await fixture();
const candidates = comparisonIds.map(id => ({ id, parameters: { fast: 2, slow: 4, period: 3, rsiPeriod: 2, atrPeriod: 2 } }));
const options = { candidates, smoke: true };
const report = compareStrategies(artifact, options);
test('C2 verified input, all four strategies, independent deterministic order and repeated state', () => {
  assert.deepEqual(report, compareStrategies(artifact, { ...options, candidates: [...candidates].reverse() }));
  assert.deepEqual(report.results[0].strategies.map(r => r.strategy.id), comparisonIds);
  const b = structuredClone(artifact); b.candles[0].close += .01;
  assert.throws(() => compareStrategies(b, options), /INTEGRITY/);
  for (const result of report.results[0].strategies) {
    assert.deepEqual(result, compareStrategies(artifact, { ...options, candidates: [candidates.find(c => c.id === result.strategy.id)] }).results[0].strategies[0]);
    for (const name of ['training', 'validation']) {
      assert.equal(result[name].config.initialCapital, 1000);
      assert.equal(result[name].comparison.openPosition, null);
      assert.ok(result[name].orders.every(o => o.signalAvailableAt <= o.timestamp));
      assert.ok(result[name].orders.every(o => o.timestamp >= result[name].dataset.start));
    }
  }
});
test('C2 partitions match, holdout prices cannot affect any comparison, validation starts flat', async () => {
  const changedHoldout = compareStrategies(await fixture(57), options);
  assert.deepEqual(report.results, changedHoldout.results);
  const changedFuture = compareStrategies(await fixture(50), options);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(report.results[0].strategies[i].validation.equityCurve.slice(0, 7), changedFuture.results[0].strategies[i].validation.equityCurve.slice(0, 7));
    assert.deepEqual(report.results[0].strategies[i].validation.decisions.slice(0, 7), changedFuture.results[0].strategies[i].validation.decisions.slice(0, 7));
  }
  const changedValidation = compareStrategies(await fixture(43), options);
  assert.deepEqual(report.results[0].strategies.map(s => s.training), changedValidation.results[0].strategies.map(s => s.training));
  const strategies = report.results[0].strategies;
  assert.equal(new Set(strategies.map(s => JSON.stringify(s.validation.config.evaluation))).size, 1);
  assert.ok(strategies.every(s => s.validation.equityCurve[0].cash === 1000));
  assert.ok(strategies.every(s => s.validation.dataset.count === Math.floor(72 * .8)));
  assert.equal(report.ranking, null);
  assert.match(report.holdout, /NOT_EVALUATED/);
  assert.ok(strategies.every(s => s.validation.decisions.every(d => d.signalTimestamp < artifact.candles[57].timestamp)));
});
test('C2 warmup differences, zero trades, undefined ratios and insufficient evidence', () => {
  const r = compareStrategies(artifact, { smoke: true, candidates: [{ id: 'no-trade' }, candidates[0]] });
  assert.ok(r.warnings.includes('UNEQUAL_USABLE_COVERAGE'));
  const empty = r.results[0].strategies.find(s => s.strategy.id === 'no-trade');
  assert.equal(empty.validation.metrics.totalTrades, 0);
  assert.equal(empty.validation.metrics.profitFactor, null);
  assert.equal(empty.validation.metrics.expectancy, null);
  assert.equal(empty.evidence, 'INSUFFICIENT_EVIDENCE');
  assert.ok(empty.validation.comparison.undefinedReasons.profitFactor);
  assert.equal(empty.validation.metrics.sharpeRatio, null);
  assert.equal(empty.validation.comparison.undefinedReasons.sharpeRatio, 'UNVERIFIED_ANNUALIZATION');
  assert.ok(report.results[0].strategies.some(s => s.training.metrics.netProfit < 0 || s.validation.metrics.netProfit < 0));
});
for (const side of [1, -1]) test(`C2 independent fixed-unit ${side === 1 ? 'long' : 'short'} spread/slippage/commission numeric oracle`, () => {
  const candle = { quoteBars: { bid: { open: 1.1, close: 1.1 }, ask: { open: 1.1002, close: 1.1002 } } };
  const pnl = (slippagePips, commissionPerOrder) => {
    const costs = executionConfig({ spreadPips: 0, slippagePips, commissionPerOrder });
    const p = new VirtualPortfolio(1000);
    p.open({ side, units: 1000, entry: candleExecutionPrice(candle, 'open', side, true, costs), stopDistance: .01, takeDistance: .01, timestamp: '2026-11-02T00:00:00Z', margin: 100, commission: commissionFor(1000, costs) });
    return p.close(candleExecutionPrice(candle, 'close', side, false, costs), '2026-11-02T01:00:00Z', 'fixture', commissionFor(1000, costs)).netPnl;
  };
  assert.equal(pnl(0, 0), -.2); // 2 pip observed round-trip spread, once.
  assert.equal(pnl(1, 0), -.4); // 1 pip per fill, fixed 1000 units.
  assert.equal(pnl(1, 1), -2.4);
});
test('C2 cost stress independent scenarios and observed spread cannot be recharged', () => {
  assert.throws(() => backtest(artifact.candles, { costs: { spreadPips: 1 }, dataValidation: { ...artifact.manifest.validation, calendar: artifact.manifest.calendar } }), /OBSERVED_SPREAD_ALREADY_INCLUDED/);
  const stressed = compareStrategies(artifact, { ...options, costStress: true });
  assert.deepEqual(stressed.results[0], report.results[0]);
  assert.equal(stressed.results.length, 3);
  assert.ok(stressed.warnings.some(w => w.includes('NO_MONOTONICITY')));
  for (const s of stressed.results) assert.ok(s.strategies.every(r => r.validation.config.costs.spreadPips === 0));
});
test('C2 rolling and expanding baseline windows exclude final holdout and reject overlap', () => {
  for (const walkForward of ['rolling', 'expanding']) {
    const r = compareStrategies(artifact, { smoke: true, candidates: [candidates[0]], walkForward });
    const windows = r.robustness[0].windows;
    assert.match(comparisonText(r), /WALK_FORWARD/);
    assert.equal(comparisonSummary(r).robustness[0].windows.length, windows.length);
    assert.ok(windows.length > 1);
    for (let i = 0; i < windows.length; i++) {
      assert.ok(windows[i].window.test[1] <= 57);
      if (i) assert.ok(windows[i].window.test[0] >= windows[i - 1].window.test[1]);
    }
    assert.throws(() => aggregateWalkForward([windows[0], windows[0]]), /OVERLAPPING/);
  }
});
test('C2 compact summary omits curves, full metrics preserved, HTML and CSV injection escaped', () => {
  assert.ok(!JSON.stringify(comparisonSummary(report)).includes('equityCurve'));
  assert.match(comparisonText(report), /TRAIN_TRADES/);
  assert.ok(report.results[0].strategies[0].training.equityCurve.length);
  const r = structuredClone(report.results[0].strategies[0].training); r.strategy.id = '<script>alert(1)</script>';
  assert.ok(!htmlReport(r).includes('<script>'));
  assert.match(tableCsv([{ x: '=1+1' }], ['x']), /'=1\+1/);
});
test('C2 CLI never reads credentials or network, strict options, exclusive full reports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orion-c2-'));
  const input = join(directory, 'input.json'); await saveHistory(input, artifact);
  const lines = [], errors = [];
  const io = { env: new Proxy({}, { get() { throw new Error('CREDENTIAL_ACCESS'); } }), fetchImpl: () => { throw new Error('NETWORK_ACCESS'); }, output: x => lines.push(x), errorOutput: x => errors.push(x) };
  const args = ['research:compare', '--input', input, '--smoke', 'true', '--summary', 'true'];
  assert.equal(await run(args, io), 0);
  assert.equal(JSON.parse(lines.at(-1)).scenarios[0].strategies.length, 4);
  const out = join(directory, 'report');
  assert.equal(await run([...args, '--out', out], io), 0);
  assert.ok(JSON.parse(await readFile(join(out, 'research.json'), 'utf8')).results[0].strategies[0].training.equityCurve);
  assert.equal(await run([...args, '--out', out], io), 1);
  for (const extra of [['--final', 'true'], ['--strategy', 'trend'], ['--summary', 'yes'], ['--format', 'csv'], ['--walk-forward', 'bad'], ['--strategies', '../bad'], ['--strategies', 'trend,trend']]) assert.equal(await run([...args, ...extra], io), 1);
});
