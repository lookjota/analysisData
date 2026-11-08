import { createHash, randomUUID } from 'node:crypto';
import { open, link, unlink, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, parse, join, dirname, basename } from 'node:path';
import { timestamp, normalizeCandle, validateDataset, importCsv } from './historical.js';
import { datasetManifest, verifyManifest } from './manifest.js';
import { normalizeQuoteBars } from './prices.js';
import { marketSession } from '../calendar/forex.js';

const HOUR = 3600000;
const SOURCE = 'Capital.com Demo historical API';
const calendar = { provider: 'Orion declared FX NY17 convention' };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw new Error(code); };

export function historyRange(from, to, asOf = new Date().toISOString()) {
  const start = timestamp(from), end = timestamp(to);
  const hours = (Date.parse(end) - Date.parse(start)) / HOUR;
  if (!from.endsWith('Z') || !to.endsWith('Z') || [start, end].some(t => Date.parse(t) % HOUR) ||
      !Number.isInteger(hours) || hours < 1 || hours > 100000 || Date.parse(end) > Date.parse(timestamp(asOf))) fail('INVALID_HISTORICAL_RANGE');
  return { start, end, hours };
}

export function parseHistoricalPrice(price) {
  if (!price || typeof price.snapshotTimeUTC !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z?$/.test(price.snapshotTimeUTC)) fail('INVALID_SOURCE_TIMESTAMP');
  if (price.snapshotTime !== undefined && (typeof price.snapshotTime !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?$/.test(price.snapshotTime))) fail('INVALID_SOURCE_TIMESTAMP');
  const quoteBars = {};
  for (const side of ['bid', 'ask']) {
    quoteBars[side] = Object.fromEntries(['open', 'high', 'low', 'close'].map(k => [k, price[`${k}Price`]?.[side]]));
  }
  normalizeQuoteBars(quoteBars);
  // For an aggregate, high-bid <= high-ask and low-bid <= low-ask are necessary,
  // but their differences are not contemporaneous spreads.
  if (['high', 'low'].some(k => quoteBars.bid[k] > quoteBars.ask[k])) fail('INVALID_AGGREGATE_SPREAD');
  const midpoint = Object.fromEntries(['open', 'high', 'low', 'close'].map(k => [k, quoteBars.bid[k] / 2 + quoteBars.ask[k] / 2]));
  return normalizeCandle({ instrument: 'EUR/USD', timeframe: 'H1',
    timestamp: timestamp(price.snapshotTimeUTC.endsWith('Z') ? price.snapshotTimeUTC : `${price.snapshotTimeUTC}Z`),
    ...midpoint, ...(price.lastTradedVolume === undefined ? {} : { volume: price.lastTradedVolume }),
    source: SOURCE, synthetic: false, quoteBars });
}

