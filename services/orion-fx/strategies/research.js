import { ema, sma, atr, adx, rsi, bollinger } from '../indicators/index.js';
const defaults = { fast: 50, slow: 200, period: 20, rsiPeriod: 14, atrPeriod: 14, stopAtr: 2, rewardRisk: 2, adxMinimum: 0, trendFilter: false };
export const strategyIds = ['trend', 'mean-reversion', 'breakout', 'no-trade', 'buy-hold', 'risk-managed-hold', 'ma-cross'];
export function createStrategy(id = 'trend', parameters = {}) {
  if (!strategyIds.includes(id) || Object.keys(parameters).some(k => !(k in defaults))) throw new Error('INVALID_STRATEGY');
  const p = { ...defaults, ...parameters };
  for (const k of ['fast', 'slow', 'period', 'rsiPeriod', 'atrPeriod']) if (!Number.isInteger(p[k]) || p[k] < 2 || p[k] > 1000) throw new Error('INVALID_STRATEGY_PERIOD');
  if (p.fast >= p.slow || ![p.stopAtr, p.rewardRisk].every(x => Number.isFinite(x) && x > 0) || !Number.isFinite(p.adxMinimum) || p.adxMinimum < 0 || p.adxMinimum > 100 || typeof p.trendFilter !== 'boolean') throw new Error('INVALID_STRATEGY_PARAMETERS');
  return Object.freeze({ id, name: id, version: '1.0.0', timeframe: 'H1', instruments: ['EUR/USD'], parameters: Object.freeze(p), requirements: ['closed-mid-OHLC'], warmup: Math.max(p.slow, p.period + 1, p.atrPeriod, 2 * p.rsiPeriod),
    // Receives only the closed prefix. No data provider or execution capabilities.
    signal(candles) {
      if (candles.length < this.warmup || id === 'no-trade') return { action: 'hold' };
      const xs = candles.map(c => c.close), i = xs.length - 1, current = xs[i];
      const fast = ema(xs, p.fast).at(-1), slow = ema(xs, p.slow).at(-1), volatility = atr(candles, p.atrPeriod).at(-1);
      let side = 0, exit = false;
      if (id === 'trend' || id === 'ma-cross') {
        const filter = id !== 'trend' || p.adxMinimum === 0 || (adx(candles, p.rsiPeriod).at(-1) ?? 0) >= p.adxMinimum;
        if (filter) side = fast > slow ? 1 : fast < slow ? -1 : 0;
        if (id === 'ma-cross') {
          const f = sma(xs, p.fast), s = sma(xs, p.slow);
          side = f[i] > s[i] && f[i - 1] <= s[i - 1] ? 1 : f[i] < s[i] && f[i - 1] >= s[i - 1] ? -1 : 0;
        }
      } else if (id === 'mean-reversion') {
        const band = bollinger(xs, p.period).at(-1), momentum = rsi(xs, p.rsiPeriod).at(-1);
        side = current < band.lower && momentum < 30 && (!p.trendFilter || fast >= slow) ? 1 : current > band.upper && momentum > 70 && (!p.trendFilter || fast <= slow) ? -1 : 0;
        exit = current >= band.middle; // Direction-specific mean exit is provided below.
        return { action: side ? 'target' : 'hold', side, stopDistance: volatility * p.stopAtr, takeDistance: volatility * p.stopAtr * p.rewardRisk, exitLong: exit, exitShort: current <= band.middle };
      } else if (id === 'breakout') {
        const previous = candles.slice(-p.period - 1, -1);
        side = current > Math.max(...previous.map(c => c.high)) ? 1 : current < Math.min(...previous.map(c => c.low)) ? -1 : 0;
      } else if (id === 'buy-hold' || id === 'risk-managed-hold') side = 1;
      return { action: side ? 'target' : 'hold', side, stopDistance: volatility * p.stopAtr, takeDistance: volatility * p.stopAtr * p.rewardRisk };
    },
  });
}
