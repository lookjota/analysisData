import { priceModel } from '../market-data/prices.js';
import { datasetManifest } from '../market-data/manifest.js';
import { usdNumber, usdProduct } from '../financial/decimal.js';
import { marginConfig, assessMargin } from '../financial/margin.js';
import { validateDataset } from '../market-data/historical.js';
import { createStrategy } from '../strategies/research.js';
import { riskConfig, assessIntent } from '../risk/simulation.js';
import { VirtualPortfolio } from '../portfolio/virtual.js';
import { commissionFor, executionConfig, candleExecutionPrice, protectiveFill, PIP_SIZE } from '../execution/prices.js';

export function backtest(rows, { strategy = createStrategy(), initialCapital = 1000, costs: costOptions = {}, risk: riskOptions = {}, closeAtEnd = true, trailingDistance = null, allowSessionGaps = false, costSchedule = null, intrabarPolicy = 'stop-first', marginModel = null, dataValidation = {}, provenance = null, executionMode, evaluation = null } = {}) {
  const data = validateDataset(rows, dataValidation);
  const model = priceModel(data.candles, executionMode);
  if (model.mode === 'OBSERVED_BID_ASK' && costOptions.spreadPips) throw new Error('OBSERVED_SPREAD_ALREADY_INCLUDED');
  const evaluationStart = evaluation?.start ?? 0, evaluationEnd = evaluation?.end ?? data.candles.length;
  if (![evaluationStart, evaluationEnd].every(Number.isSafeInteger) || evaluationStart < 0 || evaluationEnd <= evaluationStart || evaluationEnd > data.candles.length) throw new Error('INVALID_EVALUATION_WINDOW');
  if (!strategy || typeof strategy.signal !== 'function' || typeof strategy.id !== 'string') throw new Error('INVALID_STRATEGY');
  const requiredWarmup = strategy.warmup ?? 0;
  if (!Number.isSafeInteger(requiredWarmup) || requiredWarmup < 0) throw new Error('INVALID_STRATEGY_WARMUP');
  if (!Number.isFinite(initialCapital) || initialCapital <= 0 || typeof closeAtEnd !== 'boolean' || typeof allowSessionGaps !== 'boolean' || (trailingDistance !== null && (!Number.isFinite(trailingDistance) || trailingDistance <= 0))) throw new Error('INVALID_SIMULATION_CONFIG');
  if (data.warnings.some(w => ['SESSION_GAP', 'UNKNOWN_GAP'].includes(w.code)) && !allowSessionGaps) throw new Error('SESSION_GAP_REQUIRES_ACKNOWLEDGEMENT');
  const manifest = provenance === null ? null : datasetManifest(data.candles, { ...provenance, ...dataValidation });
  if (!['stop-first', 'reject-ambiguous'].includes(intrabarPolicy)) throw new Error('INVALID_INTRABAR_POLICY');
  const risk = riskConfig(riskOptions), baseCosts = executionConfig({ ...(model.mode === 'OBSERVED_BID_ASK' ? { spreadPips: 0 } : {}), ...costOptions }), portfolio = new VirtualPortfolio(initialCapital);
  const marginRules = marginModel === null ? null : marginConfig(marginModel);
  if (costSchedule !== null && (!Array.isArray(costSchedule) || costSchedule.length !== data.candles.length)) throw new Error('INVALID_COST_SCHEDULE');
  const schedule = costSchedule?.map(c => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('INVALID_COST_SCHEDULE');
    if (model.mode === 'OBSERVED_BID_ASK' && c.spreadPips) throw new Error('OBSERVED_SPREAD_ALREADY_INCLUDED');
    return executionConfig({ ...baseCosts, ...c });
  }) ?? null;
  let costs = baseCosts;
  let currentCandle, fillField = 'open';
  const fillCosts = (side, executedPrice, units, commission, reason = null) => {
    const unknownIntrabarSpread = currentCandle.quoteBars && ['stop-loss', 'take-profit'].includes(reason);
    const spread = currentCandle.quoteBars ? currentCandle.quoteBars.ask[fillField] - currentCandle.quoteBars.bid[fillField] : costs.spreadPips * PIP_SIZE;
    return { requestedPrice: executedPrice + side * costs.slippagePips * PIP_SIZE, requestedPriceBasis: unknownIntrabarSpread ? 'protective-executable-level-before-slippage' : 'executable-quote-before-slippage', executedPrice,
      orderSide: side === -1 ? 'BUY' : 'SELL', executableQuote: executedPrice + side * costs.slippagePips * PIP_SIZE,
      quoteTimestamp: unknownIntrabarSpread ? null : currentCandle.timestamp, source: currentCandle.source, executionMode: model.mode, spreadBasis: unknownIntrabarSpread ? 'UNKNOWN_AT_PROTECTIVE_LEVEL' : currentCandle.quoteBars ? (fillField === 'close' ? 'OBSERVED_CLOSE' : 'OBSERVED_OPEN_REFERENCE_NOT_INTRABAR') : 'ASSUMED_SPREAD',
      spreadCostUsd: unknownIntrabarSpread ? null : usdNumber(usdProduct(units, spread, .5)), slippageCostUsd: usdNumber(usdProduct(units, costs.slippagePips, PIP_SIZE)), commissionUsd: commission };
  };
  initialCapital = portfolio.initialCapital;
  const equityCurve = [], riskEvents = [], orders = [], fills = [], decisions = [];
  let pending = null, peak = initialCapital, dayStart = initialCapital, day = '', halted = false, blockedDay = null;
  const price = (candle, field, side, entering) => candleExecutionPrice(candle, field, side, entering, costs);
  const close = (exit, time, reason) => {
    const p = portfolio.position;
    const trade = portfolio.close(exit, time, reason, commissionFor(p.units, costs));
    fills.push({ timestamp: time, type: 'close', side: p.side, price: exit, units: p.units, ...fillCosts(p.side, exit, p.units, trade.exitCommission, reason), reason, realizedPnl: trade.netPnl, swap: trade.swap, finalCash: portfolio.cash });
    return trade;
  };
  for (let i = evaluationStart; i < evaluationEnd; i++) {
    const c = data.candles[i], time = c.timestamp;
    currentCandle = c; fillField = 'open';
    costs = schedule?.[i] ?? baseCosts;
    const currentDay = time.slice(0, 10);
    if (currentDay !== day) {
      day = currentDay;
      dayStart = portfolio.snapshot(portfolio.position ? price(c, 'open', portfolio.position.side, false) : c.open, time).equity;
    }
    if (portfolio.position && i > 0) {
      const nights = Math.floor(Date.parse(time) / 86400000) - Math.floor(Date.parse(data.candles[i - 1].timestamp) / 86400000);
      if (nights) portfolio.chargeSwap(usdProduct(portfolio.position.units, costs.swapPerUnitPerDay, nights), time);
      const gap = protectiveFill(portfolio.position, c, costs, true, intrabarPolicy);
      if (gap) close(gap.price, time, gap.reason);
    }
    let state = portfolio.snapshot(portfolio.position ? price(c, 'open', portfolio.position.side, false) : c.open, time);
    const marginState = marginRules ? assessMargin(state.equity, state.marginUsed, marginRules) : null;
    if (marginState?.status === 'MARGIN_CALL') riskEvents.push({ timestamp: time, code: 'MARGIN_CALL' });
    const drawdown = halted || state.equity <= peak * (1 - risk.maxDrawdownFraction), daily = blockedDay === day || state.equity <= dayStart * (1 - risk.dailyLossFraction), margin = marginRules ? marginState.status === 'STOP_OUT' : state.freeMargin < 0;
    if (drawdown || daily || margin) {
      const code = marginRules && margin ? 'STOP_OUT' : drawdown ? 'DRAWDOWN_LIMIT' : daily ? 'DAILY_LOSS_LIMIT' : 'MARGIN_LIMIT';
      if (portfolio.position) close(price(c, 'open', portfolio.position.side, false), time, code);
      if (drawdown) halted = true;
      if (daily) blockedDay = day;
      riskEvents.push({ timestamp: time, code });
    }
    if (pending && portfolio.position) {
      const p = portfolio.position;
      if ((pending.action === 'target' && pending.side !== p.side) || (p.side === 1 && pending.exitLong) || (p.side === -1 && pending.exitShort)) close(price(c, 'open', p.side, false), time, 'signal');
    }
    if (pending?.action === 'target' && !portfolio.position) {
      state = portfolio.snapshot(c.open, time);
      const entry = price(c, 'open', pending.side, true);
      const decision = assessIntent({ ...pending, entry, equity: state.equity, cash: state.cash, peak, dayStart, killSwitch: halted || daily || margin || blockedDay === day, fixedCost: 2 * Math.max(costs.commissionPerOrder, costs.minimumCommission), costPerUnit: 2 * costs.commissionPerUnit + ((c.quoteBars ? (c.quoteBars.ask.open - c.quoteBars.bid.open) / PIP_SIZE : costs.spreadPips) + 2 * costs.slippagePips) * PIP_SIZE }, risk);
      orders.push({ timestamp: time, signalTimestamp: data.candles[i - 1].timestamp, signalAvailableAt: new Date(Date.parse(data.candles[i - 1].timestamp) + 3600000).toISOString(), earliestEligibleExecutionTimestamp: time, ...pending, ...decision });
      if (decision.allowed) {
        portfolio.open({ ...pending, ...decision, entry, timestamp: time, commission: commissionFor(decision.units, costs) });
        fills.push({ timestamp: time, type: 'open', signalTimestamp: data.candles[i - 1].timestamp, signalAvailableAt: new Date(Date.parse(data.candles[i - 1].timestamp) + 3600000).toISOString(), earliestEligibleExecutionTimestamp: time, side: pending.side, units: decision.units, price: entry, ...fillCosts(-pending.side, entry, decision.units, portfolio.position.entryCommission) });
      } else riskEvents.push({ timestamp: time, code: decision.code });
    }
    if (portfolio.position) {
      const fill = protectiveFill(portfolio.position, c, costs, false, intrabarPolicy);
      if (fill) close(fill.price, time, fill.reason);
    }
    // Timestamp denotes candle close for marks, while candle timestamps denote opens.
    const closeTime = new Date(Date.parse(time) + 3600000).toISOString();
    fillField = 'close';
    if (i === evaluationEnd - 1 && closeAtEnd && portfolio.position) close(price(c, 'close', portfolio.position.side, false), closeTime, 'end-of-data');
    state = portfolio.snapshot(portfolio.position ? price(c, 'close', portfolio.position.side, false) : c.close, closeTime);
    peak = Math.max(peak, state.equity);
    if (state.equity <= peak * (1 - risk.maxDrawdownFraction)) halted = true;
    if (state.equity <= dayStart * (1 - risk.dailyLossFraction)) blockedDay = day;
    equityCurve.push(state);
    if (portfolio.position && trailingDistance !== null) {
      const p = portfolio.position, candidate = price(c, 'close', p.side, false) - p.side * trailingDistance;
      if (p.side * (candidate - p.stop) > 0) portfolio.updateTrailingStop(candidate);
    }
    // Frozen closed prefix isolates future candles and prevents mutation of canonical data.
    const signal = i + 1 < requiredWarmup ? { action: 'hold' } : strategy.signal(Object.freeze(data.candles.slice(0, i + 1)));
    pending = signal && Object.freeze({ action: signal.action, side: signal.side, stopDistance: signal.stopDistance, takeDistance: signal.takeDistance, exitLong: signal.exitLong, exitShort: signal.exitShort });
    decisions.push({ signalTimestamp: time, signalAvailableAt: closeTime, indicatorReady: i + 1 >= requiredWarmup, tradingEligible: i + 1 >= requiredWarmup && i + 1 < evaluationEnd, earliestEligibleExecutionTimestamp: i + 1 < evaluationEnd ? data.candles[i + 1].timestamp : null, signal: pending });
    if (!pending || !['hold', 'target'].includes(pending.action) || (pending.action === 'target' && ![1, -1].includes(pending.side))) throw new Error('INVALID_STRATEGY_SIGNAL');
  }
  return { schemaVersion: 'orion.simulation.v1', simulatorVersion: '3.2.0-bc1', mode: 'backtest', tradingEnabled: false, strategy: { id: strategy.id, version: strategy.version, parameters: strategy.parameters }, config: { initialCapital, accountCurrency: 'USD', accounting: { version: 'usd8-v1', rounding: 'half-away-from-zero', maxScaledInteger: '9007199254740991' }, evaluation: { set: evaluation?.set ?? 'EXPLORATORY', contextStart: data.candles[0].timestamp, evaluationStart: data.candles[evaluationStart].timestamp, evaluationEnd: new Date(Date.parse(data.candles[evaluationEnd - 1].timestamp) + 3600000).toISOString(), warmupBars: evaluationStart, indicatorReady: evaluationStart + 1 >= requiredWarmup, tradingEligible: 'evaluated-close-to-next-open', pendingSignalPolicy: 'discard-context-signals', positionPolicy: 'start-flat', capitalPolicy: 'reset' }, executionModel: { ...model, version: 'explicit-h1-v2', signal: 'close-N/open-N+1', ambiguity: intrabarPolicy, liquidity: 'not-modeled-no-capacity-evidence', spread: model.mode === 'OBSERVED_BID_ASK' ? 'observed-per-bar-endpoints' : schedule ? 'declared-per-candle-schedule' : 'fixed', latency: 'next-open' }, marginModel: marginRules ? { version: 'fixed-entry-margin-v1', ...marginRules } : null, costs: baseCosts, costSchedule: schedule, risk, closeAtEnd, trailingDistance, allowSessionGaps }, dataset: { temporal: data.temporal, quality: data.quality, sessionMetadata: data.sessionMetadata, manifest, contentHash: data.contentHash, hashAlgorithm: data.hashAlgorithm, hashVersion: data.hashVersion, instrument: 'EUR/USD', timeframe: 'H1', synthetic: data.synthetic, sources: [...new Set(data.candles.map(c => c.source))], count: rows.length, start: data.candles[evaluationStart].timestamp, end: data.candles[evaluationEnd - 1].timestamp, warnings: data.warnings }, trades: portfolio.trades, ledger: portfolio.ledger, orders, fills, decisions, equityCurve, riskEvents };
}
