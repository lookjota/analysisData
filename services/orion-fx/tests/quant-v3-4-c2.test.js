import { appendableCommitments } from '../paper/appendable-commitments.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { initializeForwardJournal,appendForwardObservations,inspectForwardJournal } from '../market-data/forward-journal.js';
import { processAppendableJournal } from '../paper/appendable-operations.js';
import { openStrategyReplay } from '../paper/strategy-durable.js';
import { observations,clock,accountOptions } from './fixtures/appendable-c2.js';
import { canonical,hash } from '../persistence/journal.js';
const ops=(directory,action='status',limit=24)=>processAppendableJournal({directory,runId:'demo',action,limit,clock});
async function setup(n=6){const root=await mkdtemp(join(tmpdir(),'orion-c2-')),dir=join(root,'journal');await initializeForwardJournal(dir,{},clock);await appendForwardObservations(dir,observations(n),clock);await ops(dir,'init');return dir;}
function stored(dir,strategyId='trend'){const db=new DatabaseSync(join(dir,`demo-append-v1-${strategyId}.sqlite`));try{return db.prepare('SELECT body,digest FROM events ORDER BY sequence').all().filter(r=>JSON.parse(r.body).eventType!=='STRATEGY_RECOVERED');}finally{db.close();}}
function financial(s){return s.accounts.map(a=>{const {sequence,...state}=a.snapshot;return state;});}

test('C2 four stable accounts append 6 to 12, preserve committed bytes, retry and restart reconcile USD8',async()=>{
 const dir=await setup();const first=await ops(dir,'step');const bytes=first.accounts.map(a=>stored(dir,a.strategyId));
 assert.deepEqual(first.accounts.map(a=>a.committedCandles),[6,6,6,6]);
 const head=first.journalHeadCommitment;
 await appendForwardObservations(dir,observations().slice(6),clock);
 const after=await ops(dir,'step');assert.ok(after.accounts.every(a=>a.cursor.sequence===12));
 assert.deepEqual(after.accounts.map(a=>a.committedCandles),[12,12,12,12]);
 assert.deepEqual(after.accounts.map(a=>a.configurationHash),first.accounts.map(a=>a.configurationHash));
 assert.deepEqual(after.accounts.map(a=>a.sessionId),first.accounts.map(a=>a.sessionId));
 after.accounts.forEach((a,i)=>assert.deepEqual(stored(dir,a.strategyId).slice(0,bytes[i].length),bytes[i]));
 const journal=await inspectForwardJournal(dir,clock);const chain=appendableCommitments(journal);assert.equal(chain.records[5].commitment,head);
 for(const a of after.accounts){assert.equal(a.cursor.commitment,chain.head);assert.equal(a.financialReconciliation,'VERIFIED');assert.ok(a.snapshot.exactUsd8.equity);const x=a.snapshot.exactUsd8;assert.equal(BigInt(x.cash),100000000000n+a.snapshot.ledger.reduce((sum,e)=>sum+BigInt(e.amountUsd8),0n));assert.equal(BigInt(x.equity),BigInt(x.cash)+BigInt(x.unrealizedPnl));}
 const all=after.accounts.map(a=>stored(dir,a.strategyId));assert.deepEqual(financial(await ops(dir,'step')),financial(after));assert.deepEqual(financial(await ops(dir)),financial(after));after.accounts.forEach((a,i)=>assert.deepEqual(stored(dir,a.strategyId),all[i]));
 const child=spawn(process.execPath,[new URL('./fixtures/appendable-c2-child.js',import.meta.url).pathname,dir,'all-status'],{stdio:['ignore','ignore','pipe','ipc']});const exited=once(child,'exit');const [restarted]=await Promise.race([once(child,'message'),exited.then(()=>{throw new Error('RESTART_CHILD_EXITED');})]);const [exit,signal]=await exited;assert.equal(exit,0);assert.equal(signal,null);assert.deepEqual(financial(restarted),financial(after));
 await writeFile(join(dir,'c2-demonstration.json'),JSON.stringify(after,null,2));
 console.log('C2_DEMONSTRATION',dir,JSON.stringify(after.accounts.map(a=>({id:a.sessionId,identity:a.configurationHash,cursor:a.cursor,equity:a.snapshot.exactUsd8.equity,reconciliation:a.financialReconciliation}))));
});

