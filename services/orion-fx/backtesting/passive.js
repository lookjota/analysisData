import { validateDataset } from '../market-data/historical.js';
import { executionConfig, executionPrice } from '../execution/prices.js';
import { VirtualPortfolio } from '../portfolio/virtual.js';
/** Unlevered long EUR/USD, signal after first close, buy next open, sell final close.
 * Separate benchmark: no stop, target, trailing, reentry or risk sizing. */
export function passiveHold(rows, { initialCapital = 1000, costs: options = {}, allowSessionGaps = false, costSchedule = null } = {}) {
  if (costSchedule !== null) throw new Error('UNSUPPORTED_BENCHMARK_COST_SCHEDULE');
  const data = validateDataset(rows), costs = executionConfig(options), p = new VirtualPortfolio(initialCapital);
  if (typeof allowSessionGaps !== 'boolean' || data.candles.length < 2) throw new Error('INVALID_BENCHMARK_CONFIG');
  if (!allowSessionGaps && data.warnings.some(w => w.code === 'SESSION_GAP')) throw new Error('SESSION_GAP_REQUIRES_ACKNOWLEDGEMENT');
  initialCapital = p.initialCapital;
  const equityCurve = [], fills = [];
  for (let i = 0; i < data.candles.length; i++) {
    const c = data.candles[i];
    if (p.position) {
      const nights = Math.floor(Date.parse(c.timestamp) / 86400000) - Math.floor(Date.parse(data.candles[i - 1].timestamp) / 86400000);
      if (nights) p.chargeSwap(p.position.units * costs.swapPerUnitPerDay * nights, c.timestamp);
    }
    if (i === 1) {
      const entry = executionPrice(c.open, 1, true, costs), units = Math.floor(p.cash / (entry + costs.commissionPerUnit));
      if (units < 1) throw new Error('INSUFFICIENT_BENCHMARK_CAPITAL');
      p.open({ side: 1, entry, units, stopDistance: null, takeDistance: null, timestamp: c.timestamp, margin: units * entry, commission: units * costs.commissionPerUnit });
      fills.push({ type: 'open', timestamp: c.timestamp, price: entry, units });
    }
    const timestamp = new Date(Date.parse(c.timestamp) + 3600000).toISOString();
    const exit = executionPrice(c.close, 1, false, costs);
    if (i === data.candles.length - 1) {
      const units = p.position.units;
      p.close(exit, timestamp, 'end-of-data', units * costs.commissionPerUnit);
      fills.push({ type: 'close', timestamp, price: exit, units });
    }
    equityCurve.push(p.snapshot(exit, timestamp));
  }
  return { schemaVersion: 'orion.simulation.v1', simulatorVersion: '2.0.0', mode: 'benchmark', tradingEnabled: false,
    strategy: { id: 'passive-hold-benchmark', version: '1.0.0', parameters: {} },
    config: { initialCapital, accountCurrency: 'USD', costs, risk: null, accounting: { version: 'usd8-v1' }, executionModel: { version: 'mid-h1-v1', signal: 'close-first/open-second', liquidity: 'unlimited' }, closeAtEnd: true, allowSessionGaps },
    dataset: { contentHash: data.contentHash, hashAlgorithm: data.hashAlgorithm, hashVersion: data.hashVersion, instrument: 'EUR/USD', timeframe: 'H1', synthetic: data.synthetic, sources: [...new Set(data.candles.map(c => c.source))], count: rows.length, start: data.candles[0].timestamp, end: data.candles.at(-1).timestamp, warnings: data.warnings },
    trades: p.trades, ledger: p.ledger, equityCurve, fills, orders: [], riskEvents: [] };
}
