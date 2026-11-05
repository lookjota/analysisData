import { normalizeQuoteBars } from './prices.js';
import { marketSession, CALENDAR_VERSION } from '../calendar/forex.js';
import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

export const FIELDS = ['instrument', 'timeframe', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'source', 'synthetic'];
const HOUR = 3600000;
const fail = code => {
  const error = new Error(code);
  const classification = ({ DUPLICATE_TIMESTAMP: 'DUPLICATE_CANDLE', UNORDERED_TIMESTAMP: 'OUT_OF_ORDER', TIMEZONE_REQUIRED: 'INVALID_TIMESTAMP', INVALID_CLOCK_TIME: 'INVALID_TIMESTAMP', INVALID_TIMESTAMP: 'INVALID_TIMESTAMP', INVALID_CALENDAR_DATE: 'INVALID_TIMESTAMP', H1_ALIGNMENT_REQUIRED: 'INVALID_TIMESTAMP' })[code];
  if (classification) error.classification = classification;
  throw error;
};
export function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail('TIMEZONE_REQUIRED');
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail('INVALID_CLOCK_TIME');
  const date = new Date(value);
  if (!Number.isFinite(+date)) fail('INVALID_TIMESTAMP');
  // Reject calendar overflow (e.g. February 30), including offset timestamps.
  const calendar = value.slice(0, 10);
  const probe = new Date(`${calendar}T00:00:00Z`);
  if (probe.toISOString().slice(0, 10) !== calendar) fail('INVALID_CALENDAR_DATE');
  return date.toISOString();
}
export function normalizeCandle(raw, { strict = false } = {}) {
  if (strict && raw && Object.keys(raw).some(k => ![...FIELDS, "quoteBars"].includes(k))) fail("UNKNOWN_CANDLE_FIELD");
  if (!raw || typeof raw !== 'object') fail('INVALID_CANDLE');
  if (raw.instrument !== 'EUR/USD' || raw.timeframe !== 'H1') fail('UNSUPPORTED_MARKET');
  if (typeof raw.source !== 'string' || !/^[\w .:/-]{1,100}$/.test(raw.source) || typeof raw.synthetic !== 'boolean') fail('PROVENANCE_REQUIRED');
  const c = { instrument: raw.instrument, timeframe: raw.timeframe, timestamp: timestamp(raw.timestamp), source: raw.source, synthetic: raw.synthetic };
  if (Date.parse(c.timestamp) % HOUR) fail('H1_ALIGNMENT_REQUIRED');
  for (const key of ['open', 'high', 'low', 'close']) {
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || raw[key] <= 0) fail('INVALID_PRICE');
    c[key] = raw[key];
  }
  if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || c.low > c.high) fail('INCONSISTENT_OHLC');
  if (raw.volume !== undefined && raw.volume !== null) {
    if (!Number.isFinite(raw.volume) || raw.volume < 0) fail('INVALID_VOLUME');
    c.volume = raw.volume;
  }
  // A single bid/ask snapshot has no intrabar semantics: explicitly unsupported.
  if (raw.bid !== undefined || raw.ask !== undefined) fail('BID_ASK_OHLC_NOT_SUPPORTED');
  if (raw.quoteBars !== undefined) c.quoteBars = normalizeQuoteBars(raw.quoteBars);
  return Object.freeze(c);
}
function closedHour(ms) {
  const d = new Date(ms), day = d.getUTCDay(), hour = d.getUTCHours();
  return day === 6 || (day === 5 && hour >= 22) || (day === 0 && hour < 22);
}
export function validateDataset(rows, { asOf, sort = false, maxRows = 100000, calendarMode = 'legacy-utc22', calendar = {}, gapPolicy = 'warn', strict = false } = {}) {
  if (typeof strict !== 'boolean' || !['legacy-utc22', 'calendar-v1'].includes(calendarMode) || !['warn', 'reject'].includes(gapPolicy)) fail('INVALID_DATASET_OPTIONS');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100000 || typeof sort !== 'boolean') fail('INVALID_DATASET_OPTIONS');
  if (!Array.isArray(rows) || !rows.length || rows.length > maxRows) fail('INVALID_DATASET_SIZE');
  const candles = rows.map(c => normalizeCandle(c, { strict })), warnings = [], findings = [];
  const useCalendar = calendarMode === 'calendar-v1';
  if (useCalendar && calendar !== null) {
    if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar) || Object.keys(calendar).some(k => !['provider', 'version', 'closures', 'reducedDates', 'weeklyOpenHour', 'weeklyCloseHour', 'weeklyTimezone', 'exceptions'].includes(k))) fail('INVALID_CALENDAR_CONFIG');
    marketSession(candles[0].timestamp, calendar);
  }
  let totalMissing = 0, totalClosed = 0, totalUnknown = 0, gapBudget = 0;
  const cutoff = asOf === undefined ? Infinity : Date.parse(timestamp(asOf));
  if (sort) candles.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (let i = 0; i < candles.length; i++) {
    const t = Date.parse(candles[i].timestamp);
    if (t + HOUR > cutoff) fail('FUTURE_OR_INCOMPLETE_CANDLE');
    if (!i) continue;
    const previous = Date.parse(candles[i - 1].timestamp), delta = t - previous;
    if (delta === 0) fail('DUPLICATE_TIMESTAMP');
    if (delta < 0) fail('UNORDERED_TIMESTAMP');
    if (delta > HOUR) {
      let missing = 0, closed = 0, unknown = 0;
      // No unbounded iteration for malicious multi-century gaps.
      if (delta / HOUR > 24 * 366) fail('GAP_TOO_LARGE');
      gapBudget += delta / HOUR - 1;
      if (gapBudget > 100000) fail('CALENDAR_GAP_BUDGET_EXCEEDED');
      const counts = {};
      for (let x = previous + HOUR; x < t; x += HOUR) {
        if (!useCalendar) { closedHour(x) ? closed++ : missing++; continue; }
        const status = calendar === null ? 'UNKNOWN' : marketSession(new Date(x).toISOString(), calendar).status;
        const classification = ({ WEEKLY_CLOSED: 'EXPECTED_MARKET_CLOSURE', DECLARED_HOLIDAY: 'DECLARED_HOLIDAY', DECLARED_SCHEDULE_EXCEPTION: 'DECLARED_SCHEDULE_EXCEPTION', UNKNOWN: 'UNKNOWN_GAP' })[status] ?? 'MISSING_DATA';
        counts[classification] = (counts[classification] ?? 0) + 1;
        if (classification === 'MISSING_DATA') missing++;
        else if (classification === 'UNKNOWN_GAP') unknown++;
        else closed++;
      }
      for (const [classification, hours] of Object.entries(counts)) findings.push({ classification, hours, after: candles[i - 1].timestamp, before: candles[i].timestamp });
      totalMissing += missing; totalClosed += closed; totalUnknown += unknown;
      if (gapPolicy === 'reject' && (missing || unknown)) fail('DATA_QUALITY_REJECTED');
      warnings.push({ code: unknown ? 'UNKNOWN_GAP' : missing ? 'SESSION_GAP' : 'WEEKEND_CLOSURE', timestamp: candles[i].timestamp, missingHours: missing, closedHours: closed });
    }
  }
  // Hash canonical values, independent of object key order and CSV formatting.
  const contentHash = createHash('sha256').update(JSON.stringify(candles.map(c => c.quoteBars ? [...FIELDS.map(k => c[k] ?? null), c.quoteBars] : FIELDS.map(k => c[k] ?? null)))).digest('hex');
  return { temporal: { timestampConvention: 'bar-open', closeOffsetMs: HOUR, canonicalTimezone: 'UTC', sourceTimezone: 'UNKNOWN', calendarMode, calendarVersion: useCalendar && calendar !== null ? CALENDAR_VERSION : 'UNKNOWN', provider: useCalendar ? calendar?.provider ?? 'UNKNOWN' : 'UNKNOWN' }, quality: { status: totalMissing || totalUnknown || (useCalendar && calendar === null) ? 'WARNING' : 'PASS', missingHours: totalMissing, closedHours: totalClosed, unknownHours: totalUnknown, findings }, sessionMetadata: useCalendar ? candles.map(c => { const session = calendar === null ? null : marketSession(c.timestamp, calendar); return { openTimestamp: c.timestamp, closeTimestamp: new Date(Date.parse(c.timestamp) + HOUR).toISOString(), timeframe: c.timeframe, expectedSessionState: session?.status ?? 'UNKNOWN', sessionIdentifiers: session?.sessions ?? [], observedDuringClosure: session ? ['WEEKLY_CLOSED', 'DECLARED_HOLIDAY', 'DECLARED_SCHEDULE_EXCEPTION'].includes(session.status) : null }; }) : null, schemaVersion: candles.some(c => c.quoteBars) ? 'orion.candles.quotes.v2' : 'orion.candles.v1', candles, warnings, synthetic: candles.some(c => c.synthetic), sorted: sort, contentHash, hashAlgorithm: 'sha256', hashVersion: candles.some(c => c.quoteBars) ? 'orion.candles.canonical.quotes.v2' : 'orion.candles.canonical.v1' };
}
function csvLine(line) {
  const cells = []; let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted && line[i + 1] !== ',' && i + 1 !== line.length) fail('MALFORMED_CSV');
      else if (!quoted && cell.length) fail('MALFORMED_CSV');
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  if (quoted) fail('MULTILINE_CSV_UNSUPPORTED');
  cells.push(cell); return cells;
}
export const csvCell = value => {
  let s = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // Spreadsheet formula defense.
  return `"${s.replaceAll('"', '""')}"`;
};
export function exportCsv(candles) {
  if (candles.some(c => c.quoteBars)) throw new Error('QUOTE_BARS_REQUIRE_JSON');
  return [FIELDS.join(','), ...candles.map(c => FIELDS.map(k => csvCell(c[k])).join(','))].join('\n') + '\n';
}
export async function importCsv(path, options = {}) {
  // Open once, refuse symlinks and special files. Streaming with strict byte/row caps.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const rows = [];
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) fail('FILE_SIZE_OR_TYPE');
    const input = createInterface({ input: file.createReadStream({ autoClose: false }), crlfDelay: Infinity });
    let header, bytes = 0;
    for await (const line of input) {
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > 32 * 1024 * 1024 || line.length > 4096) fail('FILE_SIZE_OR_TYPE');
      if (!header) {
        header = csvLine(line.replace(/^\uFEFF/, ''));
        if (header.join(',') !== FIELDS.join(',')) fail('CSV_SCHEMA');
        continue;
      }
      const cells = csvLine(line);
      if (cells.length !== FIELDS.length) fail('CSV_COLUMN_COUNT');
      const row = Object.fromEntries(header.map((k, i) => [k, cells[i]]));
      for (const k of ['open', 'high', 'low', 'close']) {
        if (!row[k].trim()) fail('MISSING_PRICE');
        row[k] = Number(row[k]);
      }
      row.volume = row.volume === '' ? undefined : Number(row.volume);
      if (!['true', 'false'].includes(row.synthetic)) fail('SYNTHETIC_FLAG_REQUIRED');
      row.synthetic = row.synthetic === 'true'; rows.push(row);
      if (rows.length > (options.maxRows ?? 100000)) fail('INVALID_DATASET_SIZE');
    }
  } finally { await file.close(); }
  return validateDataset(rows, options);
}
export async function writeExclusive(path, content) {
  // Never overwrite existing inputs, secrets or user reports.
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(content); await file.sync(); }
  catch (error) { await file.close(); await unlink(path); throw error; }
  await file.close();
}
