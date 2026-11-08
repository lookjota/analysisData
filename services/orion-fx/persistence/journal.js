import { DatabaseSync } from 'node:sqlite';
import { prepareSqlitePath } from '../security/sqlite-path.js';
import { createHash } from 'node:crypto';
import { realpathSync, lstatSync } from 'node:fs';
import { resolve, dirname, basename, sep } from 'node:path';
import { VirtualPortfolio } from '../portfolio/virtual.js';

export function canonical(value) {
  function encode(v, depth = 0) {
    if (depth > 30) throw new Error('PAYLOAD_DEPTH');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(x => encode(x, depth + 1)).join(',') + ']';
    if (v && Object.getPrototypeOf(v) === Object.prototype) return '{' + Object.keys(v).sort().map(k => {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('UNSAFE_KEY');
      return JSON.stringify(k) + ':' + encode(v[k], depth + 1);
    }).join(',') + '}';
    throw new Error('NON_CANONICAL_VALUE');
  }
  const text = encode(value);
  if (Buffer.byteLength(text) > 262144) throw new Error('PAYLOAD_TOO_LARGE');
  return text;
}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
const fields = (p, required) => {
  if (!p || Object.getPrototypeOf(p) !== Object.prototype || Object.keys(p).sort().join() !== [...required].sort().join()) throw new Error('INVALID_PAYLOAD_SCHEMA');
};
const schemas = {
  STRATEGY_APPEND_CHECKPOINT: ['index','planHash','pendingIntent','cursor'],
  STRATEGY_DECLARED: ['configuration'], STRATEGY_CHECKPOINT: ['index','planHash','pendingIntent'], STRATEGY_RECOVERED: ['count'], VIRTUAL_TRAILING_UPDATED: ['stop'],
  REPLAY_DECLARED: ['configuration'], REPLAY_INPUT: ['input'],
  REPLAY_OUTCOME: ['sourceId','allowed','reasonCode'],
  REPLAY_RISK_TRANSITION: ['previousRiskState','riskState','reasonCode','riskMetrics','configurationHash'],
  SESSION_INITIALIZED: ['initialCapital'], MARKET_MARKED: ['price'],
  VIRTUAL_POSITION_OPENED: ['side','entry','units','stopDistance','takeDistance','marginUsd8','commissionUsd8'],
  VIRTUAL_POSITION_CLOSED: ['exit','reason','commissionUsd8'], VIRTUAL_SWAP_BOOKED: ['amountUsd8'],
  RISK_PAUSED: ['trigger'], RISK_HALTED: ['trigger'], ADMINISTRATIVE_RESET: ['action','reason'],
};
function validate(e) {
  fields(e, ['eventId','sessionId','sequence','eventType','eventTimestamp','schemaVersion','payload']);
  if (!id(e.eventId) || !id(e.sessionId) || !Number.isSafeInteger(e.sequence) || e.sequence < 1 || e.schemaVersion !== 1 || !schemas[e.eventType] || typeof e.eventTimestamp !== 'string' || !Number.isFinite(Date.parse(e.eventTimestamp)) || new Date(e.eventTimestamp).toISOString() !== e.eventTimestamp) throw new Error('INVALID_EVENT');
  fields(e.payload, schemas[e.eventType]); canonical(e);
  for (const [k,v] of Object.entries(e.payload)) if (k.endsWith('Usd8') && (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(v))) throw new Error('INVALID_USD8');
}
export function projectJournalEvents(events) {
  let portfolio, risk = 'ACTIVE', mark = null, time = null;
  for (const e of events) {
    validate(e);
    if (time && e.eventTimestamp < time) throw new Error('EVENT_TIME_REGRESSION');
    const p = e.payload;
    if (!portfolio && e.eventType !== 'SESSION_INITIALIZED') throw new Error('SESSION_NOT_INITIALIZED');
    switch (e.eventType) {
      case 'STRATEGY_APPEND_CHECKPOINT': case 'STRATEGY_DECLARED': case 'STRATEGY_CHECKPOINT': case 'STRATEGY_RECOVERED':
      case 'REPLAY_DECLARED': case 'REPLAY_INPUT': case 'REPLAY_OUTCOME': break;
      case 'VIRTUAL_TRAILING_UPDATED': portfolio.updateTrailingStop(p.stop); break;
      case 'REPLAY_RISK_TRANSITION':
        if (p.previousRiskState !== risk || !['PAUSED','HALTED'].includes(p.riskState) || risk === 'HALTED' || typeof p.reasonCode !== 'string' || !/^[A-Z_]+$/.test(p.reasonCode) || !/^[a-f0-9]{64}$/.test(p.configurationHash)) throw new Error('INVALID_RISK_TRANSITION');
        risk = p.riskState; break;
      case 'SESSION_INITIALIZED': if (portfolio) throw new Error('ALREADY_INITIALIZED'); portfolio = new VirtualPortfolio(p.initialCapital); mark = 1; break;
      case 'MARKET_MARKED': portfolio.snapshot(p.price, e.eventTimestamp); mark = p.price; break;
      case 'VIRTUAL_POSITION_OPENED':
        if (risk !== 'ACTIVE') throw new Error('RISK_BLOCKED');
        portfolio.open({ ...p, margin: BigInt(p.marginUsd8), commission: BigInt(p.commissionUsd8), timestamp: e.eventTimestamp }); mark = p.entry; break;
      case 'VIRTUAL_POSITION_CLOSED': portfolio.close(p.exit, e.eventTimestamp, p.reason, BigInt(p.commissionUsd8)); mark = p.exit; break;
      case 'VIRTUAL_SWAP_BOOKED': portfolio.chargeSwap(BigInt(p.amountUsd8), e.eventTimestamp); break;
      case 'RISK_PAUSED': case 'RISK_HALTED':
        if (typeof p.trigger !== 'string' || !p.trigger.length || p.trigger.length > 200) throw new Error('INVALID_TRIGGER');
        if (risk !== 'HALTED') risk = e.eventType === 'RISK_HALTED' ? 'HALTED' : 'PAUSED'; break;
      case 'ADMINISTRATIVE_RESET':
        if (p.action !== 'LOCAL_ADMINISTRATIVE_RECOVERY' || typeof p.reason !== 'string' || !p.reason.trim()) throw new Error('ADMIN_REQUIRED'); risk = 'ACTIVE'; break;
    }
    time = e.eventTimestamp;
  }
  return portfolio ? { ...portfolio.snapshot(mark, time), ledger: portfolio.ledger, trades: portfolio.trades, riskState: risk, lastMarketMark: mark, sequence: events.length } : null;
}
// Share one SQLite connection per pathname in this process. In particular, a
// second consumer must not preflight-open/close an inode holding POSIX locks.
const openConnections = new Map();
function lease(entry) {
  entry.references++;
  let closed = false;
  return Object.freeze(Object.fromEntries(Object.entries(entry.api).map(([name, method])=>[name,
    name === 'close' ? () => {
      if (!closed) { closed = true; if (--entry.references === 0) { openConnections.delete(entry.path); entry.api.close(); } }
    } : function(...args) { if (closed) throw new Error('JOURNAL_CLOSED'); return method.apply(entry.api,args); }
  ])));
}
/** Local SQLite journal. No broker transport. Caller must supply a trusted private directory. */
export async function openJournal(directory, filename = 'orion.sqlite', { existingOnly = false } = {}) {
  if (basename(filename) !== filename || !/^[a-zA-Z0-9_-]+\.sqlite$/.test(filename)) throw new Error('UNSAFE_PATH');
  const root = resolve(directory);
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory() || root.split(sep).includes('freqtrade')) throw new Error('UNSAFE_DIRECTORY');
  const path = resolve(root, filename);
  const existing = openConnections.get(path);
  if (existing) { existing.verify(); return lease(existing); }
  const guard = prepareSqlitePath(path, { existingOnly });
  let db;
  try { db = new DatabaseSync(guard.target); guard.verify(); }
  catch (error) { if (db) db.close(); guard.close(); throw error; }
  try {
    db.exec('PRAGMA busy_timeout=1000;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 0 && version !== 1) throw new Error('UNSUPPORTED_STORAGE_VERSION');
    if (version === 0 && db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length) throw new Error('UNRECOGNIZED_DATABASE');
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    db.exec('CREATE TABLE IF NOT EXISTS events(session TEXT NOT NULL, sequence INTEGER NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(session,sequence), UNIQUE(session,id)); CREATE TABLE IF NOT EXISTS holdouts(scope TEXT NOT NULL, attempt INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, PRIMARY KEY(scope,attempt)); PRAGMA user_version=1;');
  } catch (error) { db.close(); guard.close(); throw error; }
  const read = session => {
    guard.verify();
    if (!id(session)) throw new Error('INVALID_SESSION');
    return db.prepare('SELECT * FROM events WHERE session=? ORDER BY sequence').all(session).map((r,i) => {
      const e = JSON.parse(r.body); validate(e);
      if (e.sessionId !== session || e.sequence !== i + 1 || r.sequence !== e.sequence || r.id !== e.eventId || hash(e) !== r.digest || canonical(e) !== r.body) throw new Error('JOURNAL_CORRUPTION');
      return e;
    });
  };
  const holdoutDigest = r => hash({ scope: r.scope, attempt: r.attempt, body: r.body, status: r.status, result: r.result });
  const transaction = fn => {
    guard.verify();
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); guard.verify(); db.exec('COMMIT'); return result; }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  };
  const api = Object.freeze({
    close: () => { try { db.close(); } finally { guard.close(); } },
    recover: session => projectJournalEvents(read(session)),
    events: session => structuredClone(read(session)),
    // Planner executes under the writer lock; financial projection precedes inserts.
    // No externally visible candidate state is returned until COMMIT succeeds.
    appendPlanned(session, planner, { beforeCommit = () => {} } = {}) {
      return transaction(() => {
        const events = read(session);
        const additions = planner(structuredClone(events), projectJournalEvents(events));
        if (!Array.isArray(additions)) throw new Error('INVALID_PLAN');
        additions.forEach((e, i) => {
          validate(e);
          if (e.sessionId !== session || e.sequence !== events.length + i + 1 ||
              [...events, ...additions.slice(0, i)].some(p => p.eventId === e.eventId)) throw new Error('SEQUENCE_CONFLICT');
        });
        const snapshot = projectJournalEvents([...events, ...additions]);
        for (const e of additions) db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(session,e.sequence,e.eventId,canonical(e),hash(e));
        beforeCommit();
        return { idempotent: additions.length === 0, snapshot };
      });
    },
    submit(event) {
      const body = canonical(event); const e = JSON.parse(body); validate(e);
      return transaction(() => {
        const events = read(e.sessionId), prior = events.find(x => x.eventId === e.eventId);
        if (prior) { if (canonical(prior) !== body) throw new Error('EVENT_ID_CONFLICT'); return { idempotent: true, snapshot: projectJournalEvents(events) }; }
        if (e.sequence !== events.length + 1) throw new Error('SEQUENCE_CONFLICT');
        const snapshot = projectJournalEvents([...events,e]);
        db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(e.sessionId,e.sequence,e.eventId,body,hash(e));
        return { idempotent: false, snapshot };
      });
    },
    holdoutStatus(scope) {
      return db.prepare('SELECT * FROM holdouts WHERE scope=? ORDER BY attempt').all(scope).map((r,i) => {
        const body = JSON.parse(r.body);
        if (holdoutDigest(r) !== r.digest || r.attempt !== i + 1 || hash(body.scope) !== scope || !['RESERVED','CONSUMED'].includes(r.status) || (r.status === 'RESERVED' ? r.result !== null : !/^[a-f0-9]{64}$/.test(r.result))) throw new Error('HOLDOUT_CORRUPTION');
        return { attempt: r.attempt, status: r.status, identity: body, result: r.result };
      });
    },
    reserveHoldout(scopeIdentity, frozen, allowReuse = false) {
      const scope = hash(scopeIdentity), body = canonical({ scope: scopeIdentity, frozen });
      return transaction(() => {
        const records = this.holdoutStatus(scope);
        if (records.length && !allowReuse) throw new Error('FINAL_HOLDOUT_ALREADY_CONSUMED');
        const attempt = records.length + 1;
        db.prepare('INSERT INTO holdouts VALUES(?,?,?,?,?,NULL)').run(scope,attempt,body,holdoutDigest({scope,attempt,body,status:'RESERVED',result:null}),'RESERVED');
        return { scope, attempt, reused: records.length > 0 };
      });
    },
    consumeHoldout({ scope, attempt }, resultIdentity) {
      if (!/^[a-f0-9]{64}$/.test(resultIdentity)) throw new Error('INVALID_RESULT_IDENTITY');
      return transaction(() => {
        this.holdoutStatus(scope);
        const row = db.prepare('SELECT * FROM holdouts WHERE scope=? AND attempt=?').get(scope,attempt);
        if (!row || (row.result && row.result !== resultIdentity)) throw new Error('HOLDOUT_RESULT_CONFLICT');
        db.prepare("UPDATE holdouts SET status='CONSUMED',result=?,digest=? WHERE scope=? AND attempt=?").run(resultIdentity,holdoutDigest({...row,status:'CONSUMED',result:resultIdentity}),scope,attempt);
      });
    },
  });
  const entry = { path, api, verify: guard.verify, references: 0 };
  openConnections.set(path, entry);
  return lease(entry);
}
