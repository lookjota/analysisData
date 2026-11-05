const periodCheck = p => { if (!Number.isInteger(p) || p < 1 || p > 100000) throw new Error('INVALID_PERIOD'); };
const seriesCheck = xs => { if (!Array.isArray(xs) || xs.some(x => !Number.isFinite(x))) throw new Error('INVALID_SERIES'); };
const candlesCheck = candles => {
  if (!Array.isArray(candles) || candles.some(c => !c || ![c.high, c.low, c.close].every(x => Number.isFinite(x) && x > 0) || c.low > c.close || c.high < c.close)) throw new Error('INVALID_OHLC_SERIES');
};
export function rolling(xs, period, fn) {
  periodCheck(period); seriesCheck(xs);
  return xs.map((_, i) => i + 1 < period ? null : fn(xs.slice(i + 1 - period, i + 1)));
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
export const sma = (xs, p) => rolling(xs, p, mean);
export const standardDeviation = (xs, p) => rolling(xs, p, a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2))));
export const rollingHigh = (xs, p) => rolling(xs, p, a => Math.max(...a));
export const rollingLow = (xs, p) => rolling(xs, p, a => Math.min(...a));
export function ema(xs, p, alpha = 2 / (p + 1)) {
  periodCheck(p); seriesCheck(xs);
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new Error('INVALID_ALPHA');
  let value = null;
  return xs.map((x, i) => {
    if (i + 1 < p) return null;
    value = value === null ? mean(xs.slice(0, p)) : alpha * x + (1 - alpha) * value;
    return value;
  });
}
export function rsi(xs, p = 14) {
  periodCheck(p); seriesCheck(xs);
  const gains = xs.slice(1).map((x, i) => Math.max(0, x - xs[i]));
  const losses = xs.slice(1).map((x, i) => Math.max(0, xs[i] - x));
  const g = ema(gains, p, 1 / p), l = ema(losses, p, 1 / p);
  return xs.map((_, i) => i < p ? null : l[i - 1] === 0 ? (g[i - 1] === 0 ? 50 : 100) : 100 - 100 / (1 + g[i - 1] / l[i - 1]));
}
export function atr(candles, p = 14) {
  candlesCheck(candles);
  const tr = candles.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)));
  return ema(tr, p, 1 / p);
}
export function bollinger(xs, p = 20, deviations = 2) {
  if (!Number.isFinite(deviations) || deviations <= 0) throw new Error('INVALID_DEVIATIONS');
  const middle = sma(xs, p), std = standardDeviation(xs, p);
  return xs.map((_, i) => middle[i] === null ? null : { middle: middle[i], upper: middle[i] + deviations * std[i], lower: middle[i] - deviations * std[i] });
}
export function macd(xs, fast = 12, slow = 26, signal = 9) {
  if (fast >= slow) throw new Error('INVALID_MACD_PERIODS');
  const f = ema(xs, fast), s = ema(xs, slow), line = xs.map((_, i) => s[i] === null ? null : f[i] - s[i]);
  const valid = line.filter(x => x !== null), sig = ema(valid, signal);
  return line.map((value, i) => value === null ? null : { macd: value, signal: sig[i - slow + 1], histogram: sig[i - slow + 1] === null ? null : value - sig[i - slow + 1] });
}
export function stochastic(candles, p = 14, smooth = 3) {
  candlesCheck(candles);
  const high = rollingHigh(candles.map(c => c.high), p), low = rollingLow(candles.map(c => c.low), p);
  const k = candles.map((c, i) => high[i] === null || high[i] === low[i] ? null : 100 * (c.close - low[i]) / (high[i] - low[i]));
  periodCheck(smooth);
  return k.map((value, i) => ({ k: value, d: i + 1 < smooth || k.slice(i + 1 - smooth, i + 1).includes(null) ? null : mean(k.slice(i + 1 - smooth, i + 1)) }));
}
export function adx(candles, p = 14) {
  candlesCheck(candles);
  periodCheck(p);
  const plus = [], minus = [], ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], previous = candles[i - 1], up = c.high - previous.high, down = previous.low - c.low;
    plus.push(up > down && up > 0 ? up : 0); minus.push(down > up && down > 0 ? down : 0);
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - previous.close), Math.abs(c.low - previous.close)));
  }
  const a = ema(plus, p, 1 / p), b = ema(minus, p, 1 / p), r = ema(ranges, p, 1 / p);
  const dx = r.map((v, i) => v === null ? null : a[i] + b[i] === 0 ? 0 : 100 * Math.abs(a[i] - b[i]) / (a[i] + b[i]));
  const smoothed = ema(dx.slice(p - 1), p, 1 / p);
  return candles.map((_, i) => i < 2 * p - 1 ? null : smoothed[i - p]);
}
export function returns(xs, logarithmic = false) {
  seriesCheck(xs); if (xs.some(x => x <= 0)) throw new Error('NONPOSITIVE_PRICE');
  return xs.map((x, i) => i === 0 ? null : logarithmic ? Math.log(x / xs[i - 1]) : x / xs[i - 1] - 1);
}
export const candleRange = candles => { candlesCheck(candles); return candles.map(c => c.high - c.low); };
