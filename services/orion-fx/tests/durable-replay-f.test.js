import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openDurableReplay } from '../paper/replay.js';
import { hash, openJournal } from '../persistence/journal.js';
import { DatabaseSync } from 'node:sqlite';

export const config = { sessionId:'f_test',datasetIdentity:hash('synthetic'),strategyIdentity:hash('explicit-fixture'),configurationIdentity:hash('fixture-v1'),initialCapital:1000,executionModelVersion:'explicit-intent-v1',riskModelVersion:'simulation-v1',journalSchemaVersion:1,clockPolicy:'EXPLICIT_UTC',recoveryPolicy:'VERIFY_FULL',durabilityMode:'DURABLE',risk:{},quotePolicy:{maxAgeMs:3600000,maxSpread:.001} };
const time = '2026-01-05T10:00:00.000Z';
export const input = (sequence,kind,payload,timestamp=time) => ({ sourceId:`source_${sequence}`,sequence,timestamp,kind,payload });
const mark = (n,bid=1,ask=bid,timestamp=time,quoteTimestamp=timestamp) => input(n,'mark',{bid,ask,quoteTimestamp},timestamp);
const entry = (n,side=1) => input(n,'entry',{side,stopDistance:.01,takeDistance:.02,commissionUsd8:'100000000'});
const exit = n => input(n,'exit',{reason:'fixture',commissionUsd8:'100000000'});
const temp = t => { const d=mkdtempSync(join(tmpdir(),'orion-f-')); t.after(()=>rmSync(d,{recursive:true,force:true})); return d; };
const open = (directory,create=false,configuration=config) => openDurableReplay({directory,configuration,create});

test('F streaming replay: exact independent USD8 oracle, duplicate costs, open restart and close',async t=>{
 const d=temp(t); let r=await open(d,true);
 r.submitMarketEvent(mark(1)); r.submitVirtualIntent(entry(2));
 assert.equal(r.getReplaySnapshot().position.units,400);
 r.submitVirtualIntent(input(3,'swap',{amountUsd8:'200000000'}));
 const before=r.getReplaySnapshot(); r.closeReplay(); r=await open(d); t.after(()=>r.closeReplay());
 assert.deepEqual(r.getReplaySnapshot(),before);
 r.submitMarketEvent(mark(4,1.1)); r.submitVirtualIntent(exit(5));
 const expected=1000n*100000000n+400n*10000000n-4n*100000000n;
 assert.equal(r.getReplaySnapshot().exactUsd8.cash,String(expected));
 assert.equal(r.getReplaySnapshot().exactUsd8.marginUsed,'0');
 const snapshot=r.getReplaySnapshot(); assert.equal(r.submitVirtualIntent(exit(5)).idempotent,true);
 assert.deepEqual(r.getReplaySnapshot(),snapshot);
 assert.throws(()=>r.submitVirtualIntent({...exit(5),payload:{...exit(5).payload,reason:'conflict'}}),/CONFLICT/);
 assert.throws(()=>r.submitVirtualIntent(exit(7)),/SEQUENCE/);
 assert.deepEqual(r.getReplaySnapshot(),snapshot);
});

test('F short continuous versus recovered explicit replay',async t=>{
 const dirs=[temp(t),temp(t)]; const snapshots=[];
 for(let i=0;i<2;i++) {
  let r=await open(dirs[i],true);
  r.submitMarketEvent(mark(1)); r.submitVirtualIntent(entry(2,-1));
  if(i) { r.closeReplay(); r=await open(dirs[i]); }
  r.submitMarketEvent(mark(3,.99)); r.submitVirtualIntent(exit(4)); snapshots.push(r.getReplaySnapshot());r.closeReplay();
 }
 assert.deepEqual(snapshots[0],snapshots[1]); assert.equal(snapshots[0].exactUsd8.cash,'100200000000');
});

