import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStrategyReplay } from '../paper/strategy-durable.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
const parameters = { fast:2, slow:3, period:2, rsiPeriod:2, atrPeriod:2 };
export const rows = () => syntheticCandles({ count:16, regime:'up' });
export const options = { strategyId:'trend', parameters, costs:{ commissionPerOrder:.1 }, trailingDistance:.003 };
async function fixture(fn) {
  const directory = await mkdtemp(join(tmpdir(),'orion-f2-'));
  try { await fn(directory); } finally { await rm(directory,{recursive:true,force:true}); }
}
test('F2 built-in legacy parity and recovered pending/position parity', async () => fixture(async directory => {
  for (const strategyId of ['trend','mean-reversion','breakout','ma-cross']) {
    const config = { ...options,strategyId };
    const a = await openStrategyReplay({directory,filename:`${strategyId}.sqlite`,sessionId:strategyId,rows:rows(),options:config,create:true});
    for(let i=0;i<7;i++) a.step();
    const checkpoint = a.status();
    assert.equal(checkpoint.committedCandles,7);
    assert.ok(checkpoint.pendingIntent.intentId);
    a.close();
    const b = await openStrategyReplay({directory,filename:`${strategyId}.sqlite`,sessionId:strategyId,rows:rows(),options:config});
    b.run();
    const report = b.report();
    const legacy = backtest(rows(), {strategy:createStrategy(strategyId,parameters),costs:options.costs,trailingDistance:options.trailingDistance,closeAtEnd:false});
    assert.deepEqual(report.trades,legacy.trades);
    assert.deepEqual(report.ledger,legacy.ledger);
    assert.deepEqual(report.equityCurve,legacy.equityCurve);
    assert.deepEqual(report.decisions,legacy.decisions);
    assert.deepEqual(report.fills,legacy.fills);
    assert.deepEqual(report.orders,legacy.orders);
    assert.deepEqual(report.riskEvents,legacy.riskEvents);
    assert.equal(b.step().done,true);
    b.close();
  }
}));
test('F2 identity mismatch, future isolation, warmup and duplicate step',async()=>fixture(async directory=>{
  const a=await openStrategyReplay({directory,sessionId:'isolation',rows:rows(),options,create:true});
  a.run(4); const first=a.status();
  assert.equal(first.snapshot.position,null);
  a.close();
  const changed=rows(); changed[10]={...changed[10],high:2};
  await assert.rejects(openStrategyReplay({directory,sessionId:'isolation',rows:changed,options}),/CONFIGURATION_MISMATCH/);
  const b=await openStrategyReplay({directory,filename:'future.sqlite',sessionId:'other',rows:changed,options,create:true});
  b.run(4); assert.deepEqual(b.status().snapshot.exactUsd8,first.snapshot.exactUsd8); assert.deepEqual(b.status().pendingIntent.signal,first.pendingIntent.signal); b.close();
}));

import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { htmlReport, enrich } from '../reporting/index.js';
import { run } from '../cli/index.js';
import { writeFile } from 'node:fs/promises';
import { exportCsv } from '../market-data/historical.js';

