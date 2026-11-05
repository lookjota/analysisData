// Decimal arithmetic over the canonical decimal text of a finite Number.
// No binary subtraction/multiplication occurs before booking USD amounts.
export const USD_SCALE = 100000000n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function decimal(value) {
  if (!Number.isFinite(value)) throw new Error('INVALID_FINANCIAL_NUMBER');
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const fraction = mantissa.split('.')[1]?.length ?? 0;
  let coefficient = BigInt(mantissa.replace('.', ''));
  let scale = fraction - Number(exponent);
  if (scale < 0) { coefficient *= 10n ** BigInt(-scale); scale = 0; }
  return { coefficient, scale };
}
function quantize(coefficient, scale) {
  let units;
  if (scale <= 8) units = coefficient * 10n ** BigInt(8 - scale);
  else {
    const divisor = 10n ** BigInt(scale - 8), absolute = coefficient < 0n ? -coefficient : coefficient;
    units = (absolute + divisor / 2n) / divisor * (coefficient < 0n ? -1n : 1n);
  }
  if (units > MAX || units < -MAX) throw new Error('FINANCIAL_OVERFLOW');
  return units;
}
export function usdUnits(value) { const d = decimal(value); return quantize(d.coefficient, d.scale); }
export function usdNumber(units) {
  if (units > MAX || units < -MAX) throw new Error('FINANCIAL_OVERFLOW');
  return Number(units) / Number(USD_SCALE);
}
export function forexPnl(side, units, entry, exit) {
  if (![1, -1].includes(side) || !Number.isSafeInteger(units) || units < 1 || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || exit <= 0) throw new Error('INVALID_FOREX_PNL');
  const a = decimal(entry), b = decimal(exit), scale = Math.max(a.scale, b.scale);
  const difference = b.coefficient * 10n ** BigInt(scale - b.scale) - a.coefficient * 10n ** BigInt(scale - a.scale);
  return quantize(BigInt(side) * BigInt(units) * difference, scale);
}
