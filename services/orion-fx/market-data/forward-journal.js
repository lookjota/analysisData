import { mkdir, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { canonical, hash } from '../persistence/journal.js';
import { safePath, readStoredJson, writeAtomicJson, withHistoryPublicationLock } from './capital-history.js';
import { normalizeCandle, timestamp, validateDataset } from './historical.js';
import { CALENDAR_VERSION, marketSession } from '../calendar/forex.js';

const HOUR = 3600000;
const fail = code => { throw new Error(code); };
const name = n => `observation-${String(n).padStart(6,'0')}.json`;
const seal = body => ({...body,digest:hash(body)});
const unseal = record => { const {digest,...body}=record; if(hash(body)!==digest) fail('JOURNAL_CORRUPTION'); return body; };
const fields = (v, keys) => { if(!v || Object.keys(v).sort().join()!==keys.sort().join()) fail('INVALID_OBSERVATION_SCHEMA'); };
async function location(directory) {
  const path=resolve(directory);
  if(path.split('/').some(p=>['freqtrade','.env','data','datasets','.git'].includes(p))) fail('UNSAFE_DIRECTORY');
  await safePath(path); return path;
}
export function validateObservation(raw, policy, now) {
  fields(raw,['candle','classification','timestampConvention','complete','observedAt','acquiredAt','sourceRevision','evidence']);
  if(!['HISTORICAL_BACKFILL','ENGINEERING_REPLAY','FORWARD_OBSERVED'].includes(raw.classification)) fail('INVALID_CLASSIFICATION');
  if(raw.timestampConvention!=='UTC_BAR_OPEN' || raw.complete!==true) fail('INCOMPLETE_OR_UNVERIFIED_INTERVAL');
  const candle=normalizeCandle(raw.candle,{strict:true});
  if(!candle.quoteBars) fail('BID_ASK_REQUIRED');
  if(['high','low'].some(k=>candle.quoteBars.bid[k]>candle.quoteBars.ask[k])) fail('INVALID_AGGREGATE_SIDES');
  if(candle.synthetic && raw.classification!=='ENGINEERING_REPLAY') fail('SYNTHETIC_PROVENANCE');
  if(typeof raw.sourceRevision!=='string' || !/^[\w.:-]{1,128}$/.test(raw.sourceRevision)) fail('INVALID_REVISION');
  fields(raw.evidence,['content','contentHash']);
  if(hash(raw.evidence.content)!==raw.evidence.contentHash) fail('SOURCE_EVIDENCE_MISMATCH');
  // Evidence preserves exactly the declared candle; it does not authenticate a broker.
  if(canonical(raw.evidence.content)!==canonical(raw.candle)) fail('SOURCE_EVIDENCE_CANDLE_MISMATCH');
  const observed=Date.parse(timestamp(raw.observedAt)), acquired=Date.parse(timestamp(raw.acquiredAt));
  const clock=Date.parse(timestamp(now)), end=Date.parse(candle.timestamp)+HOUR;
  if(observed>clock || acquired>clock || Date.parse(candle.timestamp)>clock) fail('FUTURE_OBSERVATION');
  if(observed>end+policy.maxAgeMs && raw.classification==='FORWARD_OBSERVED') fail('STALE_OBSERVATION');
  if(observed<end+policy.finalizationDelayMs || acquired<observed || end+policy.finalizationDelayMs>clock) fail('INCOMPLETE_CANDLE');
  if(['WEEKLY_CLOSED','DECLARED_HOLIDAY','DECLARED_SCHEDULE_EXCEPTION'].includes(marketSession(candle.timestamp,policy.calendar).status)) fail('CLOSED_MARKET_CANDLE');
  if(raw.classification==='FORWARD_OBSERVED') {
    if(clock-observed>policy.maxAgeMs) fail('STALE_OBSERVATION');
    // Offline caller-controlled timestamps and hashes cannot establish independent receipt.
    fail('FORWARD_RECEIPT_NOT_AUTHENTICATED');
  }
  return candle;
}
export async function initializeForwardJournal(directory,{finalizationDelayMs=60000,maxAgeMs=300000,calendar={provider:'Orion declared FX NY17 convention'}}={},clock=()=>new Date().toISOString()) {
  if(!Number.isSafeInteger(finalizationDelayMs)||finalizationDelayMs<0||finalizationDelayMs>HOUR||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<finalizationDelayMs||maxAgeMs>86400000) fail('INVALID_JOURNAL_POLICY');
  if(!calendar || Object.keys(calendar).some(k=>!['provider','closures','reducedDates','weeklyOpenHour','weeklyCloseHour','weeklyTimezone','exceptions'].includes(k))) fail('INVALID_CALENDAR_CONFIG');
  marketSession(timestamp(clock()),calendar);
  const path=await location(directory); await mkdir(path,{mode:0o700});
  await writeAtomicJson(join(path,'journal.json'),seal({version:'orion.observations.v1',createdAt:timestamp(clock()),calendarVersion:CALENDAR_VERSION,calendar,finalizationDelayMs,maxAgeMs}));
  return inspectForwardJournal(path,clock);
}
export async function inspectForwardJournal(directory,clock=()=>new Date().toISOString()) {
  const path=await location(directory), config=await readStoredJson(join(path,'journal.json'));
  unseal(config);
  if(config.version!=='orion.observations.v1'||config.calendarVersion!==CALENDAR_VERSION) fail('JOURNAL_VERSION');
  const names=(await readdir(path)).filter(n=>n.startsWith('observation-')).sort();
  if(names.length>1000) fail('JOURNAL_CAPACITY');
  const records=[], accepted=[], revisions=[]; let previous=config.digest;
  for(let i=0;i<names.length;i++) {
    if(names[i]!==name(i+1)) fail('JOURNAL_SEQUENCE_GAP');
    if((await lstat(join(path,names[i]))).size>262144) fail('PAYLOAD_TOO_LARGE');
    const r=await readStoredJson(join(path,names[i])); unseal(r);
    if(r.sequence!==i+1||r.previous!==previous||r.contentHash!==hash(r.observation.candle)) fail('JOURNAL_CORRUPTION');
    const candle=validateObservation(r.observation,config,r.ingestedAt);
    const prior=accepted.find(x=>x.candle.timestamp===candle.timestamp);
    const expected=prior ? 'QUARANTINED_REVISION':'ACCEPTED';
    if(r.state!==expected || prior?.contentHash===r.contentHash) fail('JOURNAL_CORRUPTION');
    if(prior) revisions.push(r.sequence); else accepted.push({...r,candle});
    records.push(r); previous=r.digest;
  }
  if(accepted.length) validateDataset(accepted.map(r=>r.candle),{asOf:clock(),calendarMode:'calendar-v1',calendar:config.calendar,gapPolicy:'reject',strict:true,maxRows:1000});
  const latest=accepted.at(-1), ageMs=latest ? Date.parse(timestamp(clock()))-Date.parse(latest.observation.observedAt):null;
  return {version:config.version,sequence:records.length,head:previous,integrity:'VERIFIED_LOCAL_HASH_CHAIN',sourceAuthentication:'UNVERIFIED_OFFLINE_DECLARATION',classifications:[...new Set(records.map(r=>r.observation.classification))],quarantinedSequences:revisions,missingStatus:'NO_INTERIOR_OPEN_HOUR_GAPS',inputFreshness:{ageMs,stale:ageMs===null||ageMs>config.maxAgeMs},forwardExecution:'BLOCKED_NO_AUTHENTICATED_RECEIPT_OR_EXECUTABLE_QUOTE',tradingEnabled:false,brokerExecution:'DISABLED',config,records,accepted};
}
export async function appendForwardObservations(directory,batch,clock=()=>new Date().toISOString()) {
  if(!Array.isArray(batch)||batch.length<1||batch.length>100) fail('INVALID_BATCH_SIZE');
  const path=await location(directory);
  return withHistoryPublicationLock(path,async()=>{
    let state=await inspectForwardJournal(path,clock);
    for(const observation of batch) {
      const now=timestamp(clock()), candle=validateObservation(observation,state.config,now), contentHash=hash(observation.candle);
      // Identical content is idempotent; never promotes provenance on re-import.
      if(state.records.some(r=>r.observation.candle.timestamp===candle.timestamp&&r.contentHash===contentHash)) continue;
      if(state.sequence>=1000) fail('JOURNAL_CAPACITY');
      const prior=state.accepted.find(r=>r.candle.timestamp===candle.timestamp);
      if(!prior && state.accepted.length) validateDataset([...state.accepted.map(r=>r.candle),candle],{asOf:now,calendarMode:'calendar-v1',calendar:state.config.calendar,gapPolicy:'reject',strict:true,maxRows:1000});
      const record=seal({sequence:state.sequence+1,previous:state.head,ingestedAt:now,contentHash,state:prior?'QUARANTINED_REVISION':'ACCEPTED',observation});
      await writeAtomicJson(join(path,name(record.sequence)),record);
      state=await inspectForwardJournal(path,clock);
    }
    return state;
  });
}
