import { timestamp } from '../market-data/historical.js';
const formatters = new Map();
function local(iso, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }));
  return Object.fromEntries(formatters.get(zone).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
}
export const CALENDAR_VERSION = 'fx-ny17-v1';
/** Declared research convention; actual source/broker schedules may differ. */
export function marketSession(value, { closures = [], reducedDates = [], weeklyOpenHour = 17, weeklyCloseHour = 17, weeklyTimezone = 'America/New_York', exceptions = [], provider = 'UNKNOWN' } = {}) {
  const iso = timestamp(value);
  if (![weeklyOpenHour, weeklyCloseHour].every(x => Number.isInteger(x) && x >= 0 && x <= 23) || typeof provider !== 'string' || !/^[\w .:/-]{1,100}$/.test(provider) || !Array.isArray(exceptions) || exceptions.length > 1000) throw new Error('INVALID_CALENDAR_CONFIG');
  try { local(iso, weeklyTimezone); } catch { throw new Error('INVALID_CALENDAR_TIMEZONE'); }
  const intervals = exceptions.map(e => {
    if (!e || !['OPEN', 'CLOSED', 'REDUCED_LIQUIDITY'].includes(e.state)) throw new Error('INVALID_CALENDAR_EXCEPTION');
    const start = timestamp(e.start), end = timestamp(e.end);
    if (start >= end) throw new Error('INVALID_CALENDAR_EXCEPTION');
    return { start, end, state: e.state };
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (intervals.some((e, i) => i && e.start < intervals[i - 1].end)) throw new Error('OVERLAPPING_CALENDAR_EXCEPTIONS');
  for (const list of [closures, reducedDates]) if (!Array.isArray(list) || list.length > 1000 || !list.every(x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && timestamp(`${x}T00:00:00Z`).slice(0, 10) === x)) throw new Error('INVALID_CALENDAR_DATES');
  const ny = local(iso, 'America/New_York'), london = local(iso, 'Europe/London'), asia = local(iso, 'Asia/Tokyo');
  const nyDate = `${ny.year}-${ny.month}-${ny.day}`;
  const weekly = local(iso, weeklyTimezone);
  const weekend = weekly.weekday === 'Sat' || (weekly.weekday === 'Fri' && +weekly.hour >= weeklyCloseHour) || (weekly.weekday === 'Sun' && +weekly.hour < weeklyOpenHour);
  const exception = intervals.find(e => iso >= e.start && iso < e.end);
  const status = exception ? (exception.state === 'CLOSED' ? 'DECLARED_SCHEDULE_EXCEPTION' : exception.state) : weekend ? 'WEEKLY_CLOSED' : closures.includes(nyDate) ? 'DECLARED_HOLIDAY' : reducedDates.includes(nyDate) ? 'REDUCED_LIQUIDITY' : 'OPEN';
  const sessions = [];
  if (status === 'OPEN' || status === 'REDUCED_LIQUIDITY') {
    if (+asia.hour >= 9 && +asia.hour < 18) sessions.push('ASIA');
    if (+london.hour >= 8 && +london.hour < 17) sessions.push('LONDON');
    if (+ny.hour >= 8 && +ny.hour < 17) sessions.push('NEW_YORK');
  }
  return { provider, declaredScheduleException: Boolean(exception), calendarVersion: CALENDAR_VERSION, timestamp: iso, status, sessions, overlap: sessions.length > 1, holidayConvention: 'explicit-New-York-local-dates', weeklyConvention: `Sunday${weeklyOpenHour}-Friday${weeklyCloseHour}-${weeklyTimezone}` };
}
