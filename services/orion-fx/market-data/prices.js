import { timestamp } from './historical.js';
export const PRICE_MODES = Object.freeze(['OBSERVED_BID_ASK', 'ASSUMED_SPREAD', 'MID_ONLY_REFERENCE']);
const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
export function quoteSnapshot(raw, { instrument = 'EUR/USD', asOf, maxAgeMs = 0, strict = true } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof strict !== 'boolean') throw new Error('INVALID_QUOTE');
  if (strict && Object.keys(raw).some(k => !['instrument', 'timestamp', 'bid', 'ask', 'source'].includes(k))) throw new Error('UNKNOWN_QUOTE_FIELD');
  if (raw.instrument !== instrument || instrument !== 'EUR/USD') throw new Error('QUOTE_INSTRUMENT_MISMATCH');
  if (!positive(raw.bid) || !positive(raw.ask) || raw.bid > raw.ask) throw new Error('INVALID_BID_ASK');
  if (typeof raw.source !== 'string' || !raw.source.length) throw new Error('QUOTE_SOURCE_REQUIRED');
  const time = timestamp(raw.timestamp), now = timestamp(asOf ?? raw.timestamp), ageMs = Date.parse(now) - Date.parse(time);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0 || ageMs < 0) throw new Error('INVALID_QUOTE_TIME');
  if (ageMs > maxAgeMs) throw new Error('STALE_QUOTE');
  return Object.freeze({ instrument, timestamp: time, bid: raw.bid, ask: raw.ask, mid: raw.bid / 2 + raw.ask / 2,
    observedSpread: raw.ask - raw.bid, assumedSpread: null, source: raw.source, priceBasis: 'OBSERVED_BID_ASK', dataQuality: 'VALIDATED_DECLARATION', quoteFreshness: Object.freeze({ ageMs, maxAgeMs }) });
}
/** Independent bid/ask aggregates; no high-bid versus low-ask snapshot comparison. */
export function normalizeQuoteBars(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'ask,bid') throw new Error('INVALID_QUOTE_BARS');
  const result = {};
  for (const side of ['bid', 'ask']) {
    const bar = raw[side];
    if (!bar || Object.keys(bar).sort().join(',') !== 'close,high,low,open' || !Object.values(bar).every(positive)) throw new Error('INVALID_QUOTE_OHLC');
    if (bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.low > bar.high) throw new Error('INVALID_QUOTE_OHLC');
    result[side] = Object.freeze({ open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  }
  // Open and close are declared contemporaneous endpoints; extrema are not.
  if (result.bid.open > result.ask.open || result.bid.close > result.ask.close) throw new Error('CROSSED_QUOTE_ENDPOINT');
  return Object.freeze(result);
}
export function priceModel(candles, requested) {
  const observed = candles.filter(c => c.quoteBars).length;
  const mode = requested ?? (observed ? 'OBSERVED_BID_ASK' : 'ASSUMED_SPREAD');
  if (!PRICE_MODES.includes(mode)) throw new Error('INVALID_PRICE_MODEL');
  if (mode === 'MID_ONLY_REFERENCE') throw new Error('NON_EXECUTABLE_PRICE_MODEL');
  if ((mode === 'OBSERVED_BID_ASK' && observed !== candles.length) || (mode === 'ASSUMED_SPREAD' && observed)) throw new Error('PRICE_MODEL_DATA_MISMATCH');
  return Object.freeze({ mode, priceBasis: observed ? 'DECLARED_BID_ASK_OHLC' : 'MID', executable: true,
    observedSpread: observed ? 'CONTEMPORANEOUS_OPEN_CLOSE_ONLY' : null, assumedSpread: observed ? null : 'CONFIGURED_PIPS',
    quoteFreshness: observed ? 'AGGREGATED_H1_NOT_TICK_FRESHNESS' : 'NO_OBSERVED_QUOTES', dataQuality: 'VALIDATED_DECLARATION' });
}
