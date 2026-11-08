import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, chmod, link, rename, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { prepareSqlitePath } from '../security/sqlite-path.js';
import { openJournal } from '../persistence/journal.js';
import { initializeForwardJournal, appendForwardObservations, inspectForwardJournal } from '../market-data/forward-journal.js';
import { readStoredJson } from '../market-data/capital-history.js';
import { verifyAcquisitionReceipt } from '../market-data/acquisition-receipt.js';
import { openStrategyReplay } from '../paper/strategy-durable.js';
import { processAppendableJournal } from '../paper/appendable-operations.js';
import { observations, clock, accountOptions } from './fixtures/appendable-c2.js';
const temporary = () => mkdtemp(join(tmpdir(),'orion-c4-'));
async function setup(accounts=false) {
  const root=await temporary(), directory=join(root,'journal');
  await initializeForwardJournal(directory,{},clock);
  if(accounts) {await appendForwardObservations(directory,observations(6),clock);await processAppendableJournal({directory,runId:'demo',action:'init',clock});}
  return directory;
}
async function worker(directory,operation,boundary='none',strategy='trend') {
  const child=fork(new URL('./fixtures/c4-worker.js',import.meta.url),[directory,operation,boundary,strategy],{stdio:['ignore','ignore','pipe','ipc']});
  const messages=[]; child.on('message',m=>messages.push(m));
  const exited=once(child,'exit');
  await once(child,'message');
  return {child,messages,exited,start:()=>child.send('go')};
}
async function killAt(directory,operation,boundary) {
  const w=await worker(directory,operation,boundary);
  const message=once(w.child,'message'); w.start();
  const [m]=await message; assert.equal(m.phase,boundary);
  w.child.kill('SIGKILL'); const [code,signal]=await w.exited;
  assert.equal(code,null);assert.equal(signal,'SIGKILL');return w;
}
function stored(directory,strategy='trend') {
  const db=new DatabaseSync(join(directory,`demo-append-v1-${strategy}.sqlite`));
  try{return db.prepare('SELECT body,digest FROM events ORDER BY sequence').all().filter(r=>JSON.parse(r.body).eventType!=='STRATEGY_RECOVERED');}finally{db.close();}
}
for(const operation of ['receipt','journal','report']) for(const boundary of ['before-create','temporary-synced','published']) {
  test(`C4 SIGKILL ${operation} ${boundary}`, {timeout:30000}, async()=>{
    const directory=await setup(operation==='report');
    let before;
    if(operation==='report') {const a=await openStrategyReplay(await accountOptions(directory));a.run(6);a.close();before=stored(directory);}
    await killAt(directory,operation,boundary);
    const files=await readdir(directory), name=operation==='journal'?'observation-000001.json':`${operation}.json`;
    assert.equal(files.includes(name),boundary==='published');
    assert.equal(files.some(n=>n.endsWith('.tmp')),boundary!=='before-create');
    if(operation==='journal') {const j=await inspectForwardJournal(directory,clock);assert.equal(j.sequence,boundary==='published'?1:0);await appendForwardObservations(directory,observations(1),clock);assert.equal((await inspectForwardJournal(directory,clock)).sequence,1);}
    else if(operation==='receipt'&&boundary==='published') assert.equal(verifyAcquisitionReceipt(await readStoredJson(join(directory,name))).integrity,'VERIFIED_LOCAL_CONTENT_ONLY');
    if(before) assert.deepEqual(stored(directory),before);
    console.log('C4_CRASH',JSON.stringify({operation,boundary,signal:'SIGKILL',files}));
  });
}
for(const boundary of ['before-commit','after-commit','recovery-verification']) test(`C4 SIGKILL account ${boundary}`,{timeout:30000},async()=>{
  const directory=await setup(true), before=stored(directory);
  await killAt(directory,'account',boundary);
  const a=await openStrategyReplay(await accountOptions(directory));
  assert.equal(a.status().cursor.sequence,boundary==='after-commit'?1:0);
  if(boundary!=='after-commit')assert.deepEqual(stored(directory),before);
  a.run(6); const status=a.status();a.close(); const bytes=stored(directory);
  const b=await openStrategyReplay(await accountOptions(directory));b.run(6);assert.deepEqual(b.status().snapshot.exactUsd8,status.snapshot.exactUsd8);b.close();assert.deepEqual(stored(directory),bytes);
  const x=status.snapshot.exactUsd8;assert.equal(BigInt(x.equity),BigInt(x.cash)+BigInt(x.unrealizedPnl));
  console.log('C4_RECOVERY',JSON.stringify({boundary,cursor:status.cursor,exactUsd8:x,events:bytes.length}));
});
for(const scenario of ['same-append','extend-append','same-account','different-account','receipt-collision','reader-writer']) test(`C4 concurrent ${scenario}`,{timeout:30000},async()=>{
  const directory=await setup(scenario.includes('account'));
  const specs=scenario==='same-append'?[['append','1'],['append','1']]:scenario==='extend-append'?[['append','1'],['append','2']]:scenario==='reader-writer'?[['reader','1'],['append','1']]:scenario==='receipt-collision'?[['receipt','trend'],['receipt','trend']]:[['account','trend'],['account',scenario==='different-account'?'breakout':'trend']];
  const workers=await Promise.all(specs.map(([op,strategy])=>worker(directory,op,'none',strategy)));
  workers.forEach(w=>w.start());const exits=await Promise.all(workers.map(w=>w.exited));
  assert.ok(exits.some(([code])=>code===0));
  for(const w of workers)if(w.messages.some(m=>m.error))assert.ok(!w.messages.some(m=>m.done));
  if(scenario.includes('append')||scenario==='reader-writer'){await appendForwardObservations(directory,observations(scenario==='extend-append'?2:1),clock);assert.equal((await inspectForwardJournal(directory,clock)).sequence,scenario==='extend-append'?2:1);}
  if(scenario.includes('account'))for(const strategy of new Set(specs.map(s=>s[1]))) {const a=await openStrategyReplay(await accountOptions(directory,strategy));a.run(6);const bytes=stored(directory,strategy),s=a.status();a.run(6);assert.deepEqual(stored(directory,strategy),bytes);assert.equal(s.cursor.sequence,6);assert.equal(s.financialReconciliation,'VERIFIED');a.close();}
  if(scenario==='receipt-collision')verifyAcquisitionReceipt(await readStoredJson(join(directory,'receipt.json')));
});
test('C4 private SQLite boundary rejects public directories, hardlinks and replacement',async()=>{
  const dir=await temporary();await chmod(dir,0o777);await assert.rejects(openJournal(dir),/PRIVATE_DIRECTORY/);await chmod(dir,0o700);
  const a=await openJournal(dir);assert.throws(()=>prepareSqlitePath(join(dir,'orion.sqlite')),/SQLITE_ALREADY_OPEN_IN_PROCESS/);const shared=await openJournal(dir);shared.close();assert.deepEqual(a.events('demo'),[]);await link(join(dir,'orion.sqlite'),join(dir,'alias.sqlite'));assert.throws(()=>a.events('demo'),/IDENTITY/);a.close();
  await assert.rejects(openJournal(dir),/UNSAFE_SQLITE_FILE/);
  const second=await temporary(),b=await openJournal(second);await rename(join(second,'orion.sqlite'),join(second,'old.sqlite'));await writeFile(join(second,'orion.sqlite'),'');assert.throws(()=>b.events('demo'),/IDENTITY/);b.close();
});
test('C4 refuses unrelated database migration and missing reopen',async()=>{
  const dir=await temporary(),path=join(dir,'orion.sqlite');const db=new DatabaseSync(path);db.exec('CREATE TABLE unrelated(x)');db.close();await chmod(path,0o600);
  const before=await readFile(path);await assert.rejects(openJournal(dir),/UNRECOGNIZED_DATABASE/);assert.deepEqual(await readFile(path),before);
  await assert.rejects(openJournal(dir,'missing.sqlite',{existingOnly:true}),{code:'ENOENT'});
});
test('C4 process filesystem guard rejects synthetic env canary APIs and child inheritance',async()=>{
  const dir=await temporary();await writeFile(join(dir,'.env.canary'),'FAKE_SECRET_C4');
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
    import fs from 'node:fs'; import p from 'node:fs/promises'; import c from 'node:child_process';
    import {installOfflineFileGuard,restrictOfflineEnvironment} from ${JSON.stringify(new URL('../security/offline-guard.js',import.meta.url).href)};
    restrictOfflineEnvironment(); await installOfflineFileGuard();
    const path=process.argv[1];
    for(const attempt of [()=>fs.readFileSync(path),()=>fs.openSync(path,'r'),()=>fs.readFile(path,()=>{}),()=>fs.open(path,'r',()=>{}),()=>p.readFile(path),()=>p.open(path),()=>c.spawn('true'),()=>process.loadEnvFile(path)]) {
      try {await attempt();process.exit(4);}catch(e){if(!e.message.startsWith('OFFLINE_'))throw e;}
    }
    if(process.env.C4_FAKE_SECRET || process.env.TRADING_ENABLED!=='false')process.exit(5);
  `,join(dir,'.env.canary')],{encoding:'utf8',env:{...process.env,C4_FAKE_SECRET:'FAKE_INHERITED_SECRET'}});
  assert.equal(child.status,0,child.stderr);assert.ok(!child.stdout.includes('FAKE_SECRET'));
});
test('C4 Linux namespace denies raw outbound socket from independent child',async t=>{
  const probe=spawnSync('unshare',['--user','--map-root-user','--net',process.execPath,'--input-type=module','-e',`
    import {spawnSync} from 'node:child_process';
    const r=spawnSync(process.execPath,['--input-type=module','-e',
      "import net from 'node:net';const s=net.connect(9,'192.0.2.1');s.setTimeout(1000,()=>process.exit(3));s.on('connect',()=>process.exit(4));s.on('error',e=>{if(!['ENETUNREACH','EHOSTUNREACH','EPERM','EACCES'].includes(e.code))process.exit(5);console.log(e.code);});"],{encoding:'utf8'});
    process.stdout.write(r.stdout);process.exit(r.status??6);
  `],{encoding:'utf8',timeout:5000});
  if(['ENOENT','EPERM','EACCES'].includes(probe.error?.code)||/unshare:.*(?:not permitted|not supported)/i.test(probe.stderr)) {t.skip('User/network namespaces unavailable; OS isolation remains unproven');return;}
  assert.equal(probe.status,0,probe.stderr);assert.match(probe.stdout,/ENETUNREACH|EHOSTUNREACH|EPERM|EACCES/);
});
test('C4 reader verifies prefix while writer holds prepared append; killed owner retry is safe',{timeout:30000},async()=>{
  const directory=await setup();
  const w=await worker(directory,'journal','temporary-synced');
  const reached=once(w.child,'message');w.start();assert.equal((await reached)[0].phase,'temporary-synced');
  const reader=await worker(directory,'reader');reader.start();assert.equal((await reader.exited)[0],0);assert.ok(reader.messages.some(m=>m.sequence===0));
  w.child.kill('SIGKILL');assert.equal((await w.exited)[1],'SIGKILL');
  await appendForwardObservations(directory,observations(1),clock);assert.equal((await inspectForwardJournal(directory,clock)).sequence,1);
});
test('C4 readiness lists unknown OS gates and cannot promote engineering data',async()=>{
  const {assessOpsReadiness}=await import('../paper/ops-readiness.js');
  const directory=await setup(true);const r=await assessOpsReadiness({directory,runId:'demo',clock});
  assert.equal(r.classification,'FORWARD_OBSERVATION_BLOCKED');
  assert.ok(r.failedGates.includes('sourceAuthenticity'));assert.ok(r.unknownGates.includes('credentialIsolation'));assert.ok(r.unknownGates.includes('networkIsolation'));
  const absent=await assessOpsReadiness({directory:join(await temporary(),'missing'),runId:'demo',clock});assert.equal(absent.classification,'UNKNOWN');assert.ok(absent.unknownGates.includes('cursorLedgerAtomicity'));
});
test('C4 concurrent conflicting observations retain both artifacts and explicitly block paper',{timeout:30000},async()=>{
  const directory=await setup();const workers=await Promise.all([worker(directory,'append','none','1'),worker(directory,'conflict')]);
  workers.forEach(w=>w.start());await Promise.all(workers.map(w=>w.exited));
  // Retry both submissions after the zero-wait writer conflict.
  await appendForwardObservations(directory,observations(1),clock);
  const retry=await worker(directory,'conflict');retry.start();assert.equal((await retry.exited)[0],0);
  const j=await inspectForwardJournal(directory,clock);assert.equal(j.sequence,2);assert.equal(j.quarantinedSequences.length,1);
  await assert.rejects(processAppendableJournal({directory,runId:'demo',action:'init',clock}),/QUARANTINED_REVISION_BLOCKS_PROCESSING/);
});
