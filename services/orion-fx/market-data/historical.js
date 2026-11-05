import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

export const FIELDS = ['instrument', 'timeframe', 'timestamp', 'open', 'high', 'low', 'close', 'volume', 'source', 'synthetic'];
const HOUR = 3600000;
const fail = code => { throw new Error(code); };
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
export function normalizeCandle(raw) {
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
  return Object.freeze(c);
}
function closedHour(ms) {
  const d = new Date(ms), day = d.getUTCDay(), hour = d.getUTCHours();
  return day === 6 || (day === 5 && hour >= 22) || (day === 0 && hour < 22);
}
export function validateDataset(rows, { asOf, sort = false, maxRows = 100000 } = {}) {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100000 || typeof sort !== 'boolean') fail('INVALID_DATASET_OPTIONS');
  if (!Array.isArray(rows) || !rows.length || rows.length > maxRows) fail('INVALID_DATASET_SIZE');
  const candles = rows.map(normalizeCandle), warnings = [];
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
      let missing = 0, closed = 0;
      // No unbounded iteration for malicious multi-century gaps.
      if (delta / HOUR > 24 * 366) fail('GAP_TOO_LARGE');
      for (let x = previous + HOUR; x < t; x += HOUR) closedHour(x) ? closed++ : missing++;
      warnings.push({ code: missing ? 'SESSION_GAP' : 'WEEKEND_CLOSURE', timestamp: candles[i].timestamp, missingHours: missing, closedHours: closed });
    }
  }
  // Hash canonical values, independent of object key order and CSV formatting.
  const contentHash = createHash('sha256').update(JSON.stringify(candles.map(c => FIELDS.map(k => c[k] ?? null)))).digest('hex');
  return { schemaVersion: 'orion.candles.v1', candles, warnings, synthetic: candles.some(c => c.synthetic), sorted: sort, contentHash, hashAlgorithm: 'sha256', hashVersion: 'orion.candles.canonical.v1' };
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
