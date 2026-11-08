import { openJournal, canonical, hash, projectJournalEvents } from '../persistence/journal.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';
import { validateDataset } from '../market-data/historical.js';
import { priceModel } from '../market-data/prices.js';

const origin = '1970-01-01T00:00:00.000Z';
const clean = value => JSON.parse(JSON.stringify(value));
const sameRows = (a,b) => a.length === b.length && a.every((row,i) => canonical(row) === canonical(b[i]));
/** Bounded offline reference implementation. Reuses backtest and its USD8 ledger. */
export async function openStrategyReplay({ directory, filename = 'strategy.sqlite', sessionId, rows, options = {}, create = false }) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error('INVALID_SESSION');
  const allowed = ['strategyId','parameters','initialCapital','costs','risk','trailingDistance','intrabarPolicy','marginModel','dataValidation','provenance','executionMode','costSchedule'];
  if (Object.keys(options).some(k => !allowed.includes(k))) throw new Error('INVALID_STRATEGY_REPLAY_OPTIONS');
  // Freeze a local copy; caller mutations cannot alter a live session's identity.
  options = JSON.parse(canonical(options));
  const validation = { ...options.dataValidation, calendarMode:options.dataValidation?.calendarMode ?? 'calendar-v1', gapPolicy:'reject', maxRows:1000, sort:false, strict:true };
  if (validation.calendarMode !== 'calendar-v1' || validation.calendar === null) throw new Error('DURABLE_CALENDAR_REQUIRED');
  const data = validateDataset(rows,validation);
  if (data.sessionMetadata.some(s => s.observedDuringClosure)) throw new Error('CLOSED_MARKET_CANDLE');
  const candles = data.candles;
  priceModel(candles,options.executionMode);
  if (options.costSchedule != null && (!Array.isArray(options.costSchedule) || options.costSchedule.length !== candles.length)) throw new Error('INVALID_COST_SCHEDULE');
  const strategy = createStrategy(options.strategyId ?? 'trend',options.parameters ?? {});
  const base = { ...options, strategy, dataValidation:validation, closeAtEnd:false };
  delete base.strategyId; delete base.parameters;
  const reference = count => backtest(candles.slice(0,count), { ...base, costSchedule:base.costSchedule?.slice(0,count) ?? null }, { durableTrace:true });
  // Validate all configuration before creating a journal. The strategy sees only prefixes.
  const initial = reference(1);
  const configuration = clean({ version:'strategy-candle-v1',sessionId,datasetIdentity:data.contentHash,calendarIdentity:hash(validation),strategy:initial.strategy,config:initial.config,options });
  const configurationHash = hash(configuration);
  const journal = await openJournal(directory,filename);
  let lifecycle = 'RECOVERING';
  const envelope = (eventType,payload,eventTimestamp,sequence,eventId) => ({sessionId,eventType,payload,eventTimestamp,sequence,eventId,schemaVersion:1});
  const checkpoints = events => events.filter(e => e.eventType === 'STRATEGY_CHECKPOINT');
  function verify(events) {
    if (events[0]?.eventType !== 'SESSION_INITIALIZED' || events[1]?.eventType !== 'STRATEGY_DECLARED' || canonical(events[1].payload.configuration) !== canonical(configuration)) throw new Error('STRATEGY_CONFIGURATION_MISMATCH');
    const points = checkpoints(events);
    const financialEvents = events.filter(e => !['SESSION_INITIALIZED','STRATEGY_DECLARED','STRATEGY_RECOVERED','STRATEGY_CHECKPOINT'].includes(e.eventType));
    if (points.length > candles.length) throw new Error('STRATEGY_CHECKPOINT_CONFLICT');
    const result = points.length ? reference(points.length) : null;
    for (let i=0;i<points.length;i++) {
      if (points[i].payload.index !== i || points[i].payload.planHash !== hash(result.executionTrace[i]) || canonical(points[i].payload.pendingIntent) !== canonical(pending(result.executionTrace[i],i))) throw new Error('STRATEGY_CHECKPOINT_CONFLICT');
    }
    if (result) {
      const expectedEffects = result.executionTrace.flatMap(t=>t.effects).map(e=>e.eventType==='REPLAY_RISK_TRANSITION' ? {...e,payload:{...e.payload,configurationHash}} : e);
      if(!sameRows(financialEvents.map(({eventType,payload,eventTimestamp})=>({eventType,payload,eventTimestamp})),expectedEffects)) throw new Error('STRATEGY_TRACE_MISMATCH');
      const state = projectJournalEvents(events), expected = result.executionTrace.at(-1);
      if (canonical(state.exactUsd8) !== canonical(expected.snapshot.exactUsd8) || canonical(state.position) !== canonical(expected.snapshot.position) || !sameRows(state.trades,result.trades) || !sameRows(state.ledger,result.ledger) || state.riskState !== expected.riskState) throw new Error('STRATEGY_RECONCILIATION_FAILED');
    }
    if (!result && financialEvents.length) throw new Error('STRATEGY_TRACE_MISMATCH');
    return {points,result};
  }
  function pending(trace,index) {
    const timestamp = candles[index].timestamp, availableAt = new Date(Date.parse(timestamp)+3600000).toISOString();
    return {intentId:hash({configurationHash,index,signal:trace.signal}),strategyIdentity:hash(configuration.strategy),strategyVersion:strategy.version,datasetIdentity:data.contentHash,candleTimestamp:timestamp,signalTimestamp:availableAt,earliestEligibleExecutionTimestamp:availableAt,instrument:'EUR/USD',direction:trace.signal.side ?? 0,requestedSizing:{policy:'risk-assessed-at-next-observed-open',risk:configuration.config.risk},stopLoss:trace.signal.stopDistance ?? null,takeProfit:trace.signal.takeDistance ?? null,riskConfigurationIdentity:hash(configuration.config.risk),signal:trace.signal};
  }
  try {
    journal.appendPlanned(sessionId,events => {
      if (!events.length) {
        if (!create) throw new Error('STRATEGY_SESSION_MISSING');
        return [envelope('SESSION_INITIALIZED',{initialCapital:initial.config.initialCapital},origin,1,'initialize'),envelope('STRATEGY_DECLARED',{configuration},origin,2,'strategy_configuration')];
      }
      if(create) throw new Error('STRATEGY_SESSION_EXISTS');
      verify(events);
      const count = events.filter(e=>e.eventType==='STRATEGY_RECOVERED').length+1;
      return [envelope('STRATEGY_RECOVERED',{count},events.at(-1).eventTimestamp,events.length+1,`recovery_${count}`)];
    });
    lifecycle='READY';
  } catch(error) { journal.close(); throw error; }
  function ready() { if(lifecycle!=='READY') throw new Error('STRATEGY_REPLAY_NOT_READY'); }
  function read() { ready(); try { const events=journal.events(sessionId); return {events,...verify(events)}; } catch(error) { lifecycle='DEGRADED'; throw error; } }
  function step() {
    ready();
    try {
      let done=false;
      const committed=journal.appendPlanned(sessionId,(events)=>{
        const {points}=verify(events), index=points.length;
        if(index===candles.length) {done=true;return [];}
        const result=reference(index+1), trace=result.executionTrace[index];
        const effects=trace.effects.map(effect => effect.eventType==='REPLAY_RISK_TRANSITION' ? {...effect,payload:{...effect.payload,configurationHash}} : effect);
        effects.push({eventType:'STRATEGY_CHECKPOINT',payload:{index,planHash:hash(trace),pendingIntent:pending(trace,index)},eventTimestamp:trace.snapshot.timestamp});
        const additions=effects.map((effect,i)=>envelope(effect.eventType,effect.payload,effect.eventTimestamp,events.length+i+1,hash({configurationHash,index,effect:i})));
        const projected=projectJournalEvents([...events,...additions]);
        if(canonical(projected.exactUsd8)!==canonical(trace.snapshot.exactUsd8) || canonical(projected.position)!==canonical(trace.snapshot.position) || projected.riskState!==trace.riskState) throw new Error('STRATEGY_RECONCILIATION_FAILED');
        return additions;
      });
      return {done,...committed};
    } catch(error) {lifecycle='DEGRADED';throw error;}
  }
  return Object.freeze({
    step,
    run(limit=candles.length) {if(!Number.isSafeInteger(limit)||limit<0) throw new Error('INVALID_STEP_LIMIT');for(let i=0;i<limit;i++) if(step().done) break;return this.status();},
    status() {const {events,points}=read();return {sessionId,configurationHash,datasetHash:data.contentHash,lifecycle,durabilityMode:'DURABLE',committedCandles:points.length,lastCommittedSequence:events.length,recoveryCount:events.filter(e=>e.eventType==='STRATEGY_RECOVERED').length,pendingIntent:points.at(-1)?.payload.pendingIntent ?? null,snapshot:projectJournalEvents(events),financialReconciliation:'VERIFIED'};},
    report() {const {events,result}=read();if(!result) throw new Error('NO_COMMITTED_CANDLES');const {executionTrace,...financial}=result;return {...financial,mode:'paper-durable-strategy',durability:this.status(),riskTransitions:events.filter(e=>e.eventType==='REPLAY_RISK_TRANSITION'),operationalWarnings:['Bounded prefix reconstruction; maximum 1000 candles','Open positions retained at end of data; no implicit liquidation','PAUSED and HALTED latch; no automatic administrative reset']};},
    close() {if(lifecycle!=='CLOSED') {journal.close();lifecycle='CLOSED';}},
  });
}
