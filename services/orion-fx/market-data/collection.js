import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireHistory, historyRange, verifyHistory, saveHistory, readStoredJson, writeAtomicJson, safePath, syncHistoryParent, withHistoryPublicationLock } from './capital-history.js';
import { datasetManifest } from './manifest.js';
import { normalizeCandle, validateDataset } from './historical.js';
import { CALENDAR_VERSION, marketSession } from '../calendar/forex.js';

const HOUR = 3600000;
const CALENDAR = { provider: 'Orion declared FX NY17 convention' };
const VALIDATION = { calendarMode: 'calendar-v1', calendar: CALENDAR, gapPolicy: 'reject' };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw new Error(code); };
const seal = body => ({ ...body, integrityHash: digest(body) });
function unseal(value) {
  const { integrityHash, ...body } = value ?? {};
  if (digest(body) !== integrityHash) fail('COLLECTION_INTEGRITY_MISMATCH');
  return body;
}
const accountHash = (id, account) => digest([id, account]);
const closed = status => ['WEEKLY_CLOSED', 'DECLARED_HOLIDAY', 'DECLARED_SCHEDULE_EXCEPTION'].includes(status);
export function planWindows(from, to, windowHours = 168, asOf) {
  const period = historyRange(from, to, asOf);
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > 1000 || Math.ceil(period.hours / windowHours) > 1000) fail('INVALID_WINDOW_BOUND');
  const windows = [];
  for (let start = Date.parse(period.start); start < Date.parse(period.end); start += windowHours * HOUR) {
    windows.push({ from: new Date(start).toISOString(), to: new Date(Math.min(start + windowHours * HOUR, Date.parse(period.end))).toISOString() });
  }
  return windows;
}

function validateCalendar(calendar, time) {
  if (!calendar || Array.isArray(calendar) || Object.keys(calendar).some(k => !['provider', 'closures', 'reducedDates', 'weeklyOpenHour', 'weeklyCloseHour', 'weeklyTimezone', 'exceptions'].includes(k))) fail('INVALID_CALENDAR_CONFIG');
  marketSession(time, calendar);
}
export async function assertCollectionAccount(directory, expectedAccountId) {
  const { config } = await load(directory);
  if (typeof expectedAccountId !== 'string' || !expectedAccountId.trim() || accountHash(config.jobId, expectedAccountId) !== config.accountIdentity) fail('COLLECTION_ACCOUNT_MISMATCH');
}

/** Offline creation. An existing job directory is never reused or overwritten. */
export async function createCollection(directory, { from, to, expectedAccountId, windowHours = 168, delayMs = 200, retries = 2, retryMs = 1000, calendar = CALENDAR, asOf = new Date().toISOString() } = {}) {
  if (typeof expectedAccountId !== 'string' || !expectedAccountId.trim() || !Number.isInteger(delayMs) || delayMs < 100 || delayMs > 60000 || !Number.isInteger(retries) || retries < 0 || retries > 5 || !Number.isInteger(retryMs) || retryMs < 1000 || retryMs > 60000) fail('INVALID_COLLECTION_POLICY');
  validateCalendar(calendar, from);
  const windows = planWindows(from, to, windowHours, asOf);
  const id = randomUUID();
  const config = seal({ schemaVersion: 'orion.collection.v1', jobId: id, instrument: 'EUR/USD', timeframe: 'H1', environment: 'demo',
    createdAt: asOf, requestedPeriod: historyRange(from, to, asOf), accountIdentity: accountHash(id, expectedAccountId), calendar,
    windowHours, delayMs, retries, retryMs, windows });
  await safePath(directory);
  await mkdir(directory, { mode: 0o700 });
  await writeAtomicJson(join(directory, 'job.json'), config);
  return { jobId: id, windows: windows.length, state: 'STAGING' };
}

