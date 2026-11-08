import { evaluateWalkForward, aggregateWalkForward } from './research.js';
import { verifyHistory } from '../market-data/capital-history.js';
import { assessReadiness } from './readiness.js';
import { researchSplit } from './temporal.js';
import { createStrategy } from '../strategies/research.js';
import { backtest } from '../backtesting/index.js';
import { enrich } from '../reporting/index.js';
import { deepFreeze, freezeCandidate, identity } from './session.js';
import { usdUnits, usdNumber } from '../financial/decimal.js';

export const comparisonIds = Object.freeze(['trend', 'mean-reversion', 'breakout', 'ma-cross']);
const sumMoney = xs => usdNumber(xs.reduce((s, x) => s + usdUnits(x), 0n));
function conservativeMetrics(metrics) {
  return { ...metrics, sharpeRatio: null, sortinoRatio: null,
    assumptions: { ...metrics.assumptions, riskAdjustedRatioPolicy: 'SUPPRESSED_UNVERIFIED_ANNUALIZATION; observed H1 bars do not establish a valid annual inference contract' } };
}
function describe(report, strategy, range) {
  report = { ...report, metrics: conservativeMetrics(report.metrics) };
  const m = report.metrics;
  const side = value => {
    const trades = report.trades.filter(t => t.side === value);
    return { tradeCount: trades.length, netProfit: sumMoney(trades.map(t => t.netPnl)) };
  };
  return { ...report, comparison: { warmupRequirement: strategy.warmup, evaluatedCandles: range[1] - range[0],
    usableSignalObservations: Math.max(0, range[1] - Math.max(range[0], strategy.warmup - 1) - 1),
    winningTrades: report.trades.filter(t => t.netPnl > 0).length, losingTrades: report.trades.filter(t => t.netPnl < 0).length,
    long: side(1), short: side(-1), openPosition: report.equityCurve.at(-1).position,
    explicitCommission: sumMoney(report.trades.flatMap(t => [t.entryCommission, t.exitCommission])),
    swap: sumMoney(report.trades.map(t => t.swap)), spreadAndSlippage: 'Embedded in fills; attribution is reference-only and protective spread can be unknown',
    undefinedReasons: Object.fromEntries(Object.entries(m).filter(([, v]) => v === null).map(([k]) => [k, ['sharpeRatio', 'sortinoRatio'].includes(k) ? 'UNVERIFIED_ANNUALIZATION' : 'ZERO_DENOMINATOR_OR_INSUFFICIENT_OBSERVATIONS'])),
    sharpeRatio: null, sortinoRatio: null, riskAdjustedInference: 'UNSUPPORTED_ANNUALIZATION_FOR_INFERENCE; ratios suppressed in comparison; legacy research:evaluate unchanged' } };
}
/** No selector, callbacks, final-evaluation API or network dependencies. */
export function compareStrategies(artifact, options = {}) {
  if (Object.keys(options).some(k => !['candidates', 'smoke', 'costStress', 'walkForward'].includes(k))) throw new Error('INVALID_COMPARISON_OPTIONS');
  const { candidates = comparisonIds.map(id => ({ id })), smoke = false, costStress = false, walkForward = null } = options;
  if (walkForward !== null && !['rolling', 'expanding'].includes(walkForward)) throw new Error('INVALID_WINDOWS');
  if (typeof costStress !== 'boolean' || !Array.isArray(candidates) || !candidates.length || candidates.length > 7) throw new Error('INVALID_COMPARISON_OPTIONS');
  const allowed = candidates.map(freezeCandidate);
  if (new Set(allowed.map(c => c.id)).size !== allowed.length) throw new Error('DUPLICATE_STRATEGY');
  // Canonical built-in order, independent of caller subset ordering.
  const order = [...comparisonIds, 'no-trade', 'buy-hold', 'risk-managed-hold'];
  allowed.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const readiness = assessReadiness(artifact, { candidates: allowed, smoke });
  if (readiness.classification === 'INSUFFICIENT_DATA') throw new Error('INSUFFICIENT_DATA_USE_EXPLICIT_SMOKE');
  const dataset = verifyHistory(artifact), ranges = researchSplit(dataset.candles.length);
  // Remove holdout prices before constructing any evaluation work.
  const authorized = dataset.candles.slice(0, ranges.validation[1]);
  const config = { initialCapital: 1000, costs: { spreadPips: 0, slippagePips: .1 }, intrabarPolicy: 'stop-first', dataValidation: { ...dataset.manifest.validation, calendar: dataset.manifest.calendar } };
  const scenarios = [{ id: 'baseline', costs: config.costs, assumption: 'Observed bid/ask once; 0.1 pip adverse slippage per fill; stop-first' },
    ...(costStress ? [{ id: 'slippage', costs: { ...config.costs, slippagePips: 1.1 }, assumption: 'Additional 1 pip adverse slippage per fill' },
      { id: 'commission', costs: { ...config.costs, commissionPerOrder: 1 }, assumption: 'USD 1 per order per side' }] : [])];
  let common;
  const results = scenarios.map(scenario => ({ ...scenario, strategies: allowed.map(candidate => {
    const strategy = createStrategy(candidate.id, candidate.parameters);
    const run = (name, range) => {
      const report = describe(enrich(backtest(authorized.slice(0, range[1]), { ...config, costs: scenario.costs, strategy, closeAtEnd: true, evaluation: { start: range[0], end: range[1], set: name } })), strategy, range);
      const integrity = { initialCapital: report.config.initialCapital, risk: report.config.risk, execution: report.config.executionModel, costs: report.config.costs, calendar: readiness.calendar };
      const key = `${scenario.id}:${name}`;
      common ??= {};
      if (common[key] && identity(common[key]) !== identity(integrity)) throw new Error('INCOMPATIBLE_COMPARISON');
      common[key] = integrity;
      return report;
    };
    const training = run('TRAIN', ranges.train), validation = run('VALIDATION', ranges.validation);
    return { strategy: training.strategy, training, validation, evidence: 'INSUFFICIENT_EVIDENCE',
      warnings: [...(validation.metrics.totalTrades < 30 ? ['FEW_VALIDATION_TRADES'] : []), ...(validation.metrics.netProfit < training.metrics.netProfit ? ['LOWER_VALIDATION_PNL_UNEQUAL_PARTITION_LENGTHS'] : [])] };
  }) }));
  const robustness = walkForward === null ? null : allowed.map(candidate => {
    const windows = evaluateWalkForward(authorized, [candidate], { trainSize: Math.max(1, Math.floor(authorized.length / 2)), testSize: Math.max(1, Math.floor(authorized.length / 8)), expanding: walkForward === 'expanding' }, config);
    for (const w of windows) {
      w.trainingMetrics = conservativeMetrics(w.trainingMetrics);
      if (w.validationMetrics) w.validationMetrics = conservativeMetrics(w.validationMetrics);
      w.outOfSample.metrics = conservativeMetrics(w.outOfSample.metrics);
    }
    const returns = windows.map(w => w.outOfSample.metrics.returnPercentage);
    const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
    return { strategy: candidate.id, mode: walkForward, parameterSelection: 'NONE_SINGLE_FIXED_CANDIDATE', windows, aggregate: aggregateWalkForward(windows),
      positiveWindows: returns.filter(x => x > 0).length, negativeWindows: returns.filter(x => x < 0).length, flatWindows: returns.filter(x => x === 0).length,
      returnDispersionPopulationStddev: Math.sqrt(returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length),
      warning: 'EXPLORATORY_DEPENDENT_WINDOWS; baseline costs only; training context resets at rolling train origin, OOS context from dataset origin; parameters unchanged' };
  });
  const body = { schemaVersion: 'orion.strategy-comparison.v1', simulatedResearch: true, tradingEnabled: false, status: 'INSUFFICIENT_EVIDENCE',
    dataset: { id: readiness.datasetId, contentHash: readiness.contentHash, artifactHash: artifact.artifactHash, provenance: readiness.provenance, parents: { datasetIds: dataset.acquisition.registry?.parentDatasetIds ?? [], sources: (dataset.acquisition.registry?.sourceFiles ?? []).map(p => ({ datasetId: p.datasetId, artifactHash: p.artifactHash })) } },
    readiness, configurationDigest: identity({ config, candidates: allowed.map(c => { const s = createStrategy(c.id, c.parameters); return { id: s.id, version: s.version, parameters: s.parameters }; }), scenarios, ranges, walkForward }), integrity: common, results, robustness,
    holdout: 'NOT_EVALUATED_NO_CONSUMPTION_API; existing registry state not queried', ranking: null,
    accountPolicy: 'Independent reset capital/start flat/force close per strategy, partition and scenario; no PnL stitching',
    warnings: ['EXPLORATORY_ONLY', 'MULTIPLE_STRATEGY_COMPARISON', 'DEPENDENT_TRADES', 'REGIME_INSTABILITY', 'NO_STATISTICAL_SIGNIFICANCE', 'NO_LIVE_RECOMMENDATION', 'COSTS_CAN_CHANGE_SIZING_AND_TRADE_PATH_NO_MONOTONICITY_GUARANTEE',
      ...(new Set(results[0].strategies.map(s => s.training.comparison.usableSignalObservations)).size > 1 ? ['UNEQUAL_USABLE_COVERAGE'] : []), 'PARTITION_LENGTHS_DIFFER', 'NO_BOOTSTRAP_INSUFFICIENT_JUSTIFICATION'],
    pending: ['dependence-aware uncertainty', 'durable session replay'], runtime: process.version };
  return deepFreeze({ ...body, reportId: identity(body) });
}
export function comparisonSummary(report) {
  return { schemaVersion: report.schemaVersion, reportId: report.reportId, status: report.status, holdout: report.holdout, warnings: report.warnings,
    robustness: report.robustness?.map(r => ({ strategy: r.strategy, mode: r.mode, positiveWindows: r.positiveWindows, negativeWindows: r.negativeWindows, flatWindows: r.flatWindows, dispersion: r.returnDispersionPopulationStddev, warning: r.warning, windows: r.windows.map(w => ({ range: w.window.test, trades: w.outOfSample.metrics.totalTrades, pnl: w.outOfSample.metrics.netProfit, returnPercentage: w.outOfSample.metrics.returnPercentage })) })) ?? null,
    scenarios: report.results.map(s => ({ id: s.id, strategies: s.strategies.map(r => ({ strategy: r.strategy.id, trainTrades: r.training.metrics.totalTrades, trainPnl: r.training.metrics.netProfit,
      validationTrades: r.validation.metrics.totalTrades, validationPnl: r.validation.metrics.netProfit, validationProfitFactor: r.validation.metrics.profitFactor,
      validationDrawdown: r.validation.metrics.maximumDrawdown, evidence: r.evidence })) })) };
}
export function comparisonText(report) {
  const summary = comparisonSummary(report);
  const cell = x => typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')) : x ?? 'null';
  return summary.scenarios.map(s => `SCENARIO ${s.id}\nSTRATEGY | TRAIN_TRADES | TRAIN_PNL | VAL_TRADES | VAL_PNL | VAL_PF | VAL_DRAWDOWN | EVIDENCE\n` + s.strategies.map(r => [r.strategy, r.trainTrades, r.trainPnl, r.validationTrades, r.validationPnl, r.validationProfitFactor ?? 'null', r.validationDrawdown, r.evidence].map(cell).join(' | ')).join('\n')).join('\n') + (summary.robustness ? '\nWALK_FORWARD (baseline costs; independent accounts; exploratory)\n' + summary.robustness.map(r => `${r.strategy} | ${r.mode} | positive=${r.positiveWindows} | negative=${r.negativeWindows} | flat=${r.flatWindows} | return_stddev=${cell(r.dispersion)}\n` + r.windows.map(w => `  [${w.range.join(',')}) | trades=${w.trades} | pnl=${cell(w.pnl)}`).join('\n')).join('\n') : '') + '\nSimulated research. Final holdout not evaluated. Independent accounts. INSUFFICIENT_EVIDENCE.';
}
