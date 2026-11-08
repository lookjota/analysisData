import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineeringArtifact, openPaperRun, operationalConfig } from '../paper/operations.js';
import { runOperations } from '../cli/operations.js';
test('V3.4-A four isolated accounts recover and reconcile against uninterrupted processing',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'orion-ops-'));
 try {
  const artifact=engineeringArtifact();
  let worker=await openPaperRun({directory,runId:'restart',artifact,create:true});
  assert.equal(worker.status().accounts.length,4);worker.run(7);worker.close();
  worker=await openPaperRun({directory,runId:'restart',artifact});worker.run(24);
  const reference=await openPaperRun({directory,runId:'reference',artifact,create:true});reference.run(24);
  for(let i=0;i<4;i++){
   const actual=worker.status().accounts[i], expected=reference.status().accounts[i];
   assert.equal(actual.committedCandles,24);assert.equal(actual.recoveryCount,1);
   const {sequence:a,...state}=actual.snapshot;const {sequence:b,...other}=expected.snapshot;assert.deepEqual(state,other);
   assert.equal(BigInt(state.exactUsd8.cash),100000000000n+state.ledger.reduce((sum,e)=>sum+BigInt(e.amountUsd8),0n));
  }
  assert.ok(worker.status().accounts.some(a=>a.snapshot.trades.length>0));
  const trend=worker.status().accounts[0];
  assert.equal(trend.snapshot.riskState,'HALTED');
  assert.equal(trend.latestRiskEvent.payload.reasonCode,'EXPOSURE_LIMIT');
  assert.equal(trend.latestRiskEvent.payload.riskMetrics.exposure,'100001550272');
  assert.equal(trend.snapshot.trades[0].netPnlUsd8,'53250068');
  const before=worker.status();worker.run(1);assert.deepEqual(worker.status(),before);
  assert.equal(operationalConfig.risk.dailyLossFraction,.01);assert.equal(operationalConfig.tradingEnabled,false);
  worker.close();reference.close();
  const changed=engineeringArtifact();changed.rows[0].close+=.01;await assert.rejects(openPaperRun({directory,runId:'bad',artifact:changed,create:true}),/UNVERIFIED/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('V3.4-A CLI rejects hidden settings, unknown commands and forward mode',async()=>{
 for(const args of [['paper:ops:step','--run','x','--input','x.json','--limit','0'],['paper:ops:init','--run','x','--input','x.json','--mode','FORWARD_PAPER'],['unknown']]) assert.equal(await runOperations(args,{output:()=>{},errorOutput:()=>{}}),1);
});
