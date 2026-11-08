import { createHash } from 'node:crypto';
import { validateDataset } from '../market-data/historical.js';
import { researchSplit } from './temporal.js';
import { createStrategy } from '../strategies/research.js';
import { backtest } from '../backtesting/index.js';
import { enrich } from '../reporting/index.js';
export const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const identity = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function freezeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || Object.keys(candidate).some(k => !['id', 'parameters'].includes(k))) throw new Error('INVALID_RESEARCH_CANDIDATE');
  const copy = structuredClone(candidate);
  createStrategy(copy.id, copy.parameters);
  return deepFreeze(copy);
}
export function restrictedConfig(config) {
  if (!config || typeof config !== 'object' || Object.keys(config).some(k => !['initialCapital', 'costs', 'risk', 'trailingDistance', 'allowSessionGaps', 'intrabarPolicy', 'marginModel', 'dataValidation', 'provenance', 'executionMode'].includes(k))) throw new Error('UNAUTHORIZED_RESEARCH_CONFIG');
  return deepFreeze(structuredClone(config));
}
/** Optimizer receives only authorized TRAIN and optional VALIDATION prefixes. */
function optimizeAuthorized(trainingRows, validationRows, validationStart, candidates, configuration) {
  const run = (data, candidate, start, set) => enrich(backtest(data, { ...configuration, strategy: createStrategy(candidate.id, candidate.parameters), closeAtEnd: true, evaluation: { start, end: data.length, set } }));
  const training = candidates.map(c => run(trainingRows, c, 0, 'TRAIN'));
  const validation = validationRows ? candidates.map(c => run(validationRows, c, validationStart, 'VALIDATION')) : [];
  const scoring = validation.length ? validation : training;
  const ranked = scoring.map((r, index) => ({ index, score: r.metrics.netProfit })).sort((a, b) => b.score - a.score || a.index - b.index);
  return { selected: candidates[ranked[0].index], executionAssumptions: { costs: training[0].config.costs, executionModel: training[0].config.executionModel },
    selectionMetric: validation.length ? 'VALIDATION.netProfit' : 'TRAIN.netProfit',
    training: training.map(r => ({ metricOrigin: 'TRAIN', metrics: r.metrics })), validation: validation.map(r => ({ metricOrigin: 'VALIDATION', metrics: r.metrics })) };
}
/** Logical local guard. Only built-in strategies; no caller optimizer/callback receives rows.
 * Optional durable registry reserves access before execution; failures remain reserved. */
export function createResearchSession(rows, { split = {}, config = {}, registry = null } = {}) {
  const configuration = restrictedConfig(config), dataset = validateDataset(rows, configuration.dataValidation);
  const candles = deepFreeze(dataset.candles), ranges = deepFreeze(researchSplit(candles.length, split));
  const bounds = ([a, b]) => ({ startIndex: a, endIndex: b, count: b - a, start: candles[a].timestamp, endExclusive: new Date(Date.parse(candles[b - 1].timestamp) + 3600000).toISOString() });
  const definition = deepFreeze({ TRAIN: bounds(ranges.train), VALIDATION: bounds(ranges.validation), FINAL_HOLDOUT: bounds(ranges.finalTest) });
  const registrationIdentity = identity({ datasetHash: dataset.contentHash, splitDefinition: definition, configuration, methodologyVersion: 'research-session-v1' });
  const holdoutScope = { datasetHash: dataset.contentHash, datasetSchema: dataset.hashVersion, splitDefinition: definition, methodology: 'research-session-v1' };
  let selection = null, frozen = null, candidateCount = 0;
  const consumption = [], searchHistory = [];
  let executionAssumptions = null;
  const run = (candidate, range, set) => {
    // Pass only authorized prefix, never the full dataset to the backtester.
    const strategy = createStrategy(candidate.id, candidate.parameters);
    return enrich(backtest(candles.slice(0, range[1]), { ...configuration, strategy, closeAtEnd: true, evaluation: { start: range[0], end: range[1], set } }));
  };
  return Object.freeze({
    optimize(candidates, options = {}) {
      if (frozen) throw new Error('RESEARCH_FROZEN');
      if (Object.keys(options).some(k => k !== 'useValidation') || (options.useValidation !== undefined && typeof options.useValidation !== 'boolean')) throw new Error('UNAUTHORIZED_OPTIMIZER_INPUT');
      if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100) throw new Error('INVALID_CANDIDATES');
      const allowed = candidates.map(freezeCandidate);
      const result = optimizeAuthorized(candles.slice(...ranges.train), options.useValidation ? candles.slice(0, ranges.validation[1]) : null, ranges.validation[0], allowed, configuration);
      selection = result.selected; candidateCount = allowed.length; executionAssumptions = result.executionAssumptions;
      searchHistory.push({ candidates: allowed, selectionMetric: result.selectionMetric });
      return deepFreeze({ selected: result.selected, selectionMetric: result.selectionMetric, training: result.training, validation: result.validation });
    },
    freeze() {
      if (!selection) throw new Error('PARAMETERS_NOT_SELECTED');
      if (!frozen) {
        const strategy = createStrategy(selection.id, selection.parameters);
        const body = { registrationIdentity, datasetHash: dataset.contentHash, splitDefinition: definition, strategyVersion: strategy.version, selected: selection,
          engineVersion: '3.2.0-bc1', effectiveParameters: strategy.parameters, configuration, executionAssumptions, candidateCount, searchHistory: structuredClone(searchHistory), methodology: 'netProfit-stable-declared-order-v1; start-flat; reset-capital; context-from-origin; discard-context-signals; force-close' };
        frozen = deepFreeze({ ...body, identity: identity(body) });
      }
      return frozen;
    },
    evaluateFinal({ authorization, allowReuse = false } = {}) {
      if (!frozen) throw new Error('RESEARCH_NOT_FROZEN');
      if (typeof authorization !== 'string' || !authorization.trim() || authorization.length > 500 || typeof allowReuse !== 'boolean') throw new Error('EXPLICIT_EVALUATION_AUTHORIZATION_REQUIRED');
      if (consumption.length && !allowReuse) throw new Error('FINAL_HOLDOUT_ALREADY_CONSUMED');
      const reservation = registry?.reserveHoldout(holdoutScope, frozen, allowReuse);
      const holdoutReused = reservation ? reservation.reused : consumption.length > 0;
      const record = { authorization, frozenIdentity: frozen.identity, attempt: consumption.length + 1, holdoutReused, status: 'STARTED' };
      consumption.push(record); // Failed attempts still consume access.
      try {
        const result = run(selection, ranges.finalTest, 'FINAL_HOLDOUT');
        if (reservation) registry.consumeHoldout(reservation, identity(result));
        record.status = 'COMPLETED';
        return enrich({ ...result, research: { ...frozen, evaluationAuthorization: authorization, holdoutReused, holdoutConsumptionCount: reservation?.attempt ?? consumption.length } });
      } catch (error) { record.status = 'FAILED'; throw error; }
    },
    status() { const durable = registry?.holdoutStatus(identity(holdoutScope)); return deepFreeze({ registryMode: registry ? 'DURABLE' : 'VOLATILE', durableHoldoutState: durable ? (durable.length ? durable.at(-1).status : 'UNUSED') : null, durableAttempts: durable ?? null, registrationIdentity, datasetHash: dataset.contentHash, splitDefinition: definition, frozenIdentity: frozen?.identity ?? null, holdoutConsumptionCount: durable?.length ?? consumption.length, consumption: structuredClone(consumption) }); },
  });
}
