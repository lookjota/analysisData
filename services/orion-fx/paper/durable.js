import { openJournal, canonical, hash, projectJournalEvents } from '../persistence/journal.js';
import { riskConfig, assessIntent } from '../risk/simulation.js';
import { assessMargin } from '../financial/margin.js';
import { usdProduct } from '../financial/decimal.js';

const identifier = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
const iso = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const exactKeys = (value, keys) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join() !== keys.sort().join()) throw new Error('INVALID_REPLAY_INPUT');
};
function configuration(value) {
  exactKeys(value, ['sessionId','datasetIdentity','strategyIdentity','configurationIdentity','initialCapital','executionModelVersion','riskModelVersion','journalSchemaVersion','clockPolicy','recoveryPolicy','durabilityMode','risk','quotePolicy']);
  const c = JSON.parse(canonical(value));
  if (!identifier(c.sessionId) || !['datasetIdentity','strategyIdentity','configurationIdentity'].every(k => typeof c[k] === 'string' && /^[a-f0-9]{64}$/.test(c[k])) || c.durabilityMode !== 'DURABLE' || c.journalSchemaVersion !== 1 || c.executionModelVersion !== 'explicit-intent-v1' || c.riskModelVersion !== 'simulation-v1' || c.clockPolicy !== 'EXPLICIT_UTC' || c.recoveryPolicy !== 'VERIFY_FULL' || !Number.isFinite(c.initialCapital) || c.initialCapital <= 0) throw new Error('INVALID_REPLAY_CONFIGURATION');
  c.risk = { ...riskConfig(c.risk) };
  exactKeys(c.quotePolicy, ['maxAgeMs','maxSpread']);
  if (![c.quotePolicy.maxAgeMs,c.quotePolicy.maxSpread].every(x => Number.isFinite(x) && x > 0)) throw new Error('INVALID_QUOTE_POLICY');
  return c;
}
function validateInput(input) {
  const payloads = { mark: ['bid','ask','quoteTimestamp'], entry: ['side','stopDistance','takeDistance','commissionUsd8'], exit: ['reason','commissionUsd8'], swap: ['amountUsd8'], administrative: ['reason'] };
  exactKeys(input, ['sourceId','sequence','timestamp','kind','payload']);
  if (!identifier(input.sourceId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || !iso(input.timestamp) || !payloads[input.kind]) throw new Error('INVALID_REPLAY_INPUT');
  exactKeys(input.payload, payloads[input.kind]);
  for (const [key,value] of Object.entries(input.payload)) if (key.endsWith('Usd8') && (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value))) throw new Error('INVALID_USD8');
  canonical(input);
}
function verifyReplayHistory(events, c) {
  if (events[0]?.eventType !== 'SESSION_INITIALIZED' || events[0].payload.initialCapital !== c.initialCapital || events[1]?.eventType !== 'REPLAY_DECLARED' || canonical(events[1].payload.configuration) !== canonical(c)) throw new Error('REPLAY_CONFIGURATION_MISMATCH');
  const sources = new Set(); let sequence = 0;
  for (const event of events) {
    if (event.eventType !== 'REPLAY_INPUT') continue;
    const input = event.payload.input; validateInput(input);
    if (input.sequence !== ++sequence || sources.has(input.sourceId) || input.timestamp !== event.eventTimestamp) throw new Error('REPLAY_HISTORY_INCONSISTENT');
    sources.add(input.sourceId);
  }
}
function context(events, capital) {
  let peak = capital, dayStart = capital, day = '', quote = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.eventType === 'REPLAY_INPUT' && e.payload.input.kind === 'mark') quote = e.payload.input;
    if (e.eventType !== 'MARKET_MARKED') continue;
    const state = projectJournalEvents(events.slice(0,i + 1));
    if (day !== e.eventTimestamp.slice(0,10)) { day = e.eventTimestamp.slice(0,10); dayStart = i ? projectJournalEvents(events.slice(0,i)).equity : capital; }
    peak = Math.max(peak,state.equity);
  }
  return { peak, dayStart, day, quote };
}
function financialReason(state, ctx, c) {
  if (state.freeMargin < 0 || assessMargin(state.equity,state.marginUsed).status === 'STOP_OUT') return ['HALTED','MARGIN_LIMIT'];
  if (state.equity <= ctx.peak * (1-c.risk.maxDrawdownFraction)) return ['HALTED','DRAWDOWN_LIMIT'];
  if (state.equity <= ctx.dayStart * (1-c.risk.dailyLossFraction)) return ['PAUSED','DAILY_LOSS_LIMIT'];
  if (state.exposure > c.risk.maxExposure || state.exposure > Math.max(0,state.equity) * c.risk.leverage) return ['HALTED','EXPOSURE_LIMIT'];
  return null;
}
function quoteReason(input, timestamp, c) {
  if (!input) return ['PAUSED','MISSING_QUOTE'];
  const q = input.payload;
  if (![q.bid,q.ask].every(x => Number.isFinite(x) && x > 0) || q.ask < q.bid || !iso(q.quoteTimestamp) || q.quoteTimestamp > timestamp) return ['PAUSED','INVALID_QUOTE'];
  if (Date.parse(timestamp)-Date.parse(q.quoteTimestamp) > c.quotePolicy.maxAgeMs) return ['PAUSED','STALE_DATA'];
  if (q.ask-q.bid > c.quotePolicy.maxSpread) return ['PAUSED','EXCESSIVE_SPREAD'];
  return null;
}

