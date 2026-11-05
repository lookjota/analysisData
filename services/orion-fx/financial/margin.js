import { usdUnits, usdNumber } from './decimal.js';

/** Research hypothesis, fixed entry margin; no broker rule is implied. */
export function marginConfig(options = {}) {
  const defaults = { marginCallRatio: 1, stopOutRatio: 0.5 };
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !Object.hasOwn(defaults, k))) throw new Error('INVALID_MARGIN_CONFIG');
  const c = { ...defaults, ...options };
  if (!Object.values(c).every(x => Number.isFinite(x) && x >= 0.00000001 && x <= 10 && usdNumber(usdUnits(x)) === x) || c.stopOutRatio > c.marginCallRatio) throw new Error('INVALID_MARGIN_CONFIG');
  return Object.freeze(c);
}

export function assessMargin(equity, marginUsed, options = {}) {
  const c = marginConfig(options);
  if (!Number.isFinite(equity) || !Number.isFinite(marginUsed) || marginUsed < 0) throw new Error('INVALID_MARGIN_STATE');
  const e = usdUnits(equity), m = usdUnits(marginUsed);
  // Ratios use decimal thresholds quantized to USD8; comparisons stay integer.
  const stopOut = m > 0n && e * 100000000n <= m * usdUnits(c.stopOutRatio);
  const marginCall = m > 0n && e * 100000000n <= m * usdUnits(c.marginCallRatio);
  return Object.freeze({ modelVersion: 'fixed-entry-margin-v1', status: stopOut ? 'STOP_OUT' : marginCall ? 'MARGIN_CALL' : 'NORMAL', ratio: m === 0n ? null : Number(e) / Number(m), freeMargin: usdNumber(e - m), liquidation: stopOut ? 'FULL_POSITION_AT_NEXT_AVAILABLE_QUOTE' : null });
}