test('C2 duplicate append is idempotent and chain links are exact',async()=>{const dir=await setup();const before=await inspectForwardJournal(dir,clock);const after=await appendForwardObservations(dir,observations(6),clock);assert.equal(after.head,before.head);assert.equal(after.sequence,6);for(let i=1;i<6;i++)assert.equal(after.records[i].previous,after.records[i-1].digest);});
for(const mode of ['tamper','missing','rewrite','wrong-genesis'])test(`C2 fails closed on ${mode}`,async()=>{
 const dir=await setup();await ops(dir,'step');
 const path=join(dir,mode==='wrong-genesis'?'journal.json':'observation-000002.json');
 if(mode==='missing')await unlink(path);else{const r=JSON.parse(await readFile(path));if(mode==='tamper')r.contentHash='0'.repeat(64);if(mode==='rewrite')r.sequence=1;if(mode==='wrong-genesis')r.createdAt='2026-11-02T00:00:00.000Z';await writeFile(path,JSON.stringify(r));}
 await assert.rejects(ops(dir));
});
test('C2 revision is quarantined and prevents account mutation',async()=>{const dir=await setup();await ops(dir,'step');const before=stored(dir);const o=observations(1)[0];o.candle.close+=.00001;o.evidence={content:o.candle,contentHash:hash(o.candle)};await appendForwardObservations(dir,[o],clock);await assert.rejects(ops(dir,'step'),/QUARANTINED/);assert.deepEqual(stored(dir),before);});
for(const option of ['risk','costs','parameters','calendar'])test(`C2 rejects changed ${option} identity`,async()=>{
 const dir=await setup();const args=await accountOptions(dir);
 if(option==='risk')args.options.risk={...args.options.risk,maxExposure:900};
 if(option==='costs')args.options.costs.slippagePips=.2;
 if(option==='parameters')args.options.parameters={...args.options.parameters,slow:4};
 if(option==='calendar')args.options.dataValidation.calendar={provider:'changed'};
 await assert.rejects(openStrategyReplay(args),/CONFIGURATION_MISMATCH|JOURNAL_CALENDAR_MISMATCH/);
});
test('C2 cursor tampering with resealed event digest rejects',async()=>{const dir=await setup();await ops(dir,'step');const db=new DatabaseSync(join(dir,'demo-append-v1-trend.sqlite'));const row=db.prepare("SELECT sequence,body FROM events WHERE body LIKE '%STRATEGY_APPEND_CHECKPOINT%' LIMIT 1").get();const event=JSON.parse(row.body);event.payload.cursor.sequence=999;db.prepare('UPDATE events SET body=?,digest=? WHERE sequence=?').run(canonical(event),hash(event),row.sequence);db.close();const status=await ops(dir);assert.equal(status.accounts[0].status,'BLOCKED_INTEGRITY');assert.equal(status.accounts[0].error,'CURSOR_COMMITMENT_MISMATCH');await assert.rejects(ops(dir,'step'),/CURSOR/);});
test('C2 independent laggard converges without duplicating ahead account',async()=>{const dir=await setup();const a=await openStrategyReplay(await accountOptions(dir));a.run(6);a.close();assert.deepEqual((await ops(dir)).accounts.map(a=>a.committedCandles),[6,0,0,0]);const before=stored(dir);assert.ok((await ops(dir,'step')).accounts.every(a=>a.committedCandles===6));assert.deepEqual(stored(dir),before);});
for(const phase of ['after-journal-append','before-commit','after-commit'])test(`C2 actual SIGKILL ${phase} recovers cursor and financial transaction`,async()=>{
 const dir=await setup();await ops(dir,'step');if(phase!=='after-journal-append')await appendForwardObservations(dir,observations().slice(6),clock);const before=stored(dir);
 const child=spawn(process.execPath,[new URL('./fixtures/appendable-c2-child.js',import.meta.url).pathname,dir,phase],{stdio:'ignore'});const [code,signal]=await once(child,'exit');assert.equal(code,null);assert.equal(signal,'SIGKILL');
 const intermediate=await ops(dir);assert.equal(intermediate.accounts[0].committedCandles,phase==='after-commit'?7:6);assert.deepEqual(stored(dir).slice(0,before.length),before);
 const final=await ops(dir,'step');assert.ok(final.accounts.every(a=>a.committedCandles===12));assert.deepEqual(final.accounts.map(a=>a.committedCandles),[12,12,12,12]);assert.deepEqual(financial(await ops(dir,'step')),financial(final));
});
test('C2 concurrent same-account workers serialize and consume each candle once',async()=>{const dir=await setup();const run=()=>{const child=spawn(process.execPath,[new URL('./fixtures/appendable-c2-child.js',import.meta.url).pathname,dir,'none'],{stdio:'ignore'});return once(child,'exit');};const results=await Promise.all([run(),run()]);assert.deepEqual(results,[[0,null],[0,null]]);const a=await openStrategyReplay(await accountOptions(dir));assert.equal(a.status().committedCandles,6);assert.equal(a.status().financialReconciliation,'VERIFIED');a.close();});

