import { CapitalDemoBroker } from '../brokers/capital-demo.js';
import { loadConfig } from '../config/index.js';
import { acquireHistory, verifyHistory, parseHistoricalPrice, writeAtomicJson, historyRange } from './capital-history.js';
import { timestamp } from './historical.js';
import { marketSession } from '../calendar/forex.js';
import { canonical, hash } from '../persistence/journal.js';
import { appendForwardObservations } from './forward-journal.js';

const HOUR = 3600000;
const fail = code => { throw new Error(code); };
const keys = (value, expected) => {
  if (!value || Object.keys(value).sort().join() !== [...expected].sort().join()) fail('INVALID_RECEIPT_SCHEMA');
};
const rawFields = ['snapshotTimeUTC', 'snapshotTime', 'openPrice', 'highPrice', 'lowPrice', 'closePrice', 'lastTradedVolume'];
function rawPrices(responses) {
  if (!Array.isArray(responses) || !responses.length) fail('INVALID_RECEIPT_PAYLOAD');
  return responses.flatMap(response => {
    keys(response, ['resolution', 'prices']);
    if (response.resolution !== 'HOUR' || !Array.isArray(response.prices)) fail('INVALID_RECEIPT_PAYLOAD');
    return response.prices.map(price => {
      if (!price || Object.keys(price).some(k => !rawFields.includes(k))) fail('INVALID_RECEIPT_PAYLOAD');
      for (const k of ['openPrice', 'highPrice', 'lowPrice', 'closePrice']) keys(price[k], ['bid', 'ask']);
      return parseHistoricalPrice(price);
    });
  });
}
function metadata(history, responses, publicationDelayMs) {
  const data = verifyHistory(history), a = history.acquisition;
  if (!Number.isSafeInteger(publicationDelayMs) || publicationDelayMs < 0 || publicationDelayMs > HOUR) fail('INVALID_PUBLICATION_DELAY');
  const acquiredAt = timestamp(a.acquiredAt);
  if (acquiredAt !== timestamp(history.manifest.acquiredAt)) fail('RECEIPT_ACQUISITION_TIME_MISMATCH');
  const parsed = rawPrices(responses);
  if (canonical(parsed) !== canonical(data.candles)) fail('RECEIPT_NORMALIZATION_MISMATCH');
  if (data.candles.some(c => ['WEEKLY_CLOSED', 'DECLARED_HOLIDAY', 'DECLARED_SCHEDULE_EXCEPTION'].includes(marketSession(c.timestamp, history.manifest.calendar).status))) fail('CLOSED_MARKET_CANDLE');
  if (data.candles.some(c => Date.parse(c.timestamp) + HOUR + publicationDelayMs > Date.parse(acquiredAt))) fail('INCOMPLETE_CANDLE');
  return {
    provider: 'Capital.com', environment: 'demo', instrument: 'EUR/USD', epic: a.epic,
    resolution: 'H1', timestampConvention: 'UTC_BAR_OPEN_EXISTING_ADAPTER_ASSUMPTION',
    requestedUTC: a.requestedPeriod, returnedUTC: data.candles.length ? {
      start: data.candles[0].timestamp,
      endExclusive: new Date(Date.parse(data.candles.at(-1).timestamp) + HOUR).toISOString(),
    } : null,
    acquiredAt, responseClassification: data.candles.length ? 'COMPLETED_HISTORY' : 'EMPTY_CLOSED_WINDOW',
    publicationDelayMs, publicationTimeEvidence: 'NOT_PROVIDED_BY_SOURCE_DELAY_POLICY_ONLY',
    rawPayloadDigest: hash(responses), normalizedPayloadDigest: hash(data.candles),
    datasetHash: data.contentHash, observationHashes: data.candles.map(hash),
    calendarIdentity: hash(history.manifest.calendar), quoteSides: 'BID_ASK_OHLC_COMPLETE',
    requestClassification: 'DEMO_SESSION_DISCOVERY_HISTORICAL_READ_LOGOUT',
    transportClassification: 'INJECTED_OFFLINE_FIXTURE', sourceAuthentication: 'UNVERIFIED_OFFLINE_FIXTURE',
    cryptographicSourceSignature: false, evidenceClassification: 'ENGINEERING_REPLAY',
    executionPriceClassification: 'HISTORICAL_H1_ENDPOINT_MODEL_ONLY',
    executableQuoteAvailable: false,
  };
}

