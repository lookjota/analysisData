import { MODES, assertOrderIntent } from './contracts.js';
/** Defense in depth: MVP never routes an order to any external system. */
export function evaluateOrder(intent, context = {}) {
  try { assertOrderIntent(intent); } catch (error) {
    return { allowed: false, code: 'INVALID_INTENT', reason: error.message };
  }
  if (process.env.LIVE_TRADING_ENABLED === 'true' || process.env.ORDER_EXECUTION_ENABLED === 'true') {
    return { allowed: false, code: 'UNSAFE_CONFIGURATION', reason: 'Milestone 1 forbids all execution' };
  }
  if (!MODES.includes(context.mode)) return {allowed: false, code: 'INVALID_MODE', reason: 'paper or demo required'};
  if (context.killSwitch !== false) return {allowed: false, code: 'KILL_SWITCH', reason: 'kill switch engaged or unknown'};
  if (context.marketDataFresh !== true) return {allowed: false, code: 'STALE_DATA', reason: 'market data stale or unknown'};
  // Even fully valid orders are blocked: this milestone has no order adapter.
  return {allowed: false, code: 'EXECUTION_DISABLED', reason: 'research-only foundation'};
}
