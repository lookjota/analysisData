import { freezeCandidate, restrictedConfig, identity } from './session.js';
import { validateDataset } from '../market-data/historical.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';
import { enrich } from '../reporting/index.js';
import { walkForwardWindows } from './temporal.js';
const run = (rows, candidate, config) => enrich(backtest(rows, { ...config, strategy: createStrategy(candidate.id, candidate.parameters) }));
/** Independent accounts per window. Context from origin; no equity-curve stitching. */
export function evaluateWalkForward(rows, candidates, windowOptions, config = {}) {
  const configuration = restrictedConfig(config);
  const { candles, contentHash } = validateDataset(rows, configuration.dataValidation);
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100) throw new Error('INVALID_CANDIDATES');
  const allowed = candidates.map(freezeCandidate);
  return walkForwardWindows(candles.length, windowOptions).map((window, windowId) => {
    const training = candles.slice(...window.train);
    const scores = allowed.map((candidate, index) => {
      const trainingReport = run(training, candidate, { ...configuration, closeAtEnd: true, evaluation: { start: 0, end: training.length, set: 'TRAIN' } });
      const validationReport = window.validation ? run(candles.slice(0, window.validation[1]), candidate, { ...configuration, closeAtEnd: true, evaluation: { start: window.validation[0], end: window.validation[1], set: 'VALIDATION' } }) : null;
      return { index, metrics: trainingReport.metrics, validationMetrics: validationReport?.metrics ?? null, score: (validationReport ?? trainingReport).metrics.netProfit };
    });
    scores.sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = allowed[scores[0].index];
    const outOfSample = run(candles.slice(0, window.test[1]), selected, { ...configuration, closeAtEnd: true, evaluation: { start: window.test[0], end: window.test[1], set: 'OOS' } });
    const period = range => ({ start: candles[range[0]].timestamp, endExclusive: new Date(Date.parse(candles[range[1] - 1].timestamp) + 3600000).toISOString(), count: range[1] - range[0] });
    const metadata = { windowId, training: period(window.train), validation: window.validation ? period(window.validation) : null, evaluation: period(window.test),
      selectedParameters: createStrategy(selected.id, selected.parameters).parameters, frozenIdentity: identity({ selected, window, configuration, strategyVersion: createStrategy(selected.id, selected.parameters).version }),
      warmupLength: window.test[0], datasetIdentity: contentHash, costAssumptions: outOfSample.config.costs, executionModel: outOfSample.config.executionModel,
      portfolioPolicy: 'independent-reset-capital-start-flat-force-close', tradeCount: outOfSample.metrics.totalTrades, netReturn: outOfSample.metrics.returnPercentage, maximumDrawdown: outOfSample.metrics.maximumDrawdown };
    return { window, metadata, selected, selectionMetric: window.validation ? 'validation-netProfit' : 'training-netProfit', trainingMetrics: scores[0].metrics, validationMetrics: scores[0].validationMetrics, outOfSample,
      warnings: [...outOfSample.warnings, ...(outOfSample.metrics.netProfit < 0 && scores[0].metrics.netProfit > 0 ? ['OUT_OF_SAMPLE_DETERIORATION'] : []), ...(outOfSample.metrics.totalTrades < 30 ? ['FEW_OUT_OF_SAMPLE_TRADES'] : [])] };
  });
}
/** Mean of independent window returns, not a compounded or stitched portfolio. */
export function aggregateWalkForward(windows) {
  if (!Array.isArray(windows) || !windows.length) throw new Error('INVALID_WINDOW_RESULTS');
  for (let i = 1; i < windows.length; i++) {
    if (windows[i].window.test[0] < windows[i - 1].window.test[1]) throw new Error('OVERLAPPING_OOS_WINDOWS');
    if (windows[i].metadata.datasetIdentity !== windows[0].metadata.datasetIdentity || identity(windows[i].metadata.costAssumptions) !== identity(windows[0].metadata.costAssumptions)) throw new Error('INCOMPATIBLE_WINDOW_ASSUMPTIONS');
  }
  return { metricOrigin: 'OOS', method: 'arithmetic-mean-independent-reset-accounts', windowCount: windows.length,
    tradeCount: windows.reduce((sum, w) => sum + w.outOfSample.metrics.totalTrades, 0),
    meanReturnPercentage: windows.reduce((sum, w) => sum + w.outOfSample.metrics.returnPercentage, 0) / windows.length,
    worstWindowDrawdownPercentage: Math.max(...windows.map(w => w.outOfSample.metrics.maximumDrawdownPercentage)),
    warnings: ['NOT_A_CONTINUOUS_PORTFOLIO_EQUITY_CURVE', 'DESCRIPTIVE_NOT_STATISTICAL_SIGNIFICANCE'] };
}
export function sensitivity(rows, candidates, scenarios, config = {}) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100 || !Array.isArray(scenarios) || !scenarios.length || scenarios.length > 100) throw new Error('INVALID_SENSITIVITY_GRID');
  validateDataset(rows);
  return candidates.flatMap(candidate => scenarios.map(costs => {
    const report = run(rows, candidate, { ...config, costs: { ...config.costs, ...costs } });
    return { candidate, costs: report.config.costs, metrics: report.metrics, warnings: report.warnings };
  }));
}
