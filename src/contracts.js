// Minimal, dependency-free boundary contracts for Milestone 1.
export const MODES = Object.freeze(['paper', 'demo']);
export const ORDER_SIDES = Object.freeze(['buy', 'sell']);
export const VENUES = Object.freeze(['freqtrade', 'hummingbot', 'mt5']);
export function assertSignal(signal) {
  if (!signal || typeof signal !== 'object') throw new TypeError('signal must be an object');
  for (const key of ['id', 'strategyId', 'venue', 'symbol', 'timestamp']) {
    if (typeof signal[key] !== 'string' || signal[key].length === 0) throw new TypeError(`invalid ${key}`);
  }
  if (!VENUES.includes(signal.venue)) throw new TypeError('unsupported venue');
  if (!ORDER_SIDES.includes(signal.side)) throw new TypeError('invalid side');
  if (!Number.isFinite(Date.parse(signal.timestamp)) || !signal.timestamp.endsWith('Z')) throw new TypeError('timestamp must be UTC ISO string');
  return Object.freeze({...signal});
}
export function assertOrderIntent(intent) {
  if (!intent || typeof intent !== 'object') throw new TypeError('invalid intent');
  for (const key of ['clientOrderId','signalId','symbol','quantity','limitPrice']) {
    if (typeof intent[key] !== 'string' || intent[key].trim().length === 0) throw new TypeError(`invalid ${key}`);
  }
  if (!ORDER_SIDES.includes(intent.side)) throw new TypeError('invalid side');
  // Quantity and prices use decimal strings to avoid binary floating-point representation.
  for (const key of ['quantity','limitPrice']) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(intent[key]) || !/[1-9]/.test(intent[key])) throw new TypeError(`invalid positive decimal ${key}`);
  }
  return Object.freeze({...intent});
}
