import { datasetManifest } from '../market-data/manifest.js';
import { priceModel } from '../market-data/prices.js';
import { usdProduct, usdNumber } from '../financial/decimal.js';
import { validateDataset } from '../market-data/historical.js';
import { commissionFor, executionConfig, candleExecutionPrice } from '../execution/prices.js';
import { VirtualPortfolio } from '../portfolio/virtual.js';
/** Unlevered long EUR/USD, signal after first close, buy next open, sell final close.
 * Separate benchmark: no stop, target, trailing, reentry or risk sizing. */
export function passiveHold(rows, { initialCapital = 1000, costs: options = {}, allowSessionGaps = false, costSchedule = null, dataValidation = {}, provenance = null, executionMode } = {}) {
  const data = validateDataset(rows, dataValidation), model = priceModel(data.candles, executionMode);
  if (model.mode === 'OBSERVED_BID_ASK' && options.spreadPips) throw new Error('OBSERVED_SPREAD_ALREADY_INCLUDED');
  const baseCosts = executionConfig({ ...(model.mode === 'OBSERVED_BID_ASK' ? { spreadPips: 0 } : {}), ...options }), p = new VirtualPortfolio(initialCapital);
  if (costSchedule !== null && (!Array.isArray(costSchedule) || costSchedule.length !== data.candles.length)) throw new Error('INVALID_COST_SCHEDULE');
  const schedule = costSchedule?.map(c => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('INVALID_COST_SCHEDULE');
    if (model.mode === 'OBSERVED_BID_ASK' && c.spreadPips) throw new Error('OBSERVED_SPREAD_ALREADY_INCLUDED');
    return executionConfig({ ...baseCosts, ...c });
  }) ?? null;
  let costs = baseCosts;
  const manifest = provenance === null ? null : datasetManifest(data.candles, { ...provenance, ...dataValidation });
  const fill = (c, field, entering, price, units) => ({ type: entering ? 'open' : 'close', timestamp: entering ? c.timestamp : new Date(Date.parse(c.timestamp) + 3600000).toISOString(),
    signalTimestamp: entering ? data.candles[0].timestamp : null, signalAvailableAt: entering ? new Date(Date.parse(data.candles[0].timestamp) + 3600000).toISOString() : null,
    earliestEligibleExecutionTimestamp: entering ? c.timestamp : null, side: 1, orderSide: entering ? 'BUY' : 'SELL', executableQuote: price - (entering ? 1 : -1) * costs.slippagePips * .0001, quoteTimestamp: c.timestamp, price, executedPrice: price, units, executionMode: model.mode,
    requestedPrice: price - (entering ? 1 : -1) * costs.slippagePips * .0001, requestedPriceBasis: 'executable-quote-before-slippage',
    spreadCostUsd: usdNumber(usdProduct(units, c.quoteBars ? c.quoteBars.ask[field] - c.quoteBars.bid[field] : costs.spreadPips * .0001, .5)),
    slippageCostUsd: usdNumber(usdProduct(units, costs.slippagePips, .0001)), commissionUsd: usdNumber(commissionFor(units, costs)) });
  if (typeof allowSessionGaps !== 'boolean' || data.candles.length < 2) throw new Error('INVALID_BENCHMARK_CONFIG');
  if (!allowSessionGaps && data.warnings.some(w => ['SESSION_GAP', 'UNKNOWN_GAP'].includes(w.code))) throw new Error('SESSION_GAP_REQUIRES_ACKNOWLEDGEMENT');
  initialCapital = p.initialCapital;
  const equityCurve = [], fills = [];
  for (let i = 0; i < data.candles.length; i++) {
    const c = data.candles[i];
    costs = schedule?.[i] ?? baseCosts;
    if (p.position) {
      const nights = Math.floor(Date.parse(c.timestamp) / 86400000) - Math.floor(Date.parse(data.candles[i - 1].timestamp) / 86400000);
      if (nights) p.chargeSwap(usdProduct(p.position.units, costs.swapPerUnitPerDay, nights), c.timestamp);
    }
    if (i === 1) {
      const entry = candleExecutionPrice(c, 'open', 1, true, costs), units = Math.floor((p.cash - Math.max(costs.commissionPerOrder, costs.minimumCommission)) / (entry + costs.commissionPerUnit));
      if (units < 1) throw new Error('INSUFFICIENT_BENCHMARK_CAPITAL');
      p.open({ side: 1, entry, units, stopDistance: null, takeDistance: null, timestamp: c.timestamp, margin: usdProduct(units, entry), commission: commissionFor(units, costs) });
      fills.push(fill(c, 'open', true, entry, units));
    }
    const timestamp = new Date(Date.parse(c.timestamp) + 3600000).toISOString();
    const exit = candleExecutionPrice(c, 'close', 1, false, costs);
    if (i === data.candles.length - 1) {
      const units = p.position.units;
      p.close(exit, timestamp, 'end-of-data', commissionFor(units, costs));
      fills.push(fill(c, 'close', false, exit, units));
    }
    equityCurve.push(p.snapshot(exit, timestamp));
  }
  return { schemaVersion: 'orion.simulation.v1', simulatorVersion: '3.2.0-bc1', mode: 'benchmark', tradingEnabled: false,
    strategy: { id: 'passive-hold-benchmark', version: '1.0.0', parameters: {} },
    config: { initialCapital, accountCurrency: 'USD', costs: baseCosts, costSchedule: schedule, risk: null, accounting: { version: 'usd8-v1' }, executionModel: { ...model, version: 'explicit-h1-v2', signal: 'close-first/open-second', liquidity: 'not-modeled-no-capacity-evidence' }, closeAtEnd: true, allowSessionGaps },
    dataset: { temporal: data.temporal, quality: data.quality, sessionMetadata: data.sessionMetadata, manifest, contentHash: data.contentHash, hashAlgorithm: data.hashAlgorithm, hashVersion: data.hashVersion, instrument: 'EUR/USD', timeframe: 'H1', synthetic: data.synthetic, sources: [...new Set(data.candles.map(c => c.source))], count: rows.length, start: data.candles[0].timestamp, end: data.candles.at(-1).timestamp, warnings: data.warnings },
    trades: p.trades, ledger: p.ledger, equityCurve, fills, orders: [], riskEvents: [] };
}
