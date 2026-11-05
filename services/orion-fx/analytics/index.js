import { usdUnits, usdNumber } from '../financial/decimal.js';
const sum = xs => xs.reduce((s, x) => s + x, 0);
const avg = xs => xs.length ? sum(xs) / xs.length : null;
const ratio = (n, d) => d > 0 ? n / d : null;
export function analyze(result, { periodsPerYear = 24 * 252 } = {}) {
  if (!Number.isFinite(periodsPerYear) || periodsPerYear <= 0) throw new Error('INVALID_ANNUALIZATION');
  const trades = result.trades, curve = result.equityCurve, initial = result.config.initialCapital;
  const wins = trades.filter(t => t.netPnl > 0).map(t => t.netPnl), losses = trades.filter(t => t.netPnl < 0).map(t => t.netPnl);
  const moneySum = xs => usdNumber(xs.reduce((s, x) => s + usdUnits(x), 0n));
  const grossProfit = moneySum(wins), grossLoss = -moneySum(losses), netProfit = usdNumber(usdUnits(curve.at(-1).equity) - usdUnits(initial));
  let peak = initial, maximumDrawdown = 0, maximumDrawdownPercentage = 0, consecutiveWins = 0, consecutiveLosses = 0, w = 0, l = 0;
  const drawdownCurve = curve.map(s => {
    peak = Math.max(peak, s.equity); const absolute = peak - s.equity, percentage = 100 * absolute / peak;
    maximumDrawdown = Math.max(maximumDrawdown, absolute); maximumDrawdownPercentage = Math.max(maximumDrawdownPercentage, percentage);
    return { timestamp: s.timestamp, absolute, percentage };
  });
  for (const t of trades) {
    w = t.netPnl > 0 ? w + 1 : 0; l = t.netPnl < 0 ? l + 1 : 0;
    consecutiveWins = Math.max(consecutiveWins, w); consecutiveLosses = Math.max(consecutiveLosses, l);
  }
  const returns = curve.map((s, i) => { const previous = i ? curve[i - 1].equity : initial; return previous > 0 ? s.equity / previous - 1 : null; });
  const valid = returns.every(x => x !== null), mean = valid ? avg(returns) : null;
  const variance = valid && returns.length > 1 ? sum(returns.map(x => (x - mean) ** 2)) / (returns.length - 1) : null;
  const downside = valid ? Math.sqrt(avg(returns.map(x => Math.min(0, x) ** 2))) : null;
  const monthlyReturns = []; let month, base = initial, last = initial;
  for (const s of curve) {
    const key = s.timestamp.slice(0, 7);
    if (month && key !== month) { monthlyReturns.push({ month, returnPercentage: base > 0 ? 100 * (last / base - 1) : null }); base = last; }
    month = key; last = s.equity;
  }
  if (month) monthlyReturns.push({ month, returnPercentage: base > 0 ? 100 * (last / base - 1) : null });
  const start = Date.parse(result.dataset.start), end = Date.parse(curve.at(-1).timestamp);
  const exposureMs = sum(trades.map(t => Date.parse(t.closedAt) - Date.parse(t.openedAt))) + (curve.at(-1).position ? end - Date.parse(curve.at(-1).position.openedAt) : 0);
  return { totalTrades: trades.length, winRate: ratio(wins.length, trades.length), averageWin: avg(wins), averageLoss: avg(losses), profitFactor: ratio(grossProfit, grossLoss), expectancy: avg(trades.map(t => t.netPnl)), netProfit, grossProfit, grossLoss, grossTradingPnl: moneySum(trades.map(t => t.grossPnl)), maximumDrawdown, maximumDrawdownPercentage, recoveryFactor: ratio(netProfit, maximumDrawdown), returnPercentage: 100 * netProfit / initial, sharpeRatio: variance === null ? null : ratio(mean * Math.sqrt(periodsPerYear), Math.sqrt(variance)), sortinoRatio: downside === null ? null : ratio(mean * Math.sqrt(periodsPerYear), downside), exposureTime: ratio(exposureMs, end - start), averageTradeDurationHours: avg(trades.map(t => (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 3600000)), consecutiveWins, consecutiveLosses, monthlyReturns, drawdownCurve, assumptions: { periodsPerYear, riskFreeRate: 0, returnFrequency: 'observed-H1-candles', standardDeviation: 'sample', downsideDeviation: 'all-observations-zero-target', undefinedValue: null, grossProfitBasis: 'positive net trade PnL; grossTradingPnl excludes explicit commissions and swap', exposureBasis: 'elapsed-calendar-time' } };
}
export function robustnessWarnings(result, metrics) {
  const warnings = [];
  if (result.strategy.id === 'buy-hold') warnings.push('LEGACY_BUY_HOLD_IS_RISK_MANAGED_HOLD');
  if (result.equityCurve.length < 6048) warnings.push('SHORT_HISTORY_ANNUALIZED_RATIOS_ARE_DESCRIPTIVE');
  if (result.dataset.warnings?.length) warnings.push('IRREGULAR_CALENDAR_ANNUALIZATION_ASSUMPTION');
  if (metrics.totalTrades < 30) warnings.push('FEW_TRADES');
  const gains = result.trades.filter(t => t.netPnl > 0).map(t => t.netPnl);
  if (gains.length && Math.max(...gains) / gains.reduce((s, x) => s + x, 0) > .5) warnings.push('CONCENTRATED_GAINS');
  if (!result.config.costs.spreadPips || !result.config.costs.slippagePips) warnings.push('ZERO_EXECUTION_COST_ASSUMPTION');
  if (result.dataset.synthetic) warnings.push('SYNTHETIC_DATA_NOT_MARKET_EVIDENCE');
  return warnings;
}