async function load(directory) {
  await safePath(directory);
  const config = await readStoredJson(join(directory, 'job.json'));
  unseal(config);
  if (config.schemaVersion !== 'orion.collection.v1' || config.instrument !== 'EUR/USD' || config.timeframe !== 'H1' || config.environment !== 'demo' ||
      JSON.stringify(planWindows(config.requestedPeriod.start, config.requestedPeriod.end, config.windowHours, config.createdAt)) !== JSON.stringify(config.windows)) fail('COLLECTION_IDENTITY_MISMATCH');
  validateCalendar(config.calendar, config.requestedPeriod.start);
  const names = (await readdir(directory)).filter(n => /^checkpoint-\d{6}\.json$/.test(n)).sort();
  if (names.length > 15000) fail('CHECKPOINT_LIMIT');
  let state = { sequence: 0, previous: config.integrityHash, windows: config.windows.map(() => ({ state: 'PENDING', attempts: 0 })), epic: null, publication: null };
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== checkpointName(i + 1)) fail('CHECKPOINT_SEQUENCE_GAP');
    const next = await readStoredJson(join(directory, names[i]));
    unseal(next);
    if (next.previous !== state.previous || next.jobId !== config.jobId || next.sequence !== i + 1 || next.windows.length !== config.windows.length ||
        next.windows.some(w => !['PENDING', 'RUNNING', 'ACQUIRED', 'CALENDAR_CLOSED', 'INTERRUPTED', 'REJECTED', 'UNAVAILABLE'].includes(w.state) || !Number.isInteger(w.attempts) || w.attempts < 0)) fail('CORRUPT_CHECKPOINT');
    state = { ...next, previous: next.integrityHash };
  }
  return { config, state };
}
const checkpointName = n => `checkpoint-${String(n).padStart(6, '0')}.json`;
async function checkpoint(directory, config, state) {
  if (state.sequence >= 14999) fail('CHECKPOINT_LIMIT');
  const body = { jobId: config.jobId, sequence: state.sequence + 1, previous: state.previous, windows: state.windows, epic: state.epic, publication: state.publication };
  const entry = seal(body);
  // Exclusive sequence creation arbitrates competing writers: a loser stops, never overwrites.
  await writeAtomicJson(join(directory, checkpointName(body.sequence)), entry);
  return { ...entry, previous: entry.integrityHash };
}
function coverage(candles, period, calendar = CALENDAR) {
  const observed = new Set(candles.map(c => c.timestamp));
  let closedHours = 0;
  for (let t = Date.parse(period.start); t < Date.parse(period.end); t += HOUR) {
    const iso = new Date(t).toISOString();
    if (!observed.has(iso)) {
      if (closed(marketSession(iso, calendar).status)) closedHours++;
      else fail('MISSING_REQUESTED_CANDLE');
    }
  }
  if (candles.some(c => c.timestamp < period.start || c.timestamp >= period.end)) fail('OUTSIDE_REQUESTED_RANGE');
  return closedHours;
}
const segmentName = hash => {
  if (!/^[a-f0-9]{64}$/.test(hash)) fail('INVALID_SEGMENT_REFERENCE');
  return `segment-${hash}.json`;
};
async function segments(directory, config, state, { partial = false } = {}) {
  const artifacts = [];
  for (let i = 0; i < state.windows.length; i++) {
    const w = state.windows[i], bounds = config.windows[i];
    if (w.state === 'CALENDAR_CLOSED') { coverage([], { start: bounds.from, end: bounds.to }, config.calendar); continue; }
    if (w.state !== 'ACQUIRED') { if (partial) continue; fail('COLLECTION_INCOMPLETE'); }
    const artifact = await readStoredJson(join(directory, segmentName(w.segment)));
    verifyHistory(artifact);
    if (artifact.artifactHash !== w.segment || artifact.acquisition.epic !== state.epic || artifact.manifest.requestedPeriod.start !== bounds.from || artifact.manifest.requestedPeriod.end !== bounds.to || JSON.stringify(artifact.manifest.calendar) !== JSON.stringify({ ...config.calendar, version: CALENDAR_VERSION })) fail('SEGMENT_IDENTITY_MISMATCH');
    coverage(artifact.candles, artifact.manifest.requestedPeriod, config.calendar);
    artifacts.push(artifact);
  }
  return artifacts;
}
export async function collectionStatus(directory, { verify = false } = {}) {
  const { config, state } = await load(directory);
  const complete = state.windows.every(w => ['ACQUIRED', 'CALENDAR_CLOSED'].includes(w.state));
  if (verify) await segments(directory, config, state, { partial: !complete });
  return { jobId: config.jobId, state: state.publication ? 'PUBLISHED' : complete ? 'READY' : 'STAGING', requestedPeriod: config.requestedPeriod,
    windows: state.windows.map((w, i) => ({ ...config.windows[i], ...w })), publication: state.publication, evidenceVerified: verify, coverageVerified: verify && complete };
}