for(const [strategyId,expected] of [['buy-hold',1],['trend',-1],['no-trade',0],['mean-reversion',0]]) test(`C2 pending ${strategyId} persists through append and executes only with later evidence`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'orion-c2-intent-')),dir=join(root,'journal');await initializeForwardJournal(dir,{},clock);
 const batch=observations().map((o,i)=>{
   const open=1.12-i*.0002,bar={open,close:open-.0001,high:open+.0001,low:open-.0002};
   o.candle={...o.candle,...bar,quoteBars:{bid:bar,ask:Object.fromEntries(Object.entries(bar).map(([k,v])=>[k,v+.0001]))}};
   o.evidence={content:o.candle,contentHash:hash(o.candle)};return o;
 });
 await appendForwardObservations(dir,batch.slice(0,6),clock);
 const args=await accountOptions(dir,strategyId);args.options.risk={...args.options.risk,maxExposure:100};
 let a=await openStrategyReplay({...args,create:true});a.run(6);const before=a.status();
 assert.equal(before.pendingIntent.direction,expected);
 if(strategyId==='mean-reversion')assert.equal(before.pendingIntent.signal.exitShort,true);
 const ledger=before.snapshot.ledger;
 a.run(6);assert.deepEqual(a.status().snapshot.ledger,ledger);a.close();
 // A delayed append does not create an execution until a completed price bar exists.
 a=await openStrategyReplay(args);assert.deepEqual(a.status().pendingIntent,before.pendingIntent);assert.equal(a.step().done,true);a.close();
 await appendForwardObservations(dir,batch.slice(6),clock);
 const next={...args,rows:(await inspectForwardJournal(dir,clock)).accepted.map(r=>r.candle)};
 a=await openStrategyReplay(next);assert.deepEqual(a.status().pendingIntent,before.pendingIntent);a.run(12);const final=a.status();a.close();
 const uninterrupted=await openStrategyReplay({...next,filename:`control-${strategyId}.sqlite`,create:true});uninterrupted.run(12);
 const {sequence,...actual}=final.snapshot,{sequence:ignored,...reference}=uninterrupted.status().snapshot;
 assert.deepEqual(actual,reference);assert.deepEqual(final.pendingIntent,uninterrupted.status().pendingIntent);uninterrupted.close();
});
for(const riskState of ['PAUSED','HALTED'])test(`C2 append preserves ${riskState} and pending intent without reopening entries`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'orion-c2-risk-')),dir=join(root,'journal');await initializeForwardJournal(dir,{},clock);
 const batch=observations();batch[4].candle.low=1;batch[4].candle.quoteBars.bid.low=1;batch[4].candle.quoteBars.ask.low=1.0001;batch[4].evidence={content:batch[4].candle,contentHash:hash(batch[4].candle)};
 await appendForwardObservations(dir,batch.slice(0,6),clock);
 const args=await accountOptions(dir,'risk-managed-hold');args.options.risk={dailyLossFraction:.001,maxDrawdownFraction:riskState==='HALTED'?.001:.5,maxExposure:10000,leverage:10};
 let a=await openStrategyReplay({...args,create:true});a.run(6);const before=a.status();assert.equal(before.snapshot.riskState,riskState);const opens=before.snapshot.ledger.filter(e=>e.type==='OPEN').length;a.close();
 await appendForwardObservations(dir,batch.slice(6),clock);a=await openStrategyReplay({...args,rows:(await inspectForwardJournal(dir,clock)).accepted.map(r=>r.candle)});assert.deepEqual(a.status().pendingIntent,before.pendingIntent);a.run(12);assert.equal(a.status().snapshot.riskState,riskState);assert.equal(a.status().snapshot.ledger.filter(e=>e.type==='OPEN').length,opens);a.close();
});
test('C2 semantic code identity and wrong journal declaration cannot be silently accepted',async()=>{
 for(const field of ['semanticIdentity','journalIdentity']) {
  const dir=await setup();const db=new DatabaseSync(join(dir,'demo-append-v1-trend.sqlite'));
  const row=db.prepare("SELECT sequence,body FROM events WHERE body LIKE '%STRATEGY_DECLARED%' LIMIT 1").get();const event=JSON.parse(row.body);event.payload.configuration[field]='0'.repeat(64);
  db.prepare('UPDATE events SET body=?,digest=? WHERE sequence=?').run(canonical(event),hash(event),row.sequence);db.close();
  const s=await ops(dir);assert.equal(s.accounts[0].status,'BLOCKED_INTEGRITY');assert.equal(s.accounts[0].error,'STRATEGY_CONFIGURATION_MISMATCH');await assert.rejects(ops(dir,'step'),/CONFIGURATION_MISMATCH/);
 }
});
test('C2 unverified caller rows cannot become appendable input',async()=>{const dir=await setup();const args=await accountOptions(dir);args.rows=structuredClone(args.rows);args.rows[0].close+=.00001;await assert.rejects(openStrategyReplay(args),/UNVERIFIED_JOURNAL_INPUT/);});
test('C2 missing accounts are UNKNOWN and CLI mode parsing is strict',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orion-c2-cli-')),dir=join(root,'journal');await initializeForwardJournal(dir,{},clock);await appendForwardObservations(dir,observations(1),clock);
 assert.ok((await ops(dir)).accounts.every(a=>a.status==='UNKNOWN'));
 const {runForward}=await import('../cli/forward.js');const output=[];
 assert.equal(await runForward(['paper:ops:journal:paper:init','--journal',dir,'--run','cli','--mode','appendable-v1'],{output:x=>output.push(JSON.parse(x)),errorOutput:x=>assert.fail(x)}),0);
 assert.equal(output[0].identityVersion,'strategy-appendable-v1');
 for(const mode of ['invalid','true'])assert.equal(await runForward(['paper:ops:journal:paper:status','--journal',dir,'--run','cli','--mode',mode],{output:()=>assert.fail('accepted'),errorOutput:()=>{}}),1);
});