/** Caller authenticates explicitly. Never starts strategies, retries or interpolates. */
export async function acquireHistory(broker, { from, to, expectedAccountId, asOf = new Date().toISOString(),
  calendar: selectedCalendar = calendar, delayMs = 200, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const period = historyRange(from, to, asOf);
  const validation = { calendarMode: 'calendar-v1', calendar: selectedCalendar, gapPolicy: 'reject' };
  if (!Number.isInteger(delayMs) || delayMs < 100 || delayMs > 60000) fail('INVALID_RATE_LIMIT');
  // Pace all calls in this operation, including context and discovery.
  await sleep(delayMs);
  await broker.verifyContext(expectedAccountId);
  await sleep(delayMs);
  const instrument = await broker.findEurUsd({ metadata: true });
  const rows = [], sourceTimestamps = [], chunks = [];
  for (let start = Date.parse(period.start); start < Date.parse(period.end); start += 1000 * HOUR) {
    const end = Math.min(start + 1000 * HOUR, Date.parse(period.end));
    await sleep(delayMs);
    // Inclusive API endpoints, disjoint bar-open intervals, at most 1000 bars.
    const request = { from: new Date(start).toISOString(), to: new Date(end - HOUR).toISOString(), max: (end - start) / HOUR };
    const data = await broker.historicalCandles(instrument.epic, request);
    if (data?.resolution !== undefined && data.resolution !== 'HOUR') fail('UNSUPPORTED_RESOLUTION');
    if (!Array.isArray(data?.prices) || data.prices.length > request.max) fail('INVALID_HISTORY_RESPONSE');
    const parsed = data.prices.map(parseHistoricalPrice);
    if (parsed.some(c => Date.parse(c.timestamp) < start || Date.parse(c.timestamp) >= end)) fail('OUTSIDE_REQUESTED_RANGE');
    rows.push(...parsed);
    sourceTimestamps.push(...data.prices.map(p => ({ snapshotTimeUTC: p.snapshotTimeUTC, snapshotTime: p.snapshotTime ?? null })));
    chunks.push({ ...request, returned: parsed.length });
  }
  const dataset = validateDataset(rows, { ...validation, asOf });
  const observed = new Set(rows.map(c => c.timestamp));
  let closedHours = 0;
  // Check edges as well as interior gaps, including empty/partial chunks.
  for (let ms = Date.parse(period.start); ms < Date.parse(period.end); ms += HOUR) {
    const iso = new Date(ms).toISOString();
    if (observed.has(iso)) continue;
    if (['WEEKLY_CLOSED', 'DECLARED_HOLIDAY', 'DECLARED_SCHEDULE_EXCEPTION'].includes(marketSession(iso, selectedCalendar).status)) closedHours++;
    else fail('MISSING_REQUESTED_CANDLE');
  }
  const manifest = datasetManifest(dataset.candles, { ...validation, acquiredAt: asOf,
    requestedPeriod: period, license: { status: 'unverified', reference: 'Capital.com API account terms; local research only', redistributionAllowed: false } });
  const acquisition = { source: SOURCE, environment: 'demo', epic: instrument.epic,
    instrument: instrument.metadata, resolution: 'HOUR', requestedPeriod: { start: period.start, end: period.end },
    returnedPeriod: manifest.coverage, acquiredAt: asOf, sourceTimestamps, chunks,
    priceBasis: 'OBSERVED_BID_ASK', spreadClassification: 'CONTEMPORANEOUS_OPEN_CLOSE_ONLY',
    calendarIdentity: manifest.calendar, warnings: [...manifest.quality.warnings, 'CALENDAR_IS_DECLARED_NOT_BROKER_VERIFIED'], closedHours };
  const body = { schemaVersion: 'orion.capital-history.v1', candles: dataset.candles, manifest, acquisition };
  return { ...body, artifactHash: hash(body) };
}

export function verifyHistory(artifact, options = {}) {
  const { artifactHash, ...body } = artifact ?? {};
  if (body.schemaVersion !== 'orion.capital-history.v1' || hash(body) !== artifactHash) fail('HISTORY_INTEGRITY_MISMATCH');
  verifyManifest(body.candles, body.manifest);
  if (body.manifest.synthetic || body.candles.some(c => c.synthetic || c.source !== SOURCE || !c.quoteBars) ||
      body.acquisition?.environment !== 'demo' || body.acquisition?.priceBasis !== 'OBSERVED_BID_ASK') fail('HISTORY_PROVENANCE_MISMATCH');
  const period = body.manifest.requestedPeriod;
  if (!period || body.acquisition.resolution !== 'HOUR' || !/^[A-Za-z0-9_-]+$/.test(body.acquisition.epic) ||
      body.acquisition.requestedPeriod?.start !== period.start || body.acquisition.requestedPeriod?.end !== period.end ||
      (body.acquisition.registry && body.acquisition.registry.datasetId !== body.manifest.datasetId)) fail('HISTORY_IDENTITY_MISMATCH');
  historyRange(period.start, period.end, body.acquisition.acquiredAt);
  const observed = new Set(body.candles.map(c => c.timestamp));
  if (body.candles.some(c => c.timestamp < period.start || c.timestamp >= period.end || ['high', 'low'].some(k => c.quoteBars.bid[k] > c.quoteBars.ask[k]))) fail('HISTORY_PRICE_OR_RANGE_MISMATCH');
  for (let ms = Date.parse(period.start); ms < Date.parse(period.end); ms += HOUR) {
    const iso = new Date(ms).toISOString();
    if (!observed.has(iso) && !['WEEKLY_CLOSED', 'DECLARED_HOLIDAY', 'DECLARED_SCHEDULE_EXCEPTION'].includes(marketSession(iso, body.manifest.calendar).status)) fail('MISSING_REQUESTED_CANDLE');
  }
  // Integrity validation is never relaxed by research/import options.
  validateDataset(body.candles, { calendar: body.manifest.calendar, ...body.manifest.validation, asOf: body.acquisition.acquiredAt });
  return { ...validateDataset(body.candles, { calendar: body.manifest.calendar, ...body.manifest.validation, ...options }), manifest: body.manifest, acquisition: body.acquisition };
}

/** Reject symlinks in every existing component, including input ancestors. */
export async function safePath(path) {
  const target = resolve(path), root = parse(target).root;
  let current = root;
  const components = target.slice(root.length).split('/');
  for (let i = 0; i < components.length; i++) {
    current = join(current, components[i]);
    try { if ((await lstat(current)).isSymbolicLink()) fail('SYMLINK_FORBIDDEN'); }
    catch (error) { if (error.code === 'ENOENT' && i === components.length - 1) break; throw error; }
  }
  return target;
}

// Linux directory descriptors anchor every lookup against rename/symlink races.
async function anchoredParent(path) {
  const target = resolve(path);
  let directory = await open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const component of dirname(target).split('/').filter(Boolean)) {
      const next = await open(`/proc/self/fd/${directory.fd}/${component}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close();
      directory = next;
    }
    return { directory, target: `/proc/self/fd/${directory.fd}/${basename(target)}` };
  } catch (error) { await directory.close(); throw error; }
}

export async function saveHistory(path, artifact) {
  verifyHistory(artifact);
  return writeAtomicJson(path, artifact);
}

export async function writeAtomicJson(path, artifact) {
  const { directory, target } = await anchoredParent(path);
  const temporary = `${target}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(JSON.stringify(artifact, null, 2) + '\n');
    await file.sync();
    await file.close();
    await link(temporary, target); // Atomic publication; fails if target already exists.
    await directory.sync();
  } finally {
    if (file) { await file.close().catch(() => {}); await unlink(temporary); }
    await directory.close();
  }
}

export async function importDataset(path, options = {}) {
  if (path.endsWith('.csv')) return importCsv(path, options);
  if (!path.endsWith('.json')) fail('DATASET_FORMAT_REQUIRED');
  return verifyHistory(await readStoredJson(path), options);
}

export async function syncHistoryParent(path) {
  const { directory } = await anchoredParent(path);
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function readStoredJson(path) {
  const { directory, target } = await anchoredParent(path);
  let file;
  try {
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024) fail('FILE_SIZE_OR_TYPE');
    return JSON.parse(await file.readFile('utf8'));
  } finally { if (file) await file.close(); await directory.close(); }
}

/** SQLite supplies a process-scoped advisory publication lock, released on crash.
 * The catalog remains the immutable JSON files; this database stores no metadata.
 */
// Do not open/close another raw descriptor for an inode locked by this process:
// POSIX record locks can be released by closing any descriptor for that inode.
const publicationLocks = new Set();
export async function withHistoryPublicationLock(registry, operation) {
  const key = resolve(registry);
  if (publicationLocks.has(key)) fail('publication database is locked');
  publicationLocks.add(key);
  try { return await publicationLock(registry, operation); }
  finally { publicationLocks.delete(key); }
}
async function publicationLock(registry, operation) {
  const { directory, target } = await anchoredParent(join(registry, '.publication.sqlite'));
  let file, db;
  try {
    file = await open(target, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1) fail('UNSAFE_LOCK_FILE');
    // Close the creation descriptor before SQLite owns the inode's POSIX locks.
    await file.close(); file = undefined;
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(target);
    // Zero waiting: concurrent publishers fail and can be explicitly retried.
    db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;');
    try { return await operation(); }
    finally { db.exec('ROLLBACK;'); }
  } finally { if (db) db.close(); if (file) await file.close(); await directory.close(); }
}