/** Caller explicitly authenticates. No automatic authentication or session refresh. */
export async function resumeCollection(directory, broker, { expectedAccountId, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const { config, state: initial } = await load(directory);
  let state = initial;
  if (typeof expectedAccountId !== 'string' || !expectedAccountId.trim() || accountHash(config.jobId, expectedAccountId) !== config.accountIdentity) fail('COLLECTION_ACCOUNT_MISMATCH');
  if (state.publication || state.windows.every(w => ['ACQUIRED', 'CALENDAR_CLOSED'].includes(w.state))) {
    await segments(directory, config, state); return collectionStatus(directory);
  }
  await segments(directory, config, state, { partial: true });
  for (let i = 0; i < config.windows.length; i++) {
    let w = state.windows[i];
    if (['ACQUIRED', 'CALENDAR_CLOSED'].includes(w.state)) continue;
    if (['REJECTED', 'UNAVAILABLE'].includes(w.state)) fail('WINDOW_REQUIRES_NEW_JOB');
    const bounds = config.windows[i];
    let calendarClosed = false;
    try { coverage([], { start: bounds.from, end: bounds.to }, config.calendar); calendarClosed = true; } catch (e) { if (e.message !== 'MISSING_REQUESTED_CANDLE') throw e; }
    if (calendarClosed) { state.windows[i] = { state: 'CALENDAR_CLOSED', attempts: w.attempts }; state = await checkpoint(directory, config, state); continue; }
    // A process killed while RUNNING consumes an attempt. Resume stays bounded.
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      w = { state: 'RUNNING', attempts: w.attempts + 1 };
      state.windows[i] = w;
      state = await checkpoint(directory, config, state);
      let artifact;
      try {
        artifact = await acquireHistory(broker, { ...bounds, expectedAccountId, calendar: config.calendar, delayMs: config.delayMs, sleep });
        if (state.epic && state.epic !== artifact.acquisition.epic) fail('COLLECTION_INSTRUMENT_MISMATCH');
      } catch (error) {
        const transient = [429, 500, 502, 503, 504].includes(error.status) || ['TIMEOUT', 'NETWORK_ERROR'].includes(error.code);
        const missing = ['MISSING_REQUESTED_CANDLE', 'INVALID_DATASET_SIZE', 'DATA_QUALITY_REJECTED'].includes(error.message);
        const disposition = transient || [401, 403].includes(error.status) ? 'INTERRUPTED' : missing ? 'UNAVAILABLE' : 'REJECTED';
        // Never persist arbitrary upstream messages, URLs, tokens or stacks.
        w = { state: disposition, attempts: w.attempts, failure: transient ? 'TRANSIENT_BROKER_FAILURE' : missing ? 'INCOMPLETE_SOURCE_COVERAGE' : 'VALIDATION_OR_AUTHENTICATION_FAILURE', httpStatus: Number.isInteger(error.status) ? error.status : null };
        state.windows[i] = w; state = await checkpoint(directory, config, state);
        if (!transient || attempt >= config.retries) throw new Error('COLLECTION_WINDOW_FAILED');
        await sleep(Math.min(60000, config.retryMs * 2 ** attempt));
        continue;
      }
      // Storage errors leave RUNNING durable; never misclassify them as broker errors.
      const target = join(directory, segmentName(artifact.artifactHash));
      await saveHistory(target, artifact);
      state.epic = artifact.acquisition.epic;
      state.windows[i] = { state: 'ACQUIRED', attempts: w.attempts, segment: artifact.artifactHash };
      state = await checkpoint(directory, config, state);
      break;
    }
    if (state.windows[i].state !== 'ACQUIRED') fail('RETRY_BUDGET_EXHAUSTED');
  }
  await segments(directory, config, state);
  return collectionStatus(directory);
}

