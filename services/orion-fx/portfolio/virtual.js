import { usdUnits, usdNumber, usdProduct, forexPnl } from '../financial/decimal.js';
const positive = x => Number.isFinite(x) && x > 0;
const nonnegative = x => (typeof x === 'bigint' ? x >= 0n : Number.isFinite(x) && x >= 0);
// BigInt inputs explicitly mean USD8 units; Numbers mean decimal USD.
const amountUnits = x => { const units = typeof x === 'bigint' ? x : usdUnits(x); usdNumber(units); return units; };
const validTime = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
export class VirtualPortfolio {
  #position = null;
  #trades = [];
  #ledger = [];
  #cash;
  #initial;
  #entryCommission = 0n;
  #swap = 0n;
  #margin = 0n;
  constructor(initialCapital) {
    if (!positive(initialCapital)) throw new Error('INVALID_CAPITAL');
    this.#initial = usdUnits(initialCapital); this.#cash = this.#initial;
    if (this.#cash <= 0n) throw new Error('INVALID_CAPITAL');
    Object.preventExtensions(this);
  }
  get initialCapital() { return usdNumber(this.#initial); }
  get position() { return this.#position ? { ...this.#position } : null; }
  get trades() { return this.#trades.slice(); }
  get ledger() { return this.#ledger.slice(); }
  updateTrailingStop(stop) {
    const p = this.#position;
    if (!p || p.stop === null || !positive(stop) || p.side * (stop - p.stop) < 0) throw new Error('INVALID_TRAILING_STOP');
    this.#position = { ...p, stop };
  }
  get cash() { return usdNumber(this.#cash); }
  #record(type, timestamp, amount, nextCash) {
    usdNumber(nextCash); // Check overflow before mutation.
    const event = Object.freeze({ type, timestamp, amount: usdNumber(amount), cash: usdNumber(nextCash), amountUsd8: String(amount), cashUsd8: String(nextCash) });
    // Prepare all throwing conversions/allocation before committing private state.
    this.#ledger.push(event);
    this.#cash = nextCash;
  }
  open({ side, entry, units, stopDistance, takeDistance, timestamp, margin, commission }) {
    if (this.#position) throw new Error('POSITION_ALREADY_OPEN');
    if (this.#ledger.length && Date.parse(timestamp) < Date.parse(this.#ledger.at(-1).timestamp)) throw new Error('INVALID_OPEN_CHRONOLOGY');
    if (![1, -1].includes(side) || !positive(entry) || !Number.isSafeInteger(units) || units < 1 || !((stopDistance === null && takeDistance === null) || [stopDistance, takeDistance].every(x => positive(x) && x < entry)) || !nonnegative(margin) || !nonnegative(commission) || !validTime(timestamp)) throw new Error('INVALID_OPEN');
    usdProduct(entry, units); const marginUnits = amountUnits(margin);
    const fee = amountUnits(commission);
    if (marginUnits + fee > this.#cash) throw new Error('INSUFFICIENT_MARGIN');
    const position = { side, entry, units, stop: stopDistance === null ? null : entry - side * stopDistance, take: takeDistance === null ? null : entry + side * takeDistance, openedAt: timestamp, margin: usdNumber(marginUnits), entryCommission: usdNumber(fee), swap: 0 };
    if (position.stop !== null && (!positive(position.stop) || !positive(position.take) || position.stop === entry || position.take === entry)) throw new Error('INVALID_PROTECTIVE_LEVEL');
    this.#record('OPEN', timestamp, -fee, this.#cash - fee);
    this.#entryCommission = fee; this.#swap = 0n; this.#margin = marginUnits; this.#position = position;
  }
  chargeSwap(amount, timestamp) {
    if (!this.#position || !nonnegative(amount) || !validTime(timestamp) || Date.parse(timestamp) < Date.parse(this.#position.openedAt) || Date.parse(timestamp) < Date.parse(this.#ledger.at(-1).timestamp)) throw new Error('INVALID_SWAP');
    const fee = amountUnits(amount), nextSwap = this.#swap + fee;
    usdNumber(nextSwap);
    this.#record('SWAP', timestamp, -fee, this.#cash - fee);
    this.#swap = nextSwap; this.#position.swap = usdNumber(nextSwap);
  }
  close(exit, timestamp, reason, commission) {
    const p = this.#position;
    if (typeof reason !== 'string' || !reason.length || reason.length > 200 || !p || !positive(exit) || !nonnegative(commission) || !validTime(timestamp) || Date.parse(timestamp) < Date.parse(p.openedAt) || Date.parse(timestamp) < Date.parse(this.#ledger.at(-1).timestamp)) throw new Error('INVALID_CLOSE');
    const gross = forexPnl(p.side, p.units, p.entry, exit), fee = amountUnits(commission);
    const net = gross - this.#entryCommission - fee - this.#swap;
    const trade = Object.freeze({ ...p, closedAt: timestamp, exit, reason, grossPnl: usdNumber(gross), exitCommission: usdNumber(fee), netPnl: usdNumber(net), netPnlUsd8: String(net) });
    const nextTrades = [...this.#trades, trade];
    this.#record('CLOSE', timestamp, gross - fee, this.#cash + gross - fee);
    this.#trades = nextTrades; this.#position = null; this.#margin = 0n;
    return trade;
  }
  snapshot(liquidationPrice, timestamp) {
    const p = this.#position;
    if (!positive(liquidationPrice) || !validTime(timestamp)) throw new Error('INVALID_MARK');
    if (this.#ledger.length && Date.parse(timestamp) < Date.parse(this.#ledger.at(-1).timestamp)) throw new Error('INVALID_MARK_CHRONOLOGY');
    // Exact integer reconciliation over private immutable records.
    if (this.#initial + this.#ledger.reduce((s, e) => s + BigInt(e.amountUsd8), 0n) !== this.#cash) throw new Error('ACCOUNTING_DIVERGENCE');
    const unrealized = p ? forexPnl(p.side, p.units, p.entry, liquidationPrice) : 0n;
    const equityUnits = this.#cash + unrealized;
    const equity = usdNumber(equityUnits), marginUnits = this.#margin, marginUsed = usdNumber(marginUnits);
    const exposureUnits = p ? usdProduct(p.units, liquidationPrice) : 0n;
    const exposure = usdNumber(exposureUnits), freeMarginUnits = equityUnits - marginUnits;
    if (![marginUsed, equity - marginUsed, exposure].every(Number.isFinite)) throw new Error('ACCOUNTING_DIVERGENCE');
    const realized = this.#trades.reduce((s, t) => s + BigInt(t.netPnlUsd8), 0n);
    if (this.#cash !== this.#initial + realized - (p ? this.#entryCommission + this.#swap : 0n)) throw new Error('ACCOUNTING_DIVERGENCE');
    return { timestamp, cash: this.cash, equity, unrealizedPnl: usdNumber(unrealized), realizedPnl: usdNumber(realized), marginUsed, freeMargin: usdNumber(freeMarginUnits), exposure, grossExposure: exposure, netExposure: p ? p.side * exposure : 0, exactUsd8: { cash: String(this.#cash), equity: String(equityUnits), unrealizedPnl: String(unrealized), realizedPnl: String(realized), marginUsed: String(marginUnits), freeMargin: String(freeMarginUnits), grossExposure: String(exposureUnits), netExposure: String(p ? BigInt(p.side) * exposureUnits : 0n) }, position: p ? { ...p } : null };
  }
}
