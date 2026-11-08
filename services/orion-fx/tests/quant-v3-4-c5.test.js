import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,readdir,rename,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fork,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {initializeForwardJournal,appendForwardObservations,inspectForwardJournal} from '../market-data/forward-journal.js';
import {openStrategyReplay} from '../paper/strategy-durable.js';
import {processAppendableJournal} from '../paper/appendable-operations.js';
import {writeAtomicJson} from '../market-data/capital-history.js';
import {canonical,hash} from '../persistence/journal.js';
import {prepareSqlitePath} from '../security/sqlite-path.js';
import {observations,clock,accountOptions} from './fixtures/appendable-c2.js';
const strategies=['trend','mean-reversion','breakout','ma-cross'];
async function setup(count=6){
 const root=await mkdtemp(join(tmpdir(),'orion-c5-')),directory=join(root,'journal');
 await initializeForwardJournal(directory,{},clock);await appendForwardObservations(directory,observations(count),clock);
 await processAppendableJournal({directory,runId:'demo',action:'init',clock});return directory;
}
const path=(d,s='trend')=>join(d,`demo-append-v1-${s}.sqlite`);
const economic = ({sequence,...snapshot})=>snapshot;
async function state(d,s='trend',run=0){
 const a=await openStrategyReplay({...await accountOptions(d,s),journalMode:'WAL'});
 try{if(run)a.run(run);const x=a.status();assert.equal(x.financialReconciliation,'VERIFIED');assert.equal(BigInt(x.snapshot.exactUsd8.equity),BigInt(x.snapshot.exactUsd8.cash)+BigInt(x.snapshot.exactUsd8.unrealizedPnl));return x;}finally{a.close();}
}
function effects(db){return db.prepare('SELECT body,digest FROM events ORDER BY sequence').all().filter(x=>JSON.parse(x.body).eventType!=='STRATEGY_RECOVERED');}
async function financial(d,s='trend'){const db=new DatabaseSync(path(d,s));try{assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');return effects(db);}finally{db.close();}}
async function kill(d,boundary,s='trend'){
 const c=fork(new URL('./fixtures/c5-worker.js',import.meta.url),[d,s,boundary],{stdio:['ignore','ignore','pipe','ipc'],env:{PATH:process.env.PATH,TRADING_ENABLED:'false'}});
 const exited=once(c,'exit');await once(c,'message');const reached=once(c,'message');c.send('go');const [m]=await reached;
 assert.equal(m.phase,boundary,JSON.stringify(m));
 if(['before-commit','after-commit'].includes(boundary)){assert.ok((await stat(path(d,s)+'-wal')).isFile());assert.ok((await stat(path(d,s)+'-shm')).isFile());}
 c.kill('SIGKILL');assert.equal((await exited)[1],'SIGKILL');console.log('C5_SIGKILL',boundary,s);
}
for(const boundary of ['before-commit','after-commit'])test(`C5 WAL SIGKILL ${boundary}`,{timeout:30000},async()=>{
 const d=await setup(),before=await state(d);const reader=new DatabaseSync(path(d));
 try{
 reader.exec('BEGIN');const prior=effects(reader);await kill(d,boundary);
 assert.ok((await stat(path(d)+'-wal')).size>0);assert.deepEqual(effects(reader),prior);reader.exec('COMMIT');
 }finally{reader.close();}
 const recovered=await state(d);assert.equal(recovered.cursor.sequence,boundary==='after-commit'?1:before.cursor.sequence);
 const final=await state(d,'trend',6),bytes=await financial(d);assert.equal(final.cursor.sequence,6);
 const again=await state(d,'trend',6);assert.deepEqual(economic(again.snapshot),economic(final.snapshot));assert.deepEqual(again.pendingIntent,final.pendingIntent);assert.deepEqual(await financial(d),bytes);
 const db=new DatabaseSync(path(d));db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close();assert.deepEqual(economic((await state(d)).snapshot),economic(final.snapshot));
 console.log('C5_WAL',JSON.stringify({boundary,cursor:final.cursor,ledgerHash:hash(final.snapshot.ledger),events:bytes.length,usd8:final.snapshot.exactUsd8,risk:final.snapshot.riskState}));
});
for(const boundary of ['prefix-before-start','prefix-record-verified','prefix-before-final','account-prefix-before-final'])test(`C5 prefix SIGKILL ${boundary}`,{timeout:30000},async()=>{
 const d=await setup();await state(d,'trend',6);const before=await financial(d);await kill(d,boundary);assert.deepEqual(await financial(d),before);
 assert.equal((await state(d)).cursor.sequence,6);assert.deepEqual(await financial(d),before);
 const file=join(d,'observation-000006.json'),record=JSON.parse(await readFile(file,'utf8'));record.previous='0'.repeat(64);await writeFile(file,JSON.stringify(record));
 await assert.rejects(state(d),/JOURNAL_CORRUPTION/);assert.deepEqual(await financial(d),before);
});
test('C5 dedicated laggard child resumes only remaining observations',{timeout:60000},async()=>{
 const d=await setup();const initial={};for(const s of strategies)initial[s]=await state(d,s,6);
 await appendForwardObservations(d,observations(12),clock);const advanced={};for(const s of strategies.slice(0,3)){await state(d,s,12);advanced[s]=await financial(d,s);}
 await kill(d,'after-commit','ma-cross');assert.equal((await state(d,'ma-cross')).cursor.sequence,7);
 const end=await state(d,'ma-cross',24);assert.equal(end.cursor.sequence,12);assert.equal(end.configurationHash,initial['ma-cross'].configurationHash);
 const bytes=await financial(d,'ma-cross');assert.deepEqual(economic((await state(d,'ma-cross',24)).snapshot),economic(end.snapshot));assert.deepEqual(await financial(d,'ma-cross'),bytes);
 for(const s of strategies){const x=await state(d,s);assert.equal(x.cursor.sequence,12);assert.equal(x.cursor.commitment,end.cursor.commitment);if(advanced[s])assert.deepEqual(await financial(d,s),advanced[s]);console.log('C5_ACCOUNT',s,JSON.stringify({usd8:x.snapshot.exactUsd8,risk:x.snapshot.riskState,cursor:x.cursor,ledgerHash:hash(x.snapshot.ledger)}));}
});
for(const [label,phase,code] of [['receipt-space','before-create','ENOSPC'],['publication','before-publication','EIO'],['fsync','before-file-sync','EACCES'],['cleanup','before-cleanup','EIO']])test(`C5 simulated ${label}`,async()=>{
 const d=await mkdtemp(join(tmpdir(),'orion-c5-fault-')),file=join(d,'receipt.json');let acknowledged=false;
 await assert.rejects(async()=>{await writeAtomicJson(file,{synthetic:true},{checkpoint:p=>{if(p===phase)throw Object.assign(Error(code),{code});}});acknowledged=true;},{code});assert.equal(acknowledged,false);
 if(phase==='before-cleanup'){assert.deepEqual(JSON.parse(await readFile(file)),{synthetic:true});assert.ok((await readdir(d)).some(x=>x.endsWith('.tmp')));await assert.rejects(writeAtomicJson(file,{synthetic:true}),{code:'EEXIST'});}
 else{await assert.rejects(readFile(file),{code:'ENOENT'});await writeAtomicJson(file,{synthetic:true});assert.deepEqual(JSON.parse(await readFile(file)),{synthetic:true});}
});
for(const [phase,code] of [['before-create','ENOSPC'],['record-allocation','ENOMEM']])test(`C5 simulated journal ${code}`,async()=>{
 const d=await setup();const before=await inspectForwardJournal(d,clock);await assert.rejects(appendForwardObservations(d,observations(7),clock,{checkpoint:p=>{if(p===phase)throw Object.assign(Error(code),{code});}}),{code});assert.equal((await inspectForwardJournal(d,clock)).head,before.head);await appendForwardObservations(d,observations(7),clock);assert.equal((await inspectForwardJournal(d,clock)).sequence,7);
});
test('C5 SQLite actual SQLITE_FULL bounded page allocation rolls back',async()=>{
 const d=await mkdtemp(join(tmpdir(),'orion-c5-full-')),db=new DatabaseSync(join(d,'bounded.sqlite'));
 try{db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA max_page_count=8; CREATE TABLE bounded(x)');assert.throws(()=>db.exec("BEGIN; INSERT INTO bounded VALUES(zeroblob(131072)); COMMIT"),/full/i);if(db.isTransaction)db.exec('ROLLBACK');assert.equal(db.prepare('SELECT count(*) n FROM bounded').get().n,0);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.exec("INSERT INTO bounded VALUES('retry')");}finally{db.close();}
});
test('C5 input limits reject before publication',async()=>{
 assert.throws(()=>canonical({x:'x'.repeat(262145)}),/PAYLOAD_TOO_LARGE/);const d=await setup();const before=(await inspectForwardJournal(d,clock)).head;await assert.rejects(appendForwardObservations(d,observations(101),clock),/INVALID_BATCH_SIZE/);assert.equal((await inspectForwardJournal(d,clock)).head,before);
});
test('C5 same UID can replace private pathname; retained guard detects observed replacement',async()=>{
 const d=await mkdtemp(join(tmpdir(),'orion-c5-path-')),file=join(d,'test.sqlite'),guard=prepareSqlitePath(file);try{await rename(file,join(d,'old.sqlite'));await writeFile(file,'hostile',{mode:0o600});assert.equal(await readFile(file,'utf8'),'hostile');assert.throws(guard.verify,/IDENTITY_CHANGED/);}finally{guard.close();}
});
test('C5 separate identity filesystem isolation requires operator provision',t=>{t.skip('OS_FILESYSTEM_ISOLATION_UNKNOWN: no authorized dedicated UID/mount boundary; same-UID permissions cannot prove isolation');});
test('C5 network namespace main and child loopback denial',t=>{
 const probe=spawnSync('unshare',['--user','--map-root-user','--net',process.execPath,'--input-type=module','-e',`
 import net from 'node:net';import {spawnSync} from 'node:child_process';
 const code="import net from 'node:net';const s=net.connect(9,'127.0.0.1');s.on('connect',()=>process.exit(2));s.on('error',e=>{console.log(e.code);process.exit(['ECONNREFUSED','EPERM','EACCES','ENETUNREACH'].includes(e.code)?0:3)});";
 await new Promise((resolve,reject)=>{const s=net.connect(9,'127.0.0.1');s.on('connect',()=>reject(Error('unexpected connection')));s.on('error',e=>{if(!['ECONNREFUSED','EPERM','EACCES','ENETUNREACH'].includes(e.code))reject(e);else resolve()});});
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});process.stdout.write('MAIN_DENIED CHILD_'+r.stdout);process.exit(r.status??4);
 `],{encoding:'utf8',timeout:5000});
 if(probe.error||/not permitted|not supported/i.test(probe.stderr)){t.skip('OS_NETWORK_ISOLATION_UNKNOWN: namespace unavailable: '+(probe.error?.code??'EPERM'));return;}assert.equal(probe.status,0,probe.stderr);assert.match(probe.stdout,/MAIN_DENIED CHILD_/);
});

test('C5 simulated SQLite financial transaction ENOSPC leaves cursor and effects unchanged',async()=>{
 const d=await setup(),before=await state(d),bytes=await financial(d);
 const a=await openStrategyReplay({...await accountOptions(d),journalMode:'WAL',faultInjector:p=>{if(p==='before-commit')throw Object.assign(Error('ENOSPC'),{code:'ENOSPC'});}});
 try{assert.throws(()=>a.step(),{code:'ENOSPC'});}finally{a.close();}
 assert.deepEqual(await financial(d),bytes);assert.equal((await state(d)).cursor.sequence,before.cursor.sequence);assert.equal((await state(d,'trend',6)).cursor.sequence,6);
});
test('C5 synthetic filesystem canaries expose same UID limits without reading secrets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orion-c5-canary-'));const allowed=join(root,'allowed'),forbidden=join(root,'forbidden');
 const {mkdir,chmod}=await import('node:fs/promises');await mkdir(allowed,{mode:0o700});await mkdir(forbidden,{mode:0o700});
 await writeFile(join(allowed,'journal'),'SYNTHETIC_JOURNAL');await writeFile(join(forbidden,'credential'),'SYNTHETIC_ONLY',{mode:0o600});await symlink(join(forbidden,'credential'),join(allowed,'alias'));
 const child=fork(new URL('./fixtures/c5-canary-worker.js',import.meta.url),[allowed,forbidden],{stdio:['ignore','ignore','pipe','ipc'],env:{PATH:process.env.PATH,TRADING_ENABLED:'false'}});
 const exited=once(child,'exit');const [message]=await once(child,'message');assert.equal(message.sameUidCanRead,true);assert.equal((await exited)[0],0);
 console.log('OS_FILESYSTEM_ISOLATION_FAILED for same-UID chmod-only model; dedicated runtime remains UNKNOWN');
});
