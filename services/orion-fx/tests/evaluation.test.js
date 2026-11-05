import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyze } from '../analytics/index.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { writeReports, enrich, htmlReport, tableCsv } from '../reporting/index.js';
import { replay } from '../paper/replay.js';
import { temporalSplit, walkForwardWindows } from '../optimization/temporal.js';
import { run } from '../cli/index.js';
test('empty trades yield undefined ratios and zero drawdown, known net metrics', () => {
  const rows = syntheticCandles({ count: 10 });
  const result = backtest(rows, { strategy: createStrategy('no-trade') });
  const m = analyze(result);
  for (const key of ['profitFactor', 'winRate', 'sharpeRatio', 'sortinoRatio', 'expectancy', 'averageWin', 'averageLoss', 'recoveryFactor']) assert.equal(m[key], null, key);
  assert.equal(m.maximumDrawdown, 0); assert.equal(m.returnPercentage, 0);
  result.trades = [{ netPnl: 10, grossPnl: 12, openedAt: rows[0].timestamp, closedAt: rows[1].timestamp }, { netPnl: -5, grossPnl: -3, openedAt: rows[2].timestamp, closedAt: rows[3].timestamp }];
  result.equityCurve = [{ timestamp: rows[1].timestamp, equity: 1010 }, { timestamp: rows[3].timestamp, equity: 1005 }];
  const known = analyze(result);
  assert.equal(known.profitFactor, 2); assert.equal(known.expectancy, 2.5); assert.equal(known.maximumDrawdown, 5); assert.equal(known.netProfit, 5);
});
test('offline reports are self contained, HTML escaped and CSV formula safe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orion-report-'));
  try {
    const result = backtest(syntheticCandles({ count: 220 }));
    const report = await writeReports(result, join(dir, 'run'));
    const json = JSON.parse(await readFile(join(dir, 'run/report.json'), 'utf8'));
    assert.equal(json.schemaVersion, 'orion.simulation.v1'); assert.ok(json.dataset.synthetic);
    assert.ok((await readFile(join(dir, 'run/trades.csv'), 'utf8')).includes('netPnl'));
    await assert.rejects(writeReports(result, join(dir, 'run')));
    report.strategy.id = '<script>alert(1)</script>';
    const html = htmlReport(report);
    assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('src="https:'));
    assert.ok(tableCsv([{ name: '=1+1' }], ['name']).includes("'=1+1"));
  } finally { await rm(dir, { recursive: true }); }
});
test('paper replay injected clock and snapshots match batch, no wall clock needed', async () => {
  const rows = syntheticCandles({ count: 30 }); let calls = 0; const times = [];
  const result = await replay(rows, {}, { clock: { advanceTo: time => times.push(time) }, onState: state => { calls++; assert.equal(state.timestamp, times.at(-1)); } });
  assert.equal(calls, rows.length);
  const batch = backtest(rows);
  assert.deepEqual(result.trades, batch.trades); assert.deepEqual(result.ledger, batch.ledger);
  await assert.rejects(replay(syntheticCandles({ count: 1001 })));
});
test('temporal partitions preserve chronology, rolling and expanding training', () => {
  assert.deepEqual(temporalSplit(100), { train: [0, 70], test: [70, 100] });
  assert.deepEqual(walkForwardWindows(10, { trainSize: 4, testSize: 2 }), [{ train: [0, 4], test: [4, 6] }, { train: [2, 6], test: [6, 8] }, { train: [4, 8], test: [8, 10] }]);
  assert.deepEqual(walkForwardWindows(10, { trainSize: 4, testSize: 2, expanding: true }).at(-1).train, [0, 8]);
  assert.throws(() => temporalSplit(10, 1));
});
test('offline CLI runs with no credentials or fetch and rejects malformed flags', async () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = () => assert.fail('network prohibited');
  try {
    const lines = [], deps = { env: {}, output: s => lines.push(s), errorOutput: s => lines.push(s), fetchImpl: globalThis.fetch };
    for (const command of ['data:validate', 'indicators', 'backtest', 'compare', 'risk:check', 'paper:replay', 'report']) {
      assert.equal(await run([command, '--count', '30'], deps), 0, command);
      assert.equal(await run([command, '--help'], deps), 0);
    }
    for (const args of [['backtest', '--capital', 'NaN'], ['backtest', '--bogus', 'x'], ['backtest', '--out', '../../.env'], ['backtest', '--input', '.env'], ['backtest', '--spread', '-1'], ['backtest', '--allow-gaps', 'yes']]) assert.equal(await run(args, deps), 1);
    assert.ok(!lines.join('').includes('CAPITAL_API_KEY'));
  } finally { globalThis.fetch = originalFetch; }
});

test('walk-forward freezes training selection before test; cost sensitivity is explicit', async () => {
  const { evaluateWalkForward, sensitivity } = await import('../optimization/research.js');
  const rows = syntheticCandles({ count: 60 });
  const candidates = [{ id: 'no-trade' }, { id: 'trend' }];
  const windows = evaluateWalkForward(rows, candidates, { trainSize: 20, testSize: 20 });
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0].selected, candidates[0]);
  assert.equal(windows[0].outOfSample.config.initialCapital, 1000);
  const modified = rows.map((c, i) => i < 20 ? c : { ...c, close: c.close + .1, high: c.high + .1 });
  assert.deepEqual(evaluateWalkForward(modified, candidates, { trainSize: 20, testSize: 20 })[0].selected, windows[0].selected);
  const grid = sensitivity(rows, [{ id: 'no-trade' }], [{ spreadPips: 1 }, { spreadPips: 5 }]);
  assert.equal(grid.length, 2); assert.equal(grid[1].costs.spreadPips, 5);
});
