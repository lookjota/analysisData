import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { hash } from '../persistence/journal.js';
import { initializeForwardJournal, appendForwardObservations, inspectForwardJournal, validateObservation } from '../market-data/forward-journal.js';
import { runForward } from '../cli/forward.js';
const now='2026-11-02T12:05:00.000Z', clock=()=>now;
const policy={finalizationDelayMs:60000,maxAgeMs:300000,calendar:{provider:'test'}};
function observation(time='2026-11-02T11:00:00.000Z') {
 const bar={open:1.1,high:1.102,low:1.098,close:1.101};
 const candle={instrument:'EUR/USD',timeframe:'H1',timestamp:time,...bar,source:'offline-test',synthetic:false,quoteBars:{bid:bar,ask:Object.fromEntries(Object.entries(bar).map(([k,v])=>[k,v+.0001]))}};
 return {candle,classification:'HISTORICAL_BACKFILL',timestampConvention:'UTC_BAR_OPEN',complete:true,observedAt:now,acquiredAt:now,sourceRevision:'r1',evidence:{content:structuredClone(candle),contentHash:hash(candle)}};
}
function reseal(o){o.evidence={content:structuredClone(o.candle),contentHash:hash(o.candle)};return o;}
async function workspace(fn){const root=await mkdtemp(join(tmpdir(),'orion-forward-'));try{await fn(root,join(root,'journal'));}finally{await rm(root,{recursive:true,force:true});}}
test('completed H1 with original observation time validates',()=>assert.equal(validateObservation(observation(),policy,now).timestamp,'2026-11-02T11:00:00.000Z'));
test('current incomplete H1 rejects',()=>assert.throws(()=>validateObservation(observation('2026-11-02T12:00:00.000Z'),policy,now),/INCOMPLETE/));
test('future interval rejects',()=>assert.throws(()=>validateObservation(observation('2026-11-02T13:00:00.000Z'),policy,now),/FUTURE/));
test('publication delay boundary is inclusive',()=>{const o=observation();o.observedAt=o.acquiredAt='2026-11-02T12:01:00.000Z';assert.ok(validateObservation(o,policy,now));o.observedAt='2026-11-02T12:00:59.999Z';assert.throws(()=>validateObservation(o,policy,now),/INCOMPLETE/);});
test('forward freshness boundary never bypasses independent receipt',()=>{const o=observation();o.classification='FORWARD_OBSERVED';assert.throws(()=>validateObservation(o,policy,now),/NOT_AUTHENTICATED/);assert.throws(()=>validateObservation(o,policy,'2026-11-02T12:10:00.001Z'),/STALE/);});
test('invalid bid ask OHLC rejects',()=>{const o=observation();o.candle.quoteBars.bid.low=2;assert.throws(()=>validateObservation(reseal(o),policy,now),/OHLC/);});
test('crossed contemporaneous endpoints reject',()=>{const o=observation();o.candle.quoteBars.ask={...o.candle.quoteBars.bid,open:1.099};assert.throws(()=>validateObservation(reseal(o),policy,now),/CROSSED/);});
test('independent extrema are not treated as synchronized spreads',()=>assert.ok(validateObservation(observation(),policy,now)));
test('future acquisition timestamp rejects independently',()=>{const o=observation();o.acquiredAt='2026-11-02T12:06:00Z';assert.throws(()=>validateObservation(o,policy,now),/FUTURE/);});
test('source evidence mismatch rejects',()=>{const o=observation();o.evidence.contentHash='0'.repeat(64);assert.throws(()=>validateObservation(o,policy,now),/EVIDENCE/);});
test('synthetic cannot claim historical provenance',()=>{const o=observation();o.candle.synthetic=true;assert.throws(()=>validateObservation(reseal(o),policy,now),/SYNTHETIC/);o.classification='ENGINEERING_REPLAY';assert.ok(validateObservation(o,policy,now));});
test('duplicates idempotent, revisions immutable and quarantined',()=>workspace(async(root,dir)=>{
 await initializeForwardJournal(dir,{},clock);const o=observation();let s=await appendForwardObservations(dir,[o,o],clock);assert.equal(s.sequence,1);
 const original=await readFile(join(dir,'observation-000001.json'),'utf8');const changed=reseal({...structuredClone(o),sourceRevision:'r2'});changed.candle.close+=.00001;reseal(changed);
 s=await appendForwardObservations(dir,[changed],clock);assert.deepEqual(s.quarantinedSequences,[2]);assert.equal(s.accepted.length,1);assert.equal(await readFile(join(dir,'observation-000001.json'),'utf8'),original);
 assert.deepEqual(s.classifications,['HISTORICAL_BACKFILL']);assert.equal(s.forwardExecution,'BLOCKED_NO_AUTHENTICATED_RECEIPT_OR_EXECUTABLE_QUOTE');
}));
test('missing open hour and out of order arrivals reject',()=>workspace(async(root,dir)=>{await initializeForwardJournal(dir,{},clock);await appendForwardObservations(dir,[observation('2026-11-02T08:00:00Z')],clock);await assert.rejects(appendForwardObservations(dir,[observation()],clock),/DATA_QUALITY/);await assert.rejects(appendForwardObservations(dir,[observation('2026-11-02T07:00:00Z')],clock),/UNORDERED/);}));
test('NY17 weekend and US DST shift use existing calendar',()=>workspace(async(root,dir)=>{const c=()=> '2026-11-02T12:05:00Z';await initializeForwardJournal(dir,{},c);const a=observation('2026-10-30T20:00:00Z'),b=observation('2026-11-01T22:00:00Z');const s=await appendForwardObservations(dir,[a,b],c);assert.equal(s.accepted.length,2);await assert.rejects(appendForwardObservations(dir,[observation('2026-11-01T21:00:00Z')],c),/CLOSED/);}));
test('corruption rejects rather than truncating',()=>workspace(async(root,dir)=>{await initializeForwardJournal(dir,{},clock);await appendForwardObservations(dir,[observation()],clock);const path=join(dir,'observation-000001.json');const record=JSON.parse(await readFile(path));record.observation.candle.close+=.01;await writeFile(path,JSON.stringify(record));await assert.rejects(inspectForwardJournal(dir,clock),/CORRUPTION/);}));
test('symlink directory and protected paths reject',()=>workspace(async(root,dir)=>{await symlink(root,dir);await assert.rejects(initializeForwardJournal(dir,{},clock),/SYMLINK/);await assert.rejects(initializeForwardJournal(join(root,'freqtrade'),{},clock),/UNSAFE/);}));
test('real SIGKILL releases exclusive writer and preserves committed evidence',()=>workspace(async(root,dir)=>{
 await initializeForwardJournal(dir,{},clock);const input=join(root,'batch.json');await writeFile(input,JSON.stringify([observation()]));
 const child=fork(new URL('./fixtures/forward-journal-child.js',import.meta.url),[dir,input,now],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
 try {const [message]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('CHILD_EXITED');}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('CHILD_TIMEOUT')),10000).unref())]);assert.equal(message,'COMMITTED_AND_LOCKED');await assert.rejects(appendForwardObservations(dir,[observation()],clock),/locked/);const exited=once(child,'exit');child.kill('SIGKILL');await exited;const s=await appendForwardObservations(dir,[observation()],clock);assert.equal(s.sequence,1);assert.equal(s.integrity,'VERIFIED_LOCAL_HASH_CHAIN');} finally{child.kill('SIGKILL');}
}));
test('CLI strictly rejects unknown flags and input on status',async()=>{for(const args of [['paper:ops:journal:init','--journal','x','--live','yes'],['paper:ops:journal:status','--journal','x','--input','x.json']])assert.equal(await runForward(args,{output:()=>{},errorOutput:()=>{}}),1);});
test('fixed journal watermark feeds four F2 accounts and restart has no duplicate effects',()=>workspace(async(root,dir)=>{
 const { processJournalSnapshot }=await import('../paper/journal-operations.js');
 await initializeForwardJournal(dir,{},clock);
 const batch=Array.from({length:6},(_,i)=>observation(`2026-11-02T0${i+1}:00:00Z`));
 await appendForwardObservations(dir,batch,clock);
 let s=await processJournalSnapshot({directory:dir,runId:'four',action:'init',clock});assert.equal(s.accounts.length,4);
 const { openStrategyReplay }=await import('../paper/strategy-durable.js');
 const { operationalConfig }=await import('../paper/operations.js');
 const journal=await inspectForwardJournal(dir,clock);
 const single=await openStrategyReplay({directory:dir,filename:'four-trend.sqlite',sessionId:'four-trend',rows:journal.accepted.map(r=>r.candle),options:{strategyId:'trend',parameters:operationalConfig.parameters,initialCapital:1000,risk:operationalConfig.risk,costs:{...operationalConfig.costs,spreadPips:0},executionMode:'OBSERVED_BID_ASK',dataValidation:{asOf:now,calendarMode:'calendar-v1',calendar:journal.config.calendar}}});
 single.run(2);single.close();
 const divergent=await processJournalSnapshot({directory:dir,runId:'four',clock});assert.equal(divergent.synchronized,false);assert.deepEqual(divergent.accounts.map(a=>a.committedCandles),[2,0,0,0]);
 s=await processJournalSnapshot({directory:dir,runId:'four',action:'step',limit:6,clock});assert.ok(s.synchronized);assert.ok(s.accounts.every(a=>a.committedCandles===6&&a.journalSequence===6));
 const snapshots=s.accounts.map(a=>{const {sequence,...financial}=a.snapshot;return financial;});
 s=await processJournalSnapshot({directory:dir,runId:'four',action:'step',limit:6,clock});assert.deepEqual(s.accounts.map(a=>{const {sequence,...financial}=a.snapshot;return financial;}),snapshots);
 const revised=observation(batch[0].candle.timestamp);revised.candle.close+=.00001;reseal(revised);await appendForwardObservations(dir,[revised],clock);
 await assert.rejects(processJournalSnapshot({directory:dir,runId:'four',clock}),/QUARANTINED/);
}));
