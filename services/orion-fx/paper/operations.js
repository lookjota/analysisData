import { openStrategyReplay } from './strategy-durable.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { canonical, hash } from '../persistence/journal.js';

export const candidates = Object.freeze(['trend','mean-reversion','breakout','ma-cross']);
export const operationalConfig = Object.freeze({version:'orion.paper-run.v1',mode:'ENGINEERING_REPLAY',instrument:'EUR/USD',timeframe:'H1',accountCurrency:'USD',initialCapital:1000,parameters:Object.freeze({fast:2,slow:3,period:2,rsiPeriod:2,atrPeriod:2}),tradingEnabled:false,brokerExecution:'DISABLED',risk:Object.freeze({riskFraction:.005,dailyLossFraction:.01,maxExposure:1000,leverage:1,maxPositions:1}),costs:Object.freeze({spreadPips:1,slippagePips:.1,commissionPerUnit:0,swapPerUnitPerDay:0})});
// Deliberately restricted to a reproducible invented fixture. No research artifact is opened.
export function engineeringArtifact() {
  const rows=syntheticCandles({count:24,regime:'mixed'});
  return {version:'orion.engineering-fixture.v1',classification:'SYNTHETIC_ENGINEERING_ONLY',rows,contentHash:hash(rows)};
}
export async function openPaperRun({directory,runId,artifact,create=false}) {
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(runId??'')) throw new Error('INVALID_RUN_ID');
  if(canonical(artifact)!==canonical(engineeringArtifact())) throw new Error('UNVERIFIED_ENGINEERING_ARTIFACT');
  const accounts=[];
  try {
    for(const strategyId of candidates) accounts.push(await openStrategyReplay({directory,filename:`${runId}-${strategyId}.sqlite`,sessionId:`${runId}-${strategyId}`,rows:artifact.rows,create,options:{strategyId,parameters:operationalConfig.parameters,initialCapital:operationalConfig.initialCapital,risk:operationalConfig.risk,costs:operationalConfig.costs,dataValidation:{asOf:'2024-02-01T00:00:00.000Z',calendarMode:'calendar-v1'}}}));
  } catch(error) {for(const account of accounts) account.close();throw error;}
  const status=()=>({runId,configuration:operationalConfig,dataSource:artifact.classification,inputHash:artifact.contentHash,inputQuality:'VERIFIED_FIXED_SYNTHETIC_FIXTURE',financialReconciliation:'VERIFIED',lastError:null,accounts:accounts.map((account,i)=>({strategyId:candidates[i],...account.status()}))});
  return {status,run(limit=1){if(!Number.isSafeInteger(limit)||limit<1||limit>24) throw new Error('INVALID_STEP_LIMIT');for(const account of accounts) account.run(limit);return status();},report(){return {...status(),reports:accounts.map(account=>account.report())};},close(){for(const account of accounts) account.close();}};
}
