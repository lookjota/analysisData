import { timestamp } from '../market-data/historical.js';
const formatters = new Map();
function local(iso, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }));
  return Object.fromEntries(formatters.get(zone).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
}
export const CALENDAR_VERSION = 'fx-ny17-v1';
/** Declared research convention; actual source/broker schedules may differ. */
export function marketSession(value, { closures = [], reducedDates = [] } = {}) {
  const iso = timestamp(value);
  for (const list of [closures, reducedDates]) if (!Array.isArray(list) || list.length > 1000 || !list.every(x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && timestamp(`${x}T00:00:00Z`).slice(0, 10) === x)) throw new Error('INVALID_CALENDAR_DATES');
  const ny = local(iso, 'America/New_York'), london = local(iso, 'Europe/London'), asia = local(iso, 'Asia/Tokyo');
  const nyDate = `${ny.year}-${ny.month}-${ny.day}`;
  const weekend = ny.weekday === 'Sat' || (ny.weekday === 'Fri' && +ny.hour >= 17) || (ny.weekday === 'Sun' && +ny.hour < 17);
  const status = weekend ? 'WEEKLY_CLOSED' : closures.includes(nyDate) ? 'DECLARED_HOLIDAY' : reducedDates.includes(nyDate) ? 'REDUCED_LIQUIDITY' : 'OPEN';
  const sessions = [];
  if (status === 'OPEN' || status === 'REDUCED_LIQUIDITY') {
    if (+asia.hour >= 9 && +asia.hour < 18) sessions.push('ASIA');
    if (+london.hour >= 8 && +london.hour < 17) sessions.push('LONDON');
    if (+ny.hour >= 8 && +ny.hour < 17) sessions.push('NEW_YORK');
  }
  return { calendarVersion: CALENDAR_VERSION, timestamp: iso, status, sessions, overlap: sessions.length > 1, holidayConvention: 'explicit-New-York-local-dates', weeklyConvention: 'Sunday17-Friday17-America/New_York' };
}