test('F2 SIGKILL with durable pending signal and open position matches continuous',async()=>fixture(async directory=>{
  for(const steps of [4,6]) {
    const open={directory,filename:`killed${steps}.sqlite`,sessionId:`killed${steps}`,rows:rows(),options,create:true};
    const child=fork(new URL('./fixtures/strategy-durable-child.js',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']});
    try {
      child.send({open,steps});
      const [message]=await once(child,'message');assert.equal(message.barrier,true,JSON.stringify(message));
      if(steps===6) assert.ok(message.status.snapshot.position);
      const exited=once(child,'exit');child.kill('SIGKILL');const [,signal]=await exited;assert.equal(signal,'SIGKILL');
      const recovered=await openStrategyReplay({...open,create:false});recovered.run();
      const continuous=await openStrategyReplay({...open,filename:`continuous${steps}.sqlite`,create:true});continuous.run();
      assert.deepEqual(recovered.report().ledger,continuous.report().ledger);
      assert.deepEqual(recovered.report().equityCurve,continuous.report().equityCurve);
      const {sequence:recoveredSequence,...recoveredFinancial}=recovered.status().snapshot;
      const {sequence:continuousSequence,...continuousFinancial}=continuous.status().snapshot;
      assert.deepEqual(recoveredFinancial,continuousFinancial);
      assert.equal(recoveredSequence,continuousSequence+1);
      recovered.close();continuous.close();
    } finally {if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');}
  }
}));

test('F2 PAUSED/HALTED remain latched after restart and block subsequent entries',async()=>fixture(async directory=>{
  for(const state of ['PAUSED','HALTED']) {
    const data=syntheticCandles({count:12,regime:'flat'});
    data[4]={...data[4],low:1};
    const config={...options,strategyId:'risk-managed-hold',risk:{dailyLossFraction:.001,maxDrawdownFraction:state==='HALTED'?.001:.5,maxExposure:10000,leverage:10}};
    const open={directory,filename:`${state}.sqlite`,sessionId:state,rows:data,options:config};
    const a=await openStrategyReplay({...open,create:true});a.run(5);
    assert.equal(a.status().snapshot.riskState,state);const opens=a.report().ledger.filter(e=>e.type==='OPEN').length;a.close();
    const b=await openStrategyReplay(open);b.run();assert.equal(b.status().snapshot.riskState,state);
    assert.equal(b.report().ledger.filter(e=>e.type==='OPEN').length,opens);b.close();
  }
}));

test('F2 short, variable spread, fee and midnight swap parity with independent cash sum',async()=>fixture(async directory=>{
  const data=syntheticCandles({count:16,regime:'down'}).map((c,i)=>{
    const spread=.0001+(i%3)*.00002;
    const bar=delta=>Object.fromEntries(['open','high','low','close'].map(k=>[k,c[k]+delta]));
    return {...c,timestamp:new Date(Date.parse('2024-01-08T16:00:00Z')+i*3600000).toISOString(),quoteBars:{bid:bar(-spread/2),ask:bar(spread/2)}};
  });
  const costs={commissionPerOrder:.1,swapPerUnitPerDay:.00001,slippagePips:.2};
  const config={...options,costs,trailingDistance:.0005};
  const a=await openStrategyReplay({directory,sessionId:'short',rows:data,options:config,create:true});a.run(9);a.close();
  const b=await openStrategyReplay({directory,sessionId:'short',rows:data,options:config});b.run();
  const result=b.report(), legacy=backtest(data,{strategy:createStrategy('trend',parameters),costs,trailingDistance:.0005,closeAtEnd:false});
  assert.ok(result.fills.some(f=>f.side===-1));assert.ok(result.ledger.some(e=>e.type==='SWAP'));
  assert.deepEqual(result.ledger,legacy.ledger);
  assert.equal(BigInt(b.status().snapshot.exactUsd8.cash),100000000000n+result.ledger.reduce((sum,e)=>sum+BigInt(e.amountUsd8),0n));
  b.close();
}));

test('F2 missing hours, closed market and incompatible calendar rejected',async()=>fixture(async directory=>{
  await assert.rejects(openStrategyReplay({directory,sessionId:'schedule',rows:rows(),options:{...options,costSchedule:[{}]},create:true}),/INVALID_COST_SCHEDULE/);
  const mixed=rows();const bar=Object.fromEntries(['open','high','low','close'].map(k=>[k,mixed[0][k]]));mixed[0]={...mixed[0],quoteBars:{bid:bar,ask:bar}};
  await assert.rejects(openStrategyReplay({directory,sessionId:'mixed',rows:mixed,options,create:true}),/PRICE_MODEL_DATA_MISMATCH/);
  const gap=rows();gap.splice(7,1);
  await assert.rejects(openStrategyReplay({directory,sessionId:'gap',rows:gap,options,create:true}),/DATA_QUALITY_REJECTED/);
  const closed=rows().map((c,i)=>({...c,timestamp:new Date(Date.parse('2024-01-06T00:00:00Z')+i*3600000).toISOString()}));
  await assert.rejects(openStrategyReplay({directory,sessionId:'closed',rows:closed,options,create:true}),/CLOSED_MARKET_CANDLE/);
  const a=await openStrategyReplay({directory,sessionId:'calendar',rows:rows(),options,create:true});a.run(2);a.close();
  await assert.rejects(openStrategyReplay({directory,sessionId:'calendar',rows:rows(),options:{...options,dataValidation:{calendar:{provider:'different'}}}}),/CONFIGURATION_MISMATCH/);
}));

test('F2 real SQLite writer lock fails closed; reopening resumes without duplicated financial effects',async()=>fixture(async directory=>{
  const open={directory,sessionId:'locked',rows:rows(),options};
  const a=await openStrategyReplay({...open,create:true});a.run(6);
  const db=new DatabaseSync(join(directory,'strategy.sqlite'));db.exec('BEGIN IMMEDIATE');
  assert.throws(()=>a.step());assert.throws(()=>a.step(),/NOT_READY/);db.exec('ROLLBACK');db.close();a.close();
  const b=await openStrategyReplay(open);b.run();const ledger=b.report().ledger;b.close();
  const c=await openStrategyReplay(open);assert.equal(c.step().done,true);assert.deepEqual(c.report().ledger,ledger);c.close();
}));

test('F2 JSON/HTML metadata and CLI offline path rejection',async()=>fixture(async directory=>{
  const a=await openStrategyReplay({directory,sessionId:'report',rows:rows(),options,create:true});a.run();
  const report=enrich(a.report());report.operationalWarnings.push('<script>bad()</script>');
  const html=htmlReport(report);assert.ok(html.includes('lastCommittedSequence'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.equal(JSON.parse(JSON.stringify(report)).durability.financialReconciliation,'VERIFIED');a.close();
  const input=join(directory,'input.csv');await writeFile(input,exportCsv(rows()));
  const fetchImpl=()=>{throw new Error('NETWORK_FORBIDDEN');};const errors=[];
  assert.equal(await run(['paper:durable:run','--input',input,'--session','../escape'],{env:{},fetchImpl,output:()=>{},errorOutput:x=>errors.push(x)}),1);
  assert.ok(errors.some(e=>e.includes('INVALID_ARGUMENTS')));
  assert.equal(await run(['paper:durable:run','--help'],{env:{},fetchImpl,output:()=>{},errorOutput:()=>{}}),0);
}));

import { runDurable } from '../cli/durable.js';
import { canonical, hash } from '../persistence/journal.js';

test('F2 offline CLI create, inspect, recover, verify and JSON/HTML report',async()=>fixture(async directory=>{
  const input=join(directory,'input.csv');await writeFile(input,exportCsv(rows()));
  const common=['--input',input,'--session','cli','--parameters',JSON.stringify(parameters),'--strategy','trend'];
  const output=[];const errors=[];const io={rootDirectory:directory,output:x=>output.push(x),errorOutput:x=>errors.push(x)};
  for(const command of ['run','status','recover','verify','report']) {
    const args=[`paper:durable:${command}`,...common,...(command==='report'?['--out','checked']:[])];
    assert.equal(await runDurable(args,io),0,errors.join('\n'));
    const result=JSON.parse(output.at(-1));
    assert.equal(command==='report'?result.durability.financialReconciliation:result.financialReconciliation,'VERIFIED');
  }
}));

test('F2 corrupt digest and forged pending identity block recovery',async()=>fixture(async directory=>{
  for(const mode of ['digest','pending']) {
    const open={directory,filename:`${mode}.sqlite`,sessionId:mode,rows:rows(),options};
    const a=await openStrategyReplay({...open,create:true});a.run(5);a.close();
    const db=new DatabaseSync(join(directory,`${mode}.sqlite`));
    const row=db.prepare("SELECT * FROM events WHERE session=? ORDER BY sequence DESC LIMIT 1").get(mode);
    if(mode==='digest') db.prepare('UPDATE events SET digest=? WHERE session=? AND sequence=?').run('0'.repeat(64),mode,row.sequence);
    else {
      const event=JSON.parse(row.body);event.payload.pendingIntent.intentId='0'.repeat(64);
      db.prepare('UPDATE events SET body=?,digest=? WHERE session=? AND sequence=?').run(canonical(event),hash(event),mode,row.sequence);
    }
    db.close();await assert.rejects(openStrategyReplay(open),mode==='digest'?/JOURNAL_CORRUPTION/:/CHECKPOINT_CONFLICT/);
  }
}));

test('F2 protective ambiguity, target and adverse long/short gaps use existing conservative prices',async()=>fixture(async directory=>{
  for(const scenario of ['ambiguity','target','long-gap','short-gap']) {
    const data=syntheticCandles({count:9,regime:scenario==='short-gap'?'down':'up'}).map(c=>({...c,...Object.fromEntries(['open','high','low','close'].map(k=>[k,Number(c[k].toFixed(8))]))}));
    if(scenario==='ambiguity') data[4]={...data[4],low:.9,high:1.3};
    if(scenario==='target') data[4]={...data[4],high:1.3};
    if(scenario==='long-gap') data[5]={...data[5],open:.9,low:.89,high:1.2};
    if(scenario==='short-gap') data[5]={...data[5],open:1.3,low:1,high:1.31};
    const config={...options,trailingDistance:null};
    const a=await openStrategyReplay({directory,filename:`${scenario}.sqlite`,sessionId:scenario,rows:data,options:config,create:true});a.run();
    const report=a.report(), trade=report.trades[0];assert.ok(trade);
    if(scenario==='ambiguity') assert.equal(trade.reason,'stop-loss');
    if(scenario==='target') assert.equal(trade.reason,'take-profit');
    if(scenario.endsWith('gap')) {
      assert.equal(trade.reason,'stop-gap');
      // Default spread .0001 and adverse slippage .00001, applied to liquidation side.
      assert.ok(Math.abs(trade.exit-(data[5].open-trade.side*.00006))<1e-12);
      assert.ok(trade.side*(trade.exit-trade.stop)<0);
      const gross=BigInt(trade.side)*BigInt(trade.units)*BigInt(Math.round((trade.exit-trade.entry)*1e8));
      const net=gross-BigInt(Math.round((trade.entryCommission+trade.exitCommission+trade.swap)*1e8));
      assert.ok(net-BigInt(trade.netPnlUsd8)>=-1n && net-BigInt(trade.netPnlUsd8)<=1n);
    }
    a.close();
    if(scenario==='ambiguity') {
      const rejected=await openStrategyReplay({directory,filename:'rejected.sqlite',sessionId:'rejected',rows:data,options:{...config,intrabarPolicy:'reject-ambiguous'},create:true});
      rejected.run(4);assert.throws(()=>rejected.step(),/AMBIGUOUS/);rejected.close();
      const reopened=await openStrategyReplay({directory,filename:'rejected.sqlite',sessionId:'rejected',rows:data,options:{...config,intrabarPolicy:'reject-ambiguous'}});
      assert.equal(reopened.status().committedCandles,4);assert.equal(reopened.status().snapshot.position,null);reopened.close();
    }
  }
}));

test('F2 newly tightened trailing stop cannot execute retroactively in its producing candle',async()=>fixture(async directory=>{
  const config={...options,trailingDistance:.0001};
  const open={directory,sessionId:'trailing',rows:rows(),options:config};
  const a=await openStrategyReplay({...open,create:true});a.run(5);
  const p=a.status().snapshot.position;assert.ok(p);assert.ok(p.stop>rows()[4].low);
  assert.equal(a.report().trades.length,0);a.close();
  const b=await openStrategyReplay(open);b.step();assert.equal(b.report().trades[0].reason,'stop-loss');b.close();
}));

test('F2 SQL failure after planned entry rolls back all candle effects and pending work',async()=>fixture(async directory=>{
  const open={directory,sessionId:'rollback',rows:rows(),options};
  const a=await openStrategyReplay({...open,create:true});a.run(4);
  const db=new DatabaseSync(join(directory,'strategy.sqlite'));
  db.exec("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON events WHEN json_extract(NEW.body,'$.eventType')='STRATEGY_CHECKPOINT' BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>a.step());a.close();
  db.exec('DROP TRIGGER fail_checkpoint');db.close();
  const b=await openStrategyReplay(open);assert.equal(b.status().committedCandles,4);assert.equal(b.status().snapshot.position,null);assert.equal(b.report().ledger.length,0);b.step();assert.equal(b.report().ledger.filter(e=>e.type==='OPEN').length,1);b.close();
}));

test('F2 SIGKILL after protective close and persistent PAUSED/HALTED matches uninterrupted risk replay',async()=>fixture(async directory=>{
  for(const riskState of ['PAUSED','HALTED']) {
    const data=syntheticCandles({count:10,regime:'flat'});data[4]={...data[4],low:1};
    const config={...options,strategyId:'risk-managed-hold',risk:{dailyLossFraction:.001,maxDrawdownFraction:riskState==='HALTED'?.001:.5,maxExposure:10000,leverage:10}};
    const open={directory,filename:`crash${riskState}.sqlite`,sessionId:`crash${riskState}`,rows:data,options:config,create:true};
    const child=fork(new URL('./fixtures/strategy-durable-child.js',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']});
    try {
      child.send({open,steps:5});const [message]=await once(child,'message');assert.equal(message.barrier,true,JSON.stringify(message));assert.equal(message.status.snapshot.riskState,riskState);
      const exited=once(child,'exit');child.kill('SIGKILL');await exited;
      const b=await openStrategyReplay({...open,create:false});b.run();
      const a=await openStrategyReplay({...open,filename:`reference${riskState}.sqlite`});a.run();
      assert.deepEqual(b.report().ledger,a.report().ledger);assert.deepEqual(b.report().equityCurve,a.report().equityCurve);
      assert.equal(b.status().snapshot.riskState,riskState);assert.equal(b.report().trades[0].reason,'stop-loss');a.close();b.close();
    } finally {if(child.exitCode===null && child.signalCode===null) child.kill('SIGKILL');}
  }
}));

test('F2 declared weekend across US DST has no fabricated candles and calendar identity survives restart',async()=>fixture(async directory=>{
  const dates=['2024-03-08T21:00:00Z','2024-03-10T21:00:00Z','2024-03-10T22:00:00Z','2024-03-10T23:00:00Z'];
  const data=rows().slice(0,4).map((c,i)=>({...c,timestamp:dates[i]}));
  const open={directory,sessionId:'dst',rows:data,options:{strategyId:'no-trade',parameters}};
  const a=await openStrategyReplay({...open,create:true});a.run(1);a.close();
  const b=await openStrategyReplay(open);b.run();const report=b.report();
  assert.equal(report.dataset.quality.missingHours,0);assert.equal(report.dataset.quality.closedHours,47);assert.equal(report.equityCurve.length,4);assert.equal(report.ledger.length,0);b.close();
}));
