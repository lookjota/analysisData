import { validateDataset } from '../market-data/historical.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';
import { enrich } from '../reporting/index.js';
import { walkForwardWindows } from './temporal.js';
const run = (rows, candidate, config) => enrich(backtest(rows, { ...config, strategy: createStrategy(candidate.id, candidate.parameters) }));
/** Independent accounts per window, cold warmup in test; never stitch returns. */
export function evaluateWalkForward(rows, candidates, windowOptions, config = {}) {
  const { candles } = validateDataset(rows);
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100) throw new Error('INVALID_CANDIDATES');
  candidates.forEach(c => createStrategy(c.id, c.parameters));
  return walkForwardWindows(candles.length, windowOptions).map(window => {
    const training = candles.slice(...window.train);
    const scores = candidates.map((candidate, index) => ({ index, metrics: run(training, candidate, config).metrics }));
    // Stable tie break by declared order; optimization metric declared explicitly.
    scores.sort((a, b) => b.metrics.netProfit - a.metrics.netProfit || a.index - b.index);
    const selected = candidates[scores[0].index];
    const outOfSample = run(candles.slice(...window.test), selected, config);
    return { window, selected, selectionMetric: 'training-netProfit', trainingMetrics: scores[0].metrics, outOfSample, warnings: [...(outOfSample.metrics.netProfit < 0 && scores[0].metrics.netProfit > 0 ? ['OUT_OF_SAMPLE_DETERIORATION'] : []), ...(outOfSample.metrics.totalTrades < 30 ? ['FEW_OUT_OF_SAMPLE_TRADES'] : [])] };
  });
}
export function sensitivity(rows, candidates, scenarios, config = {}) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100 || !Array.isArray(scenarios) || !scenarios.length || scenarios.length > 100) throw new Error('INVALID_SENSITIVITY_GRID');
  validateDataset(rows);
  return candidates.flatMap(candidate => scenarios.map(costs => {
    const report = run(rows, candidate, { ...config, costs: { ...config.costs, ...costs } });
    return { candidate, costs: report.config.costs, metrics: report.metrics, warnings: report.warnings };
  }));
}
