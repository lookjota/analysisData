import { createHash } from 'node:crypto';
import { validateDataset, timestamp, writeExclusive } from './historical.js';
import { marketSession, CALENDAR_VERSION } from '../calendar/forex.js';
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
/** In-memory immutable metadata. Persist with exclusive creation; hash is not authenticity. */
export function datasetManifest(rows, { acquiredAt, license, rawFileHash = null, calendar = {}, requestedPeriod = null, calendarMode = 'legacy-utc22', gapPolicy = 'warn' } = {}) {
  const d = validateDataset(rows, { calendarMode, calendar, gapPolicy });
  if (calendarMode === 'legacy-utc22' && (calendar === null || Object.keys(calendar).some(k => !['version', 'closures', 'reducedDates'].includes(k)))) throw new Error('CALENDAR_V2_REQUIRES_EXPLICIT_MODE');
  const acquired = timestamp(acquiredAt);
  if (!license || typeof license !== 'object' || typeof license.reference !== 'string' || license.reference.length < 1 || license.reference.length > 500 || !['synthetic', 'local-use-authorized', 'unverified'].includes(license.status) || typeof license.redistributionAllowed !== 'boolean') throw new Error('LICENSE_METADATA_REQUIRED');
  if (rawFileHash !== null && !/^[a-f0-9]{64}$/.test(rawFileHash)) throw new Error('INVALID_RAW_HASH');
  if (!d.synthetic && license.status === 'synthetic') throw new Error('LICENSE_DATA_MISMATCH');
  let period = null;
  if (requestedPeriod) {
    period = { start: timestamp(requestedPeriod.start), end: timestamp(requestedPeriod.end) };
    if (period.start >= period.end) throw new Error('INVALID_REQUESTED_PERIOD');
  }
  const sessions = calendar === null ? [] : d.candles.map(c => marketSession(c.timestamp, calendar));
  let missingHours = 0, closedHours = 0;
  const gapHours = d.candles.slice(1).reduce((sum, c, i) => sum + (Date.parse(c.timestamp) - Date.parse(d.candles[i].timestamp)) / 3600000 - 1, 0);
  if (gapHours > 100000) throw new Error('CALENDAR_GAP_BUDGET_EXCEEDED');
  for (let i = 1; calendarMode === 'legacy-utc22' && i < d.candles.length; i++) {
    for (let ms = Date.parse(d.candles[i - 1].timestamp) + 3600000; ms < Date.parse(d.candles[i].timestamp); ms += 3600000) {
      const s = marketSession(new Date(ms).toISOString(), calendar ?? {}).status;
      if (s === 'WEEKLY_CLOSED' || s === 'DECLARED_HOLIDAY') closedHours++; else missingHours++;
    }
  }
  const quality = { missingHours, closedHours, recordsDuringClosure: sessions.filter(s => ['WEEKLY_CLOSED', 'DECLARED_HOLIDAY'].includes(s.status)).length, outsideRequestedPeriod: period ? d.candles.filter(c => c.timestamp < period.start || c.timestamp >= period.end).length : 0, corrections: [], warnings: ['MID_ONLY_NO_OBSERVED_BID_ASK', 'SOURCE_METADATA_IS_A_DECLARATION_NOT_AUTHENTICITY_PROOF', ...(!d.synthetic && license.status === 'unverified' ? ['LICENSE_UNVERIFIED'] : [])] };
  const body = { schemaVersion: 'orion.dataset-manifest.v1', datasetId: `sha256-${d.contentHash}`, instrument: 'EUR/USD', timeframe: 'H1', sources: [...new Set(d.candles.map(c => c.source))], synthetic: d.synthetic, acquiredAt: acquired, license: { status: license.status, reference: license.reference, redistributionAllowed: license.redistributionAllowed }, coverage: { start: d.candles[0].timestamp, end: d.candles.at(-1).timestamp, timestampConvention: 'bar-open', recordCount: d.candles.length }, rawFileHash, canonicalContentHash: d.contentHash, hashVersion: d.hashVersion, transformationVersion: 'normalize-candle-v1', dataSchemaVersion: d.schemaVersion, calendar: { version: CALENDAR_VERSION, closures: [...(calendar?.closures ?? [])], reducedDates: [...(calendar?.reducedDates ?? [])] }, requestedPeriod: period, quality };
  if (calendarMode === 'calendar-v1') {
    body.schemaVersion = 'orion.dataset-manifest.v2';
    body.calendar = calendar === null ? null : { ...structuredClone(calendar), version: CALENDAR_VERSION };
    body.validation = { calendarMode, gapPolicy };
    body.temporal = d.temporal;
    body.provenanceStatus = 'DECLARED';
    body.normalizationPolicy = 'normalize-candle-v1-no-fill';
    body.quality = { ...quality, ...d.quality, recordsDuringClosure: calendar === null ? null : sessions.filter(s => ['WEEKLY_CLOSED', 'DECLARED_HOLIDAY', 'DECLARED_SCHEDULE_EXCEPTION'].includes(s.status)).length };
  }
  return freeze({ ...body, manifestHash: digest(body) });
}
export function verifyManifest(rows, manifest) {
  if (!manifest || !['orion.dataset-manifest.v1', 'orion.dataset-manifest.v2'].includes(manifest.schemaVersion) || (manifest.calendar !== null && manifest.calendar?.version !== CALENDAR_VERSION) || manifest.transformationVersion !== 'normalize-candle-v1') throw new Error('MANIFEST_VERSION_MISMATCH');
  const expected = datasetManifest(rows, { acquiredAt: manifest.acquiredAt, license: manifest.license, rawFileHash: manifest.rawFileHash, calendar: manifest.calendar, requestedPeriod: manifest.requestedPeriod, ...manifest.validation });
  if (JSON.stringify(expected) !== JSON.stringify(manifest)) throw new Error('MANIFEST_INTEGRITY_MISMATCH');
  return true;
}
export async function writeManifest(path, manifest) {
  await writeExclusive(path, JSON.stringify(manifest, null, 2) + '\n');
}