test('F automatic PAUSED survives restart; strategy cannot reset; explicit safe reset',async t=>{
 const d=temp(t); let r=await open(d,true);
 r.submitMarketEvent(mark(1));r.submitVirtualIntent(entry(2));
 r.submitMarketEvent(mark(3,.94)); assert.equal(r.getRiskState(),'PAUSED');
 assert.equal(r.getReplayReport().riskTransitions.at(-1).payload.reasonCode,'DAILY_LOSS_LIMIT');
 r.closeReplay();r=await open(d);t.after(()=>r.closeReplay());assert.equal(r.getRiskState(),'PAUSED');
 assert.throws(()=>r.submitVirtualIntent(input(4,'administrative',{reason:'bypass'})),/INTENT/);
 assert.throws(()=>r.administrativeRecover(input(4,'administrative',{reason:'unsafe'})),/UNSAFE/);
 r.submitVirtualIntent(exit(4));
 r.submitMarketEvent(mark(5,1));
 // Daily loss is still breached: an administrator cannot clear the financial trigger.
 assert.throws(()=>r.administrativeRecover(input(6,'administrative',{reason:'still unsafe'})),/UNSAFE/);
});

test('F margin HALTED persists; marks and protective virtual close allowed',async t=>{
 const d=temp(t);let r=await open(d,true);r.submitMarketEvent(mark(1));r.submitVirtualIntent(entry(2));
 r.submitMarketEvent(mark(3,.001)); assert.equal(r.getRiskState(),'HALTED');
 r.closeReplay();r=await open(d);t.after(()=>r.closeReplay());assert.equal(r.getRiskState(),'HALTED');
 const p=r.getReplaySnapshot().position;r.submitVirtualIntent(entry(4));assert.deepEqual(r.getReplaySnapshot().position,p);
 r.submitVirtualIntent(exit(5));assert.equal(r.getReplaySnapshot().position,null);
});

test('F stale/spread/invalid quotes persist pause without invalid mark',async t=>{
 for(const q of [mark(1,1,1.01),mark(1,-1,1),mark(1,1,1,'2026-01-05T12:00:00.000Z',time)]) {
  const d=temp(t);const r=await open(d,true);r.submitMarketEvent(q);assert.equal(r.getRiskState(),'PAUSED');
  assert.equal(r.getReplaySnapshot().lastMarketMark,1);r.closeReplay();
  const recovered=await open(d);assert.equal(recovered.getRiskState(),'PAUSED');recovered.closeReplay();
 }
});

test('F lifecycle, missing session, configuration mismatch and safe close',async t=>{
 const d=temp(t);await assert.rejects(open(d),/MISSING/); const r=await open(d,true);
 await assert.rejects(open(d,true),/EXISTS/);await assert.rejects(open(d,false,{...config,initialCapital:2000}),/MISMATCH/);
 r.closeReplay();r.closeReplay();assert.throws(()=>r.submitMarketEvent(mark(1)),/NOT_READY/);
 const again=await open(d);assert.equal(again.getReplaySnapshot().lifecycle,'READY');again.closeReplay();
});

test('F actual lock fail-closed, explicit recovery, retry and competing connection duplicate',async t=>{
 const d=temp(t);const r=await open(d,true),other=await open(d);t.after(()=>{r.closeReplay();other.closeReplay();});
 const db=new DatabaseSync(join(d,'orion.sqlite'));db.exec('BEGIN IMMEDIATE');
 assert.throws(()=>r.submitMarketEvent(mark(1)),/STORAGE_FAILURE/);
 assert.equal(r.getReplaySnapshot().lifecycle,'DEGRADED');assert.throws(()=>r.submitVirtualIntent(entry(2)),/NOT_READY/);
 db.exec('ROLLBACK');db.close();r.recoverReplay();r.submitMarketEvent(mark(1));
 assert.equal(other.submitMarketEvent(mark(1)).idempotent,true);
 other.submitVirtualIntent(entry(2));assert.equal(r.submitVirtualIntent(entry(2)).idempotent,true);
 assert.equal(r.getReplaySnapshot().ledger.length,1);
});

test('F atomic planner rolls back all effects; corrupted committed payload rejects recovery',async t=>{
 const d=temp(t);const r=await open(d,true);r.submitMarketEvent(mark(1));const before=r.getReplaySnapshot();
 const j=await openJournal(d);
 assert.throws(()=>j.appendPlanned(config.sessionId,(events)=>[
  {eventId:'invalid',sessionId:config.sessionId,sequence:events.length+1,eventType:'VIRTUAL_POSITION_CLOSED',eventTimestamp:time,schemaVersion:1,payload:{exit:1,reason:'no position',commissionUsd8:'0'}}
 ]),/INVALID_CLOSE/);
 assert.deepEqual(r.getReplaySnapshot(),before);j.close();r.closeReplay();
 const db=new DatabaseSync(join(d,'orion.sqlite'));db.exec("UPDATE events SET digest='bad' WHERE sequence=3");db.close();
 await assert.rejects(open(d),/CORRUPTION/);
});

