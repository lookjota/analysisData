export const riskDefaults = Object.freeze({ riskFraction: 0.005, maxRiskFraction: 0.01, dailyLossFraction: 0.02, maxDrawdownFraction: 0.10, maxExposure: 1000, leverage: 1, maxPositions: 1 });
export function riskConfig(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('INVALID_RISK_CONFIG');
  if (Object.keys(options).some(k => !Object.hasOwn(riskDefaults, k))) throw new Error('UNKNOWN_RISK_OPTION');
  const c = { ...riskDefaults, ...options };
  if (Object.values(c).some(x => !Number.isFinite(x) || x <= 0) || c.maxRiskFraction > 0.01 || c.riskFraction > c.maxRiskFraction || c.dailyLossFraction >= 1 || c.maxDrawdownFraction >= 1 || c.maxPositions !== 1 || c.leverage < 1) throw new Error('INVALID_RISK_CONFIG');
  return Object.freeze(c);
}
export function assessIntent({ side, entry, stopDistance, takeDistance, equity, cash, peak, dayStart, positions = 0, validData = true, killSwitch = false, costPerUnit = 0, fixedCost = 0 }, config = riskDefaults) {
  const reject = code => ({ allowed: false, code });
  try { config = riskConfig(config); } catch { return reject('INVALID_RISK_CONFIG'); }
  if (typeof validData !== 'boolean' || typeof killSwitch !== 'boolean' || !Number.isInteger(positions) || positions < 0) return reject('INVALID_INTENT');
  if (killSwitch || !validData) return reject('KILL_SWITCH');
  if (![entry, stopDistance, takeDistance, equity, cash, peak, dayStart].every(x => Number.isFinite(x) && x > 0) || ![1, -1].includes(side) || !Number.isFinite(costPerUnit) || costPerUnit < 0 || !Number.isFinite(fixedCost) || fixedCost < 0 || stopDistance >= entry || takeDistance >= entry) return reject('INVALID_INTENT');
  if (equity <= peak * (1 - config.maxDrawdownFraction)) return reject('DRAWDOWN_LIMIT');
  if (equity <= dayStart * (1 - config.dailyLossFraction)) return reject('DAILY_LOSS_LIMIT');
  if (positions >= config.maxPositions) return reject('POSITION_LIMIT');
  const riskBudget = equity * config.riskFraction;
  const riskUnits = Math.max(0, riskBudget - fixedCost) / (stopDistance + costPerUnit);
  const exposureUnits = config.maxExposure / entry;
  const marginUnits = Math.max(0, cash - fixedCost) / (entry / config.leverage + costPerUnit);
  const units = Math.floor(Math.min(riskUnits, exposureUnits, marginUnits));
  if (!Number.isSafeInteger(units) || !Number.isFinite(units * entry / config.leverage) || !Number.isFinite(units * (stopDistance + costPerUnit))) return reject('NUMERIC_LIMIT');
  if (units < 1) return reject('INSUFFICIENT_CAPITAL_OR_EXPOSURE');
  return { allowed: true, units, margin: units * entry / config.leverage, riskAmount: units * (stopDistance + costPerUnit) + fixedCost, code: 'ACCEPTED' };
}
