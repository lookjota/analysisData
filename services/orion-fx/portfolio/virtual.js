import { usdUnits, usdNumber, forexPnl } from '../financial/decimal.js';
const positive = x => Number.isFinite(x) && x > 0;
const nonnegative = x => Number.isFinite(x) && x >= 0;
const validTime = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
export class VirtualPortfolio {
  #cash;
  #initial;
  #entryCommission = 0n;
  #swap = 0n;
  constructor(initialCapital) {
    if (!positive(initialCapital)) throw new Error('INVALID_CAPITAL');
    this.#initial = usdUnits(initialCapital); this.#cash = this.#initial;
    if (this.#cash <= 0n) throw new Error('INVALID_CAPITAL');
    this.initialCapital = usdNumber(this.#initial); this.position = null; this.trades = []; this.ledger = [];
  }
  get cash() { return usdNumber(this.#cash); }
  #record(type, timestamp, amount, nextCash) {
    usdNumber(nextCash); // Check overflow before mutation.
    this.#cash = nextCash;
    this.ledger.push(Object.freeze({ type, timestamp, amount: usdNumber(amount), cash: this.cash, amountUsd8: String(amount), cashUsd8: String(nextCash) }));
  }
  open({ side, entry, units, stopDistance, takeDistance, timestamp, margin, commission }) {
    if (this.position) throw new Error('POSITION_ALREADY_OPEN');
    if (![1, -1].includes(side) || !positive(entry) || !Number.isSafeInteger(units) || units < 1 || !((stopDistance === null && takeDistance === null) || [stopDistance, takeDistance].every(x => positive(x) && x < entry)) || !nonnegative(margin) || !nonnegative(commission) || !validTime(timestamp)) throw new Error('INVALID_OPEN');
    usdUnits(entry * units); usdUnits(margin);
    const fee = usdUnits(commission);
    this.#record('OPEN', timestamp, -fee, this.#cash - fee);
    this.#entryCommission = fee; this.#swap = 0n;
    this.position = { side, entry, units, stop: stopDistance === null ? null : entry - side * stopDistance, take: takeDistance === null ? null : entry + side * takeDistance, openedAt: timestamp, margin, entryCommission: usdNumber(fee), swap: 0 };
  }
  chargeSwap(amount, timestamp) {
    if (!this.position || !nonnegative(amount) || !validTime(timestamp)) throw new Error('INVALID_SWAP');
    const fee = usdUnits(amount), nextSwap = this.#swap + fee;
    usdNumber(nextSwap);
    this.#record('SWAP', timestamp, -fee, this.#cash - fee);
    this.#swap = nextSwap; this.position.swap = usdNumber(nextSwap);
  }
  close(exit, timestamp, reason, commission) {
    const p = this.position;
    if (!p || !positive(exit) || !nonnegative(commission) || !validTime(timestamp) || Date.parse(timestamp) < Date.parse(p.openedAt)) throw new Error('INVALID_CLOSE');
    const gross = forexPnl(p.side, p.units, p.entry, exit), fee = usdUnits(commission);
    const net = gross - this.#entryCommission - fee - this.#swap;
    const trade = Object.freeze({ ...p, closedAt: timestamp, exit, reason, grossPnl: usdNumber(gross), exitCommission: usdNumber(fee), netPnl: usdNumber(net), netPnlUsd8: String(net) });
    this.#record('CLOSE', timestamp, gross - fee, this.#cash + gross - fee);
    this.trades.push(trade); this.position = null;
    return trade;
  }
  snapshot(liquidationPrice, timestamp) {
    const p = this.position;
    if (!positive(liquidationPrice) || !validTime(timestamp)) throw new Error('INVALID_MARK');
    // Exact integer reconciliation; corrupt public collections halt the simulation.
    if (this.#initial + this.ledger.reduce((s, e) => s + BigInt(e.amountUsd8), 0n) !== this.#cash) throw new Error('ACCOUNTING_DIVERGENCE');
    const unrealized = p ? forexPnl(p.side, p.units, p.entry, liquidationPrice) : 0n;
    const equity = usdNumber(this.#cash + unrealized), marginUsed = p?.margin ?? 0;
    const exposure = p ? p.units * liquidationPrice : 0;
    if (![marginUsed, equity - marginUsed, exposure].every(Number.isFinite)) throw new Error('ACCOUNTING_DIVERGENCE');
    const realized = this.trades.reduce((s, t) => s + BigInt(t.netPnlUsd8), 0n);
    if (this.#cash !== this.#initial + realized - (p ? this.#entryCommission + this.#swap : 0n)) throw new Error('ACCOUNTING_DIVERGENCE');
    return { timestamp, cash: this.cash, equity, unrealizedPnl: usdNumber(unrealized), realizedPnl: usdNumber(realized), marginUsed, freeMargin: equity - marginUsed, exposure, position: p ? { ...p } : null };
  }
}
