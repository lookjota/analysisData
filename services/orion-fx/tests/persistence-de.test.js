import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openJournal, hash } from '../persistence/journal.js';
import { DatabaseSync } from 'node:sqlite';
const moduleUrl = new URL('../persistence/journal.js', import.meta.url).href;
const time = '2026-01-01T00:00:00.000Z';
const event = (sequence, eventType, payload, eventId = 'e'+sequence) => ({ sessionId:'s', eventId, sequence, eventType, payload, schemaVersion:1, eventTimestamp:time });
const init = event(1,'SESSION_INITIALIZED',{initialCapital:1000});
const opened = event(2,'VIRTUAL_POSITION_OPENED',{side:1,entry:1.1,units:1000,stopDistance:null,takeDistance:null,marginUsd8:'11000000000',commissionUsd8:'100000000'});
async function fixture(fn) { const dir=mkdtempSync(join(tmpdir(),'orion-de-')); let j; try { j=await openJournal(dir); await fn(j,dir); } finally { try { j?.close(); } catch {} rmSync(dir,{recursive:true,force:true}); } }
test('journal: replay exact USD8, duplicate, conflict, rollback and persistent risk', async () => fixture(async (j,dir) => {
  j.submit(init); j.submit(opened);
  assert.equal(j.submit(opened).idempotent,true);
  assert.throws(()=>j.submit({...opened,payload:{...opened.payload,entry:1.2}}),/CONFLICT/);
  assert.throws(()=>j.submit(event(4,'MARKET_MARKED',{price:1})),/SEQUENCE/);
  assert.throws(()=>j.submit(event(3,'VIRTUAL_POSITION_CLOSED',{exit:-1,reason:'bad',commissionUsd8:'0'})),/INVALID_CLOSE/);
  assert.equal(j.recover('s').sequence,2);
  j.submit(event(3,'VIRTUAL_SWAP_BOOKED',{amountUsd8:'300000000'}));
  j.submit(event(4,'MARKET_MARKED',{price:0.9}));
  j.submit(event(5,'RISK_HALTED',{trigger:'DRAWDOWN_LIMIT'}));
  const reference=j.recover('s');
  assert.equal(reference.exactUsd8.cash,'99600000000');
  assert.equal(reference.exactUsd8.equity,'79600000000');
  const second=await openJournal(dir); assert.deepEqual(second.recover('s'),reference);
  assert.throws(()=>second.submit({...opened,sequence:6,eventId:'blocked'}),/RISK_BLOCKED/); second.close();
  j.submit(event(6,'VIRTUAL_POSITION_CLOSED',{exit:0.9,reason:'reduce',commissionUsd8:'200000000'}));
  assert.equal(j.recover('s').exactUsd8.cash,'79400000000');
  assert.equal(j.recover('s').riskState,'HALTED');
}));
test('journal: PAUSED survives reopen; schemas, BigInt and unsafe paths rejected', async () => fixture(async(j,dir)=>{
  j.submit(init); j.submit(event(2,'RISK_PAUSED',{trigger:'STALE_DATA'}));
  const second=await openJournal(dir); assert.equal(second.recover('s').riskState,'PAUSED'); second.close();
  assert.throws(()=>j.submit(event(3,'UNKNOWN',{})),/INVALID_EVENT/);
  assert.throws(()=>j.submit(event(3,'MARKET_MARKED',{price:1,secret:'x'})),/SCHEMA/);
  assert.throws(()=>hash({amount:1n}),/CANONICAL/);
  await assert.rejects(openJournal(dir,'../escape.sqlite'),/UNSAFE/);
  symlinkSync(join(dir,'orion.sqlite'),join(dir,'linked.sqlite'));
  await assert.rejects(openJournal(dir,'linked.sqlite'));
}));
test('journal: corruption fails closed and writer lock rolls back', async()=>fixture(async(j,dir)=>{
  j.submit(init);
  const db=new DatabaseSync(join(dir,'orion.sqlite'));
  db.exec('BEGIN IMMEDIATE');
  assert.throws(()=>j.submit(event(2,'MARKET_MARKED',{price:1})),/locked/);
  db.exec('ROLLBACK'); assert.equal(j.recover('s').sequence,1);
  db.exec("UPDATE events SET body=replace(body,'1000','2000')"); db.close();
  assert.throws(()=>j.recover('s'),/CORRUPTION/);
}));
test('real process exit after commit: lost acknowledgement and open HALTED position recover', async()=>fixture(async(j,dir)=>{
  j.submit(init);
  const code=`import {openJournal} from ${JSON.stringify(moduleUrl)}; const j=await openJournal(process.argv[1]); j.submit(${JSON.stringify(opened)}); j.submit(${JSON.stringify(event(3,'RISK_HALTED',{trigger:'test'}))}); process.kill(process.pid,'SIGKILL');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,dir]); assert.equal(child.signal,'SIGKILL');
  assert.equal(j.submit(opened).idempotent,true);
  assert.equal(j.recover('s').riskState,'HALTED'); assert.equal(j.recover('s').position.units,1000);
}));
test('durable holdout: reserved crash remains used across process and parameter changes',async()=>fixture(async(j,dir)=>{
  const scope={dataset:'canonical-content',split:[1,2],methodology:'v1'};
  const code=`import {openJournal} from ${JSON.stringify(moduleUrl)}; const j=await openJournal(process.argv[1]); j.reserveHoldout(${JSON.stringify(scope)},{parameters:1}); process.kill(process.pid,'SIGKILL');`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code,dir]).signal,'SIGKILL');
  assert.throws(()=>j.reserveHoldout(scope,{parameters:2}),/ALREADY_CONSUMED/);
  assert.equal(j.holdoutStatus(hash(scope))[0].status,'RESERVED');
  const reservation=j.reserveHoldout(scope,{parameters:2},true); assert.equal(reservation.reused,true);
  j.consumeHoldout(reservation,hash({result:1})); j.consumeHoldout(reservation,hash({result:1}));
  assert.throws(()=>j.consumeHoldout(reservation,hash({result:2})),/CONFLICT/);
  assert.equal(j.holdoutStatus(hash(scope))[1].status,'CONSUMED');
  const db=new DatabaseSync(join(dir,'orion.sqlite')); db.exec("UPDATE holdouts SET status='CONSUMED' WHERE attempt=1"); db.close();
  assert.throws(()=>j.holdoutStatus(hash(scope)),/HOLDOUT_CORRUPTION/);
}));

test('continuous versus reopened events: short, negative equity and fees exactly once',async()=>fixture(async(j,dir)=>{
  const reference=await openJournal(dir,'reference.sqlite');
  const events=[init,{...opened,payload:{...opened.payload,side:-1}},event(3,'MARKET_MARKED',{price:3}),event(4,'VIRTUAL_POSITION_CLOSED',{exit:3,reason:'gap',commissionUsd8:'200000000'})];
  for(const e of events) reference.submit(e);
  j.submit(events[0]); j.submit(events[1]);
  const recovered=await openJournal(dir); for(const e of events.slice(2)) recovered.submit(e);
  assert.deepEqual(recovered.recover('s'),reference.recover('s'));
  assert.equal(recovered.recover('s').exactUsd8.cash,'-90300000000'); recovered.close(); reference.close();
}));
test('real interrupted uncommitted SQLite transaction is rolled back on reopen',async()=>fixture(async(j,dir)=>{
  j.submit(init);
  const code=`import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec("BEGIN IMMEDIATE; DELETE FROM events;"); process.kill(process.pid,'SIGKILL');`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code,join(dir,'orion.sqlite')]).signal,'SIGKILL');
  assert.equal(j.recover('s').sequence,1);
}));
test('research integration: SYNTHETIC DATA evaluation survives new research session',async()=>fixture(async(j,dir)=>{
  const {createResearchSession}=await import('../optimization/session.js');
  const {syntheticCandles}=await import('../data/fixtures/synthetic.js');
  const rows=syntheticCandles({count:100});
  const session=createResearchSession(rows,{registry:j}); session.optimize([{id:'no-trade'}]); session.freeze();
  const result=session.evaluateFinal({authorization:'local-review'}); assert.equal(result.dataset.synthetic,true);
  const other=await openJournal(dir);
  const next=createResearchSession(rows,{registry:other}); next.optimize([{id:'no-trade'}]); next.freeze();
  assert.equal(next.status().registryMode,'DURABLE'); assert.equal(next.status().holdoutConsumptionCount,1); assert.equal(next.status().durableHoldoutState,'CONSUMED');
  assert.throws(()=>next.evaluateFinal({authorization:'second-review'}),/ALREADY_CONSUMED/);
  assert.equal(next.evaluateFinal({authorization:'explicit-reuse',allowReuse:true}).research.holdoutReused,true); other.close();
}));
