import { verifyHistory } from '../market-data/capital-history.js';
import { researchSplit } from './temporal.js';
import { createStrategy } from '../strategies/research.js';
import { deepFreeze, freezeCandidate } from './session.js';

// Planning floors, never a statistical power calculation or evidence of edge.
export const readinessDefaults = Object.freeze({ exploratorySessions: 20, researchSessions: 252, researchUsablePerPartition: 500 });
export function assessReadiness(artifact, { candidates = [{ id: 'trend' }], split = {}, thresholds = {}, smoke = false, horizonBars = 0 } = {}) {
  const dataset = verifyHistory(artifact);
  if (dataset.temporal.calendarMode !== 'calendar-v1' || dataset.quality.missingHours || dataset.quality.unknownHours || !dataset.manifest.calendar) throw new Error('UNVERIFIED_RESEARCH_CONTINUITY');
  if (Object.keys(split).some(k => !['trainFraction', 'validationFraction'].includes(k))) throw new Error('INVALID_RESEARCH_SPLIT');
  if (typeof smoke !== 'boolean' || horizonBars !== 0) throw new Error('UNSUPPORTED_RESEARCH_HORIZON');
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 100) throw new Error('INVALID_CANDIDATES');
  if (Object.keys(thresholds).some(k => !(k in readinessDefaults))) throw new Error('INVALID_READINESS_THRESHOLDS');
  const policy = { ...readinessDefaults, ...thresholds };
  if (!Object.values(policy).every(x => Number.isSafeInteger(x) && x > 0) || policy.researchSessions < policy.exploratorySessions) throw new Error('INVALID_READINESS_THRESHOLDS');
  const strategies = candidates.map(freezeCandidate).map(c => createStrategy(c.id, c.parameters));
  const warmup = Math.max(...strategies.map(s => s.warmup));
  const ranges = researchSplit(dataset.candles.length, split);
  const partitions = Object.fromEntries(Object.entries(ranges).map(([name, [start, end]]) => [name, { start, end, count: end - start, usableObservations: Math.max(0, end - Math.max(start, warmup - 1) - 1), contextBars: start }]));
  const sessions = new Set(dataset.candles.map(c => c.timestamp.slice(0, 10))).size;
  const usable = Object.values(partitions).every(p => p.usableObservations > 0);
  let classification = 'INSUFFICIENT_DATA';
  if (usable && sessions >= policy.exploratorySessions) classification = 'EXPLORATORY';
  if (usable && sessions >= policy.researchSessions && Object.values(partitions).every(p => p.usableObservations >= policy.researchUsablePerPartition)) classification = 'RESEARCH_READY';
  if (smoke && classification === 'INSUFFICIENT_DATA') classification = 'ENGINEERING_SMOKE_TEST';
  return deepFreeze({ classification, evidenceStatus: 'INSUFFICIENT_EVIDENCE', datasetId: dataset.manifest.datasetId, contentHash: dataset.contentHash,
    instrument: dataset.manifest.instrument, timeframe: dataset.manifest.timeframe, artifactHash: artifact.artifactHash, provenance: { source: dataset.acquisition.source, environment: dataset.acquisition.environment, acquiredAt: dataset.acquisition.acquiredAt, priceBasis: dataset.acquisition.priceBasis, licenseStatus: dataset.manifest.license.status }, calendar: dataset.manifest.calendar,
    coverage: dataset.manifest.coverage, observations: dataset.candles.length, representedUtcDates: sessions, sessionConvention: 'UTC dates containing observations; not exchange sessions', warmup, partitions, thresholds: policy,
    expectedIndependentTrades: null, horizonBars, warnings: ['PLANNING_FLOORS_NOT_POWER_ANALYSIS', 'NO_ESTIMATE_OF_INDEPENDENT_TRADES', 'VARIABLE_POSITION_HORIZONS_NO_EVENT_LABELS', 'CALENDAR_IS_DECLARED_NOT_BROKER_VERIFIED', 'HASH_IS_NOT_SOURCE_AUTHENTICATION', 'AGGREGATED_QUOTES_NOT_TICK_FRESHNESS', 'READINESS_IS_NOT_PROFITABILITY', ...(dataset.manifest.quality.warnings ?? [])] });
}