/** Engineering collector only. There is intentionally no default network transport.
 * Hashes verify local consistency, never broker origin or publication time.
 */
export async function collectOfflineReceipt({ env, fetchImpl, from, to, asOf,
  publicationDelayMs = 60000, sleep = async () => {} }) {
  if (typeof fetchImpl !== 'function' || fetchImpl === globalThis.fetch) fail('OFFLINE_TRANSPORT_REQUIRED');
  if (!asOf || historyRange(from, to, asOf).hours > 100) fail('OFFLINE_RECEIPT_RANGE_LIMIT');
  const responses = [];
  const broker = new CapitalDemoBroker(loadConfig(env), { fetchImpl: async (url, options) => {
    const response = await fetchImpl(url, options);
    if (response.ok && new URL(url).pathname.startsWith('/api/v1/prices/')) {
      const data = await response.clone().json();
      // Preserve the provider's prices schema, not session headers or credentials.
      responses.push({ resolution: data.resolution ?? 'HOUR', prices: data.prices });
    }
    return response;
  } });
  try {
    await broker.authenticate();
    const history = await acquireHistory(broker, { from, to, asOf, expectedAccountId: env.CAPITAL_EXPECTED_ACCOUNT_ID, sleep });
    const body = { schemaVersion: 'orion.acquisition-receipt.v1', history, responses,
      metadata: metadata(history, responses, publicationDelayMs) };
    return { ...body, receiptHash: hash(body) };
  } catch { fail('OFFLINE_ACQUISITION_FAILED'); }
  finally { await broker.close(); }
}

export function verifyAcquisitionReceipt(receipt) {
  keys(receipt, ['schemaVersion', 'history', 'responses', 'metadata', 'receiptHash']);
  const { receiptHash, ...body } = receipt;
  if (body.schemaVersion !== 'orion.acquisition-receipt.v1' || hash(body) !== receiptHash) fail('RECEIPT_INTEGRITY_MISMATCH');
  if (canonical(body.metadata) !== canonical(metadata(body.history, body.responses, body.metadata?.publicationDelayMs))) fail('RECEIPT_PROVENANCE_MISMATCH');
  return { receiptHash, ...body.metadata, integrity: 'VERIFIED_LOCAL_CONTENT_ONLY', tradingEnabled: false, brokerExecution: 'DISABLED' };
}

export async function saveAcquisitionReceipt(path, receipt) {
  verifyAcquisitionReceipt(receipt);
  await writeAtomicJson(path, receipt);
}

/** No promotion to forward evidence, even if imported today. Journal v1 retains
 * exact receipt bytes by content address in a sidecar; financial engines unchanged.
 */
export async function appendReceiptObservations(directory, receipt, clock = () => new Date().toISOString()) {
  verifyAcquisitionReceipt(receipt);
  const { join } = await import('node:path');
  const { readStoredJson } = await import('./capital-history.js');
  const { inspectForwardJournal } = await import('./forward-journal.js');
  const state = await inspectForwardJournal(directory, clock);
  const { version, ...receiptCalendar } = receipt.history.manifest.calendar;
  if (canonical(state.config.calendar) !== canonical(receiptCalendar)) fail('RECEIPT_CALENDAR_MISMATCH');
  const path = join(directory, `receipt-${receipt.receiptHash}.json`);
  try { await saveAcquisitionReceipt(path, receipt); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (canonical(await readStoredJson(path)) !== canonical(receipt)) fail('RECEIPT_SIDECAR_CONFLICT');
  }
  const batch = receipt.history.candles.map(candle => ({ candle, classification: 'ENGINEERING_REPLAY',
    timestampConvention: 'UTC_BAR_OPEN', complete: true, observedAt: receipt.metadata.acquiredAt,
    acquiredAt: receipt.metadata.acquiredAt, sourceRevision: `receipt:${receipt.receiptHash}`,
    evidence: { content: candle, contentHash: hash(candle) } }));
  if (!batch.length) return state;
  // v1 journal batches are bounded to 100. A partial append is resumable by hash.
  let result;
  for (let i = 0; i < batch.length; i += 100) result = await appendForwardObservations(directory, batch.slice(i, i + 100), clock);
  return result;
}
