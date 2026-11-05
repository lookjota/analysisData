export const PIP_SIZE = 0.0001;
export const LOT_UNITS = 100000;
export const pipValueUsd = units => units * PIP_SIZE;
export const unitsToLots = units => units / LOT_UNITS;
export const costDefaults = Object.freeze({ spreadPips: 1, slippagePips: 0.1, commissionPerUnit: 0, swapPerUnitPerDay: 0 });
export function executionConfig(options = {}) {
  if (Object.keys(options).some(k => !(k in costDefaults))) throw new Error('UNKNOWN_COST_OPTION');
  const c = { ...costDefaults, ...options };
  if (Object.values(c).some(x => !Number.isFinite(x) || x < 0) || c.spreadPips > 1000 || c.slippagePips > 1000) throw new Error('INVALID_COSTS');
  return Object.freeze(c);
}
export function executionPrice(mid, side, entering, costs) {
  const price = mid + side * (entering ? 1 : -1) * (costs.spreadPips / 2 + costs.slippagePips) * PIP_SIZE;
  if (!Number.isFinite(price) || price <= 0) throw new Error('INVALID_EXECUTION_PRICE');
  return price;
}
// Protective levels are executable-side prices. Stop gaps worsen to open;
// target gaps receive the target price (no favorable price improvement).
export function protectiveFill(position, candle, costs, gapOnly = false, intrabarPolicy = 'stop-first') {
  if (!['stop-first', 'reject-ambiguous'].includes(intrabarPolicy)) throw new Error('INVALID_INTRABAR_POLICY');
  const p = position, quote = mid => mid - p.side * costs.spreadPips * PIP_SIZE / 2;
  const open = quote(candle.open), adverse = quote(p.side === 1 ? candle.low : candle.high), favorable = quote(p.side === 1 ? candle.high : candle.low);
  const stopGap = p.side * (open - p.stop) <= 0, takeGap = p.side * (open - p.take) >= 0;
  const slip = p.side * costs.slippagePips * PIP_SIZE;
  if (stopGap) return { price: open - slip, reason: 'stop-gap' };
  if (takeGap) return { price: p.take - slip, reason: 'take-profit' };
  if (gapOnly) return null;
  const stopTouched = p.side * (adverse - p.stop) <= 0, takeTouched = p.side * (favorable - p.take) >= 0;
  if (stopTouched && takeTouched && intrabarPolicy === 'reject-ambiguous') throw new Error('AMBIGUOUS_PROTECTIVE_FILL');
  if (stopTouched) return { price: p.stop - slip, reason: 'stop-loss' };
  if (takeTouched) return { price: p.take - slip, reason: 'take-profit' };
  return null;
}
