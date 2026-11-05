import { backtest } from '../backtesting/index.js';
import { validateDataset } from '../market-data/historical.js';
/** Bounded reference replay. Prefix recomputation favors auditable parity over speed. */
export async function replay(rows, options = {}, { clock = { advanceTo() {} }, onState = () => {} } = {}) {
  validateDataset(rows, { ...options.dataValidation, maxRows: 1000 });
  for (let i = 1; i <= rows.length; i++) {
    const closedAt = new Date(Date.parse(rows[i - 1].timestamp) + 3600000).toISOString();
    await clock.advanceTo(closedAt);
    const snapshot = backtest(rows.slice(0, i), { ...options, closeAtEnd: false });
    await onState(structuredClone(snapshot.equityCurve.at(-1)));
  }
  return { ...backtest(rows, options), mode: 'paper-replay' };
}