/** Explicit-intent, offline streaming replay. No broker transport or financial cache. */
export async function openDurableReplay({ directory, filename, configuration: supplied, create = false }) {
  const c = configuration(supplied);
  let journal;
  try { journal = await openJournal(directory, filename); }
  catch (error) { throw new Error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'REPLAY_STORAGE_UNAVAILABLE'); }
  let lifecycle = 'NEW', diagnostic = null;
  lifecycle = create ? 'INITIALIZING' : 'RECOVERING';
  const envelope = (type,payload,time,sequence,eventId) => ({ eventId,sessionId:c.sessionId,sequence,eventType:type,eventTimestamp:time,schemaVersion:1,payload });
  try {
    journal.appendPlanned(c.sessionId, events => {
      if (!events.length) {
        if (!create) throw new Error('REPLAY_SESSION_MISSING');
        // Clock origin is explicit and fixed, not wall clock time.
        return [envelope('SESSION_INITIALIZED',{ initialCapital:c.initialCapital },'1970-01-01T00:00:00.000Z',1,'initialize'), envelope('REPLAY_DECLARED',{ configuration:c },'1970-01-01T00:00:00.000Z',2,'configuration')];
      }
      if (create) throw new Error('REPLAY_SESSION_EXISTS');
      verifyReplayHistory(events,c);
      return [];
    });
    journal.recover(c.sessionId);
    lifecycle = 'READY';
  } catch (error) { journal.close(); throw new Error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'REPLAY_OPEN_FAILED'); }
  function snapshot(events = null) {
    if (lifecycle === 'CLOSED') throw new Error('REPLAY_CLOSED');
    try {
      events ??= journal.events(c.sessionId);
      verifyReplayHistory(events,c);
      const state = projectJournalEvents(events);
      if (!state) throw new Error('REPLAY_SESSION_MISSING');
      return { ...state, durabilityMode:'DURABLE',sessionId:c.sessionId,datasetIdentity:c.datasetIdentity,executionModel:c.executionModelVersion,journalSchemaVersion:1,lifecycle,recoveryStatus:lifecycle === 'READY' ? 'VERIFIED' : 'REQUIRED',financialReconciliation:'VERIFIED',diagnostic };
    } catch { lifecycle = 'DEGRADED'; diagnostic = 'RECOVERY_REQUIRED'; throw new Error('REPLAY_STORAGE_FAILURE'); }
  }
  function submit(raw, administrative = false) {
    if (lifecycle !== 'READY') throw new Error('REPLAY_NOT_READY');
    const input = JSON.parse(canonical(raw)); validateInput(input);
    if (input.kind === 'administrative' && !administrative) throw new Error('ADMIN_REQUIRED');
    let businessFailure = false;
    try {
      const result = journal.appendPlanned(c.sessionId, (events, state) => {
        try {
          verifyReplayHistory(events,c);
          const inputs = events.filter(e => e.eventType === 'REPLAY_INPUT');
          const prior = inputs.find(e => e.payload.input.sourceId === input.sourceId);
          if (prior) { if (canonical(prior.payload.input) !== canonical(input)) throw new Error('REPLAY_INPUT_CONFLICT'); return []; }
          if (input.sequence !== inputs.length+1) throw new Error('REPLAY_SEQUENCE_CONFLICT');
          if (input.timestamp < events.at(-1).eventTimestamp) throw new Error('EVENT_TIME_REGRESSION');
          const additions = [];
          const add = (type,payload) => additions.push(envelope(type,payload,input.timestamp,events.length+additions.length+1,hash({ sourceId:input.sourceId,index:additions.length })));
          const ctx = context(events,c.initialCapital);
          if (ctx.day !== input.timestamp.slice(0,10)) ctx.dayStart = state.equity;
          add('REPLAY_INPUT',{ input });
          const transition = reason => {
            if (reason && state.riskState !== 'HALTED' && state.riskState !== reason[0]) {
              add('REPLAY_RISK_TRANSITION',{ previousRiskState:state.riskState,riskState:reason[0],reasonCode:reason[1],riskMetrics:{ equity:state.exactUsd8.equity,freeMargin:state.exactUsd8.freeMargin,exposure:state.exactUsd8.grossExposure,peak:ctx.peak,dayStart:ctx.dayStart },configurationHash:hash(c) });
              state = { ...state,riskState:reason[0] };
            }
          };
          const currentQuote = input.kind === 'mark' ? input : ctx.quote;
          let reason = financialReason(state,ctx,c) ?? quoteReason(currentQuote,input.timestamp,c);
          if (input.kind === 'mark') {
            if (!quoteReason(input,input.timestamp,c)) {
              const price = state.position?.side === -1 ? input.payload.ask : input.payload.bid;
              add('MARKET_MARKED',{ price });
              state = projectJournalEvents([...events,...additions]);
              if (ctx.day !== input.timestamp.slice(0,10)) ctx.dayStart = projectJournalEvents(events).equity;
              ctx.peak = Math.max(ctx.peak,state.equity);
              reason = financialReason(state,ctx,c);
            }
            transition(reason);
          } else if (input.kind === 'entry') {
            transition(reason);
            if (!reason && state.riskState === 'ACTIVE') {
              const p = input.payload, entry = p.side === -1 ? ctx.quote.payload.bid : ctx.quote.payload.ask;
              const decision = assessIntent({ ...p,entry,equity:state.equity,cash:state.cash,peak:ctx.peak,dayStart:ctx.dayStart,positions:state.position ? 1 : 0,costPerUnit:ctx.quote.payload.ask-ctx.quote.payload.bid,fixedCost:Number(BigInt(p.commissionUsd8))/1e8 },c.risk);
              if (decision.allowed) {
                add('VIRTUAL_POSITION_OPENED',{ side:p.side,entry,units:decision.units,stopDistance:p.stopDistance,takeDistance:p.takeDistance,marginUsd8:String(usdProduct(decision.units,entry,1/c.risk.leverage)),commissionUsd8:p.commissionUsd8 });
                add('MARKET_MARKED',{ price:p.side === -1 ? ctx.quote.payload.ask : ctx.quote.payload.bid });
              }
              add('REPLAY_OUTCOME',{ sourceId:input.sourceId,allowed:decision.allowed,reasonCode:decision.code });
            }
          else add('REPLAY_OUTCOME',{ sourceId:input.sourceId,allowed:false,reasonCode:reason?.[1] ?? 'RISK_BLOCKED' });
          } else if (input.kind === 'exit') {
            if (quoteReason(ctx.quote,input.timestamp,c)) throw new Error('INELIGIBLE_EXIT_QUOTE');
            add('VIRTUAL_POSITION_CLOSED',{ exit:state.position?.side === -1 ? ctx.quote.payload.ask : ctx.quote.payload.bid,...input.payload });
          } else if (input.kind === 'swap') add('VIRTUAL_SWAP_BOOKED',input.payload);
          else {
            if (reason || state.position || typeof input.payload.reason !== 'string' || !input.payload.reason.trim()) throw new Error('ADMINISTRATIVE_RECOVERY_UNSAFE');
            add('ADMINISTRATIVE_RESET',{ action:'LOCAL_ADMINISTRATIVE_RECOVERY',reason:input.payload.reason });
          }
          state = projectJournalEvents([...events,...additions]);
          transition(financialReason(state,ctx,c));
          return additions;
        } catch (error) { businessFailure = !['ACCOUNTING_DIVERGENCE','REPLAY_HISTORY_INCONSISTENT','REPLAY_CONFIGURATION_MISMATCH'].includes(error.message); throw error; }
      });
      return { ...result,lifecycle };
    } catch (error) {
      if (businessFailure) throw error;
      lifecycle = 'DEGRADED'; diagnostic = 'COMMIT_OUTCOME_REQUIRES_RECOVERY';
      throw new Error('REPLAY_STORAGE_FAILURE');
    }
  }
  return Object.freeze({
    submitMarketEvent: input => { if (input.kind !== 'mark') throw new Error('MARK_REQUIRED'); return submit(input); },
    submitVirtualIntent: input => { if (!['entry','exit','swap'].includes(input.kind)) throw new Error('INTENT_REQUIRED'); return submit(input); },
    administrativeRecover: input => { if (input.kind !== 'administrative') throw new Error('ADMIN_REQUIRED'); return submit(input,true); },
    getReplaySnapshot: () => snapshot(),
    getReplayReport() {
      if (lifecycle === 'CLOSED') throw new Error('REPLAY_CLOSED');
      let events;
      try { events = journal.events(c.sessionId); }
      catch { lifecycle = 'DEGRADED'; diagnostic = 'RECOVERY_REQUIRED'; throw new Error('REPLAY_STORAGE_FAILURE'); }
      const state = snapshot(events);
      return { ...state,mode:'paper-durable-explicit-intent',tradingEnabled:false,configurationHash:hash(c),
        riskTransitions:events.filter(e => e.eventType === 'REPLAY_RISK_TRANSITION'),
        rejectedVirtualIntents:events.filter(e => e.eventType === 'REPLAY_OUTCOME' && !e.payload.allowed),
        warnings:['DATASET PROVENANCE UNVERIFIED; fixtures require SYNTHETIC DATA labeling','Explicit intents only; strategy replay integration pending'] };
    },
    getRiskState: () => snapshot().riskState,
    recoverReplay() {
      if (lifecycle === 'CLOSED') throw new Error('REPLAY_CLOSED');
      lifecycle = 'RECOVERING';
      try { journal.recover(c.sessionId); lifecycle = 'READY'; diagnostic = null; return snapshot(); }
      catch { lifecycle = 'DEGRADED'; throw new Error('REPLAY_RECOVERY_FAILED'); }
    },
    closeReplay() { if (lifecycle !== 'CLOSED') { lifecycle = 'CLOSED'; journal.close(); } },
  });
}