test('F administrative reset requires eligible fresh quote and flat healthy state',async t=>{
 const d=temp(t),r=await open(d,true);t.after(()=>r.closeReplay());r.submitMarketEvent(mark(1,1,1.1));assert.equal(r.getRiskState(),'PAUSED');
 r.submitMarketEvent(mark(2));r.administrativeRecover(input(3,'administrative',{reason:'fixture inspection complete'}));assert.equal(r.getRiskState(),'ACTIVE');
 r.submitVirtualIntent(entry(4));assert.ok(r.getReplaySnapshot().position);
});

test('F real SIGKILL after durable open, lost response retry reconstructs once',async t=>{
 const d=temp(t);
 const child=fork(new URL('./fixtures/durable-replay-child.js',import.meta.url),[d],{stdio:['ignore','ignore','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const message=await Promise.race([once(child,'message'),once(child,'exit').then(([code])=>{throw new Error(`child exited ${code}`);})]);
 assert.equal(message[0],'COMMITTED');const dead=once(child,'exit');child.kill('SIGKILL');await dead;
 const r=await open(d);t.after(()=>r.closeReplay());assert.equal(r.getReplaySnapshot().position.units,400);
 assert.equal(r.submitVirtualIntent(entry(2)).idempotent,true);assert.equal(r.getReplaySnapshot().ledger.length,1);
});

test('F SQL abort after input insert rolls back input, financial effects and sequence',async t=>{
 const d=temp(t),r=await open(d,true);t.after(()=>r.closeReplay());r.submitMarketEvent(mark(1));const before=r.getReplaySnapshot();
 const db=new DatabaseSync(join(d,'orion.sqlite'));
 db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON events WHEN json_extract(NEW.body,'$.eventType')='VIRTUAL_POSITION_OPENED' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END");
 assert.throws(()=>r.submitVirtualIntent(entry(2)),/STORAGE_FAILURE/);
 assert.equal(r.getReplaySnapshot().lifecycle,'DEGRADED');
 db.exec('DROP TRIGGER injected_failure');db.close();r.recoverReplay();
 assert.deepEqual(r.getReplaySnapshot(),before);r.submitVirtualIntent(entry(2));assert.equal(r.getReplaySnapshot().ledger.length,1);
});

test('F negative equity remains exact after recovery with leveraged fixture policy',async t=>{
 const d=temp(t),c={...config,risk:{riskFraction:.01,maxRiskFraction:.01,leverage:10,maxExposure:100000}};
 let r=await open(d,true,c);r.submitMarketEvent(mark(1));
 r.submitVirtualIntent(input(2,'entry',{side:1,stopDistance:.001,takeDistance:.002,commissionUsd8:'100000000'}));
 assert.equal(r.getReplaySnapshot().position.units,9000);
 r.submitMarketEvent(mark(3,.001));assert.equal(r.getRiskState(),'HALTED');
 const exact=r.getReplaySnapshot().exactUsd8;assert.equal(exact.equity,'-799200000000');r.closeReplay();
 r=await open(d,false,c);assert.deepEqual(r.getReplaySnapshot().exactUsd8,exact);assert.equal(r.getRiskState(),'HALTED');r.closeReplay();
});

test('F synchronized real competing processes apply the same intent once',async t=>{
 const d=temp(t),r=await open(d,true);r.submitMarketEvent(mark(1));r.closeReplay();
 const children=Array.from({length:2},()=>fork(new URL('./fixtures/durable-replay-race.js',import.meta.url),[d,JSON.stringify(config)],{stdio:['ignore','ignore','ignore','ipc']}));
 t.after(()=>children.forEach(child=>{if(child.exitCode===null)child.kill('SIGKILL');}));
 await Promise.all(children.map(child=>once(child,'message')));
 const results=children.map(child=>once(child,'message'));
 const exits=children.map(child=>once(child,'exit'));
 for(const child of children)child.send(entry(2));
 const messages=await Promise.all(results);await Promise.all(exits);
 assert.deepEqual(messages.map(([m])=>m.idempotent).sort(),[false,true]);
 const recovered=await open(d);assert.equal(recovered.getReplaySnapshot().ledger.length,1);assert.equal(recovered.getReplaySnapshot().position.units,400);recovered.closeReplay();
});