/** Deterministic canonical merge; acquisition envelope retains parent evidence. */
export function mergeHistory(artifacts, { requestedPeriod, acquiredAt = new Date().toISOString(), parentDatasetIds = [] } = {}) {
  if (!Array.isArray(artifacts) || !artifacts.length || artifacts.length > 1000) fail('INVALID_SEGMENTS');
  artifacts.forEach(a => verifyHistory(a));
  artifacts = [...artifacts].sort((a, b) => a.artifactHash.localeCompare(b.artifactHash));
  const first = artifacts[0];
  const contract = a => JSON.stringify([a.manifest.instrument, a.manifest.timeframe, a.manifest.dataSchemaVersion, a.manifest.hashVersion, a.manifest.transformationVersion, a.manifest.normalizationPolicy, a.manifest.temporal, a.manifest.calendar, a.manifest.license, a.acquisition.epic, a.acquisition.environment, a.acquisition.priceBasis]);
  if (artifacts.some(a => contract(a) !== contract(first))) fail('INCOMPATIBLE_SEGMENT_CONTRACT');
  const unique = new Map(), conflicts = new Set();
  for (const a of artifacts) for (const c of a.candles) {
    if (unique.has(c.timestamp) && JSON.stringify(normalizeCandle(unique.get(c.timestamp))) !== JSON.stringify(normalizeCandle(c))) conflicts.add(c.timestamp);
    else unique.set(c.timestamp, c);
  }
  if (conflicts.size) { const e = new Error('CONFLICTING_OVERLAP'); e.timestamps = [...conflicts].sort(); throw e; }
  const candles = [...unique.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const period = requestedPeriod ?? { start: artifacts.map(a => a.manifest.requestedPeriod.start).sort()[0], end: artifacts.map(a => a.manifest.requestedPeriod.end).sort().at(-1) };
  historyRange(period.start, period.end, acquiredAt);
  const closedHours = coverage(candles, period, first.manifest.calendar);
  validateDataset(candles, { ...VALIDATION, calendar: first.manifest.calendar, asOf: acquiredAt });
  const manifest = datasetManifest(candles, { ...VALIDATION, calendar: first.manifest.calendar, acquiredAt, requestedPeriod: period, license: first.manifest.license });
  if (!parentDatasetIds.every(id => /^sha256-[a-f0-9]{64}$/.test(id))) fail('INVALID_PARENT_DATASET');
  const acquisition = { ...first.acquisition, acquiredAt, requestedPeriod: period, returnedPeriod: manifest.coverage, closedHours,
    sourceTimestamps: artifacts.flatMap(a => a.acquisition.sourceTimestamps), chunks: artifacts.flatMap(a => a.acquisition.chunks),
    registry: { datasetId: manifest.datasetId, validationStatus: 'VERIFIED_DECLARED_CALENDAR', provenanceStatus: 'DECLARED',
      sourceFiles: artifacts.map(a => ({ filename: segmentName(a.artifactHash), artifactHash: a.artifactHash, datasetId: a.manifest.datasetId })).sort((a, b) => a.artifactHash.localeCompare(b.artifactHash)), parentDatasetIds: [...new Set(parentDatasetIds)].sort() } };
  const body = { schemaVersion: 'orion.capital-history.v1', candles, manifest, acquisition };
  return { ...body, artifactHash: digest(body) };
}
export async function publishCollection(directory, registry, options = {}) {
  return withHistoryPublicationLock(registry, () => publishLocked(directory, registry, options));
}
async function publishLocked(directory, registry, { parentDatasetIds = [] } = {}) {
  const { config, state: initial } = await load(directory);
  let state = initial;
  parentDatasetIds = state.publication?.parentDatasetIds ?? parentDatasetIds;
  const artifacts = await segments(directory, config, state);
  const artifact = mergeHistory(artifacts, { requestedPeriod: config.requestedPeriod, acquiredAt: artifacts.map(a => a.acquisition.acquiredAt).sort().at(-1) ?? config.createdAt, parentDatasetIds });
  await safePath(registry);
  const catalog = await registryArtifacts(registry);
  for (const id of parentDatasetIds) if (!catalog.some(a => a.manifest.datasetId === id)) fail('PARENT_DATASET_NOT_FOUND');
  const conflicts = catalog.flatMap(a => conflictingTimestamps(a, artifact).map(timestamp => ({ datasetId: a.manifest.datasetId, timestamp })));
  if (conflicts.some(c => !parentDatasetIds.includes(c.datasetId))) {
    const error = new Error('CONFLICTING_OVERLAP'); error.timestamps = [...new Set(conflicts.map(c => c.timestamp))].sort(); throw error;
  }
  const path = join(registry, `${artifact.manifest.datasetId}.json`);
  try { await saveHistory(path, artifact); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readStoredJson(path); verifyHistory(existing);
    if (existing.manifest.canonicalContentHash !== artifact.manifest.canonicalContentHash) fail('REGISTRY_IDENTITY_MISMATCH');
    // Same content has one identity. Keep the first immutable provenance envelope.
  }
  const existing = await readStoredJson(path); verifyHistory(existing);
  // Recovery may find a link whose previous directory fsync failed.
  await syncHistoryParent(path);
  if (!state.publication) {
    state.publication = { datasetId: existing.manifest.datasetId, artifactHash: existing.artifactHash, parentDatasetIds };
    state = await checkpoint(directory, config, state);
  } else if (state.publication.artifactHash !== existing.artifactHash) fail('PUBLICATION_IDENTITY_MISMATCH');
  return { datasetId: existing.manifest.datasetId, path, count: existing.candles.length, contentHash: existing.manifest.canonicalContentHash };
}

function conflictingTimestamps(left, right) {
  const observed = new Map(left.candles.map(c => [c.timestamp, JSON.stringify(normalizeCandle(c))]));
  return right.candles.filter(c => observed.has(c.timestamp) && observed.get(c.timestamp) !== JSON.stringify(normalizeCandle(c))).map(c => c.timestamp);
}
async function registryArtifacts(registry) {
  await safePath(registry);
  const names = (await readdir(registry)).filter(n => /^sha256-[a-f0-9]{64}\.json$/.test(n)).sort();
  if (names.length > 1000) fail('REGISTRY_SCAN_LIMIT');
  const artifacts = [];
  for (const name of names) {
    const a = await readStoredJson(join(registry, name)); verifyHistory(a);
    if (name !== `${a.manifest.datasetId}.json`) fail('REGISTRY_IDENTITY_MISMATCH');
    artifacts.push(a);
  }
  return artifacts;
}
export async function inspectRegistry(registry) {
  const artifacts = await registryArtifacts(registry), conflicts = [];
  if (artifacts.length > 100) fail('REGISTRY_PAIR_SCAN_LIMIT');
  for (let i = 0; i < artifacts.length; i++) for (let j = i + 1; j < artifacts.length; j++) {
    const timestamps = conflictingTimestamps(artifacts[i], artifacts[j]);
    if (timestamps.length) conflicts.push({ left: artifacts[i].manifest.datasetId, right: artifacts[j].manifest.datasetId, timestamps });
  }
  return { datasets: artifacts.map(a => ({ ...a.manifest, environment: a.acquisition.environment, registry: a.acquisition.registry })), conflicts };
}
