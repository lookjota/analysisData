import { appendableCommitments } from './appendable-commitments.js';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectForwardJournal } from '../market-data/forward-journal.js';
import { withHistoryPublicationLock } from '../market-data/capital-history.js';
import { candidates, operationalConfig } from './operations.js';
import { openStrategyReplay } from './strategy-durable.js';

export async function processAppendableJournal({directory,runId,action='status',limit=1,clock=()=>new Date().toISOString()}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId??'') || !['init','step','status'].includes(action) || !Number.isSafeInteger(limit) || limit<1 || limit>24) throw new Error('INVALID_ARGUMENTS');
  await inspectForwardJournal(directory,clock);
  return withHistoryPublicationLock(directory,async()=>{
    const journal=await inspectForwardJournal(directory,clock);
    if(journal.quarantinedSequences.length) throw new Error('QUARANTINED_REVISION_BLOCKS_PROCESSING');
    if(!journal.accepted.length) throw new Error('EMPTY_JOURNAL');
    const commitments=appendableCommitments(journal);
    const accounts=[];
    try {
      for(const strategyId of candidates) {
        // Distinct filenames prevent implicit conversion of fixed-watermark accounts.
        const filename=`${runId}-append-v1-${strategyId}.sqlite`;
        let exists=true;
        try {await lstat(join(directory,filename));} catch(error) {if(error.code!=='ENOENT')throw error;exists=false;}
        if(!exists && action==='status') {accounts.push({blocked:true,sessionId:`${runId}-append-v1-${strategyId}`,status:'UNKNOWN',error:'PARTIAL_INITIALIZATION_REQUIRES_INIT'});continue;}
        if(!exists && action!=='init') throw new Error('PARTIAL_INITIALIZATION_REQUIRES_INIT');
        try {
        accounts.push(await openStrategyReplay({directory,filename,sessionId:`${runId}-append-v1-${strategyId}`,rows:journal.accepted.map(r=>r.candle),create:!exists,appendable:{clock},options:{strategyId,parameters:operationalConfig.parameters,initialCapital:operationalConfig.initialCapital,risk:operationalConfig.risk,costs:{...operationalConfig.costs,spreadPips:0},executionMode:'OBSERVED_BID_ASK',dataValidation:{asOf:clock(),calendarMode:'calendar-v1',calendar:journal.config.calendar}}}));
        } catch(error) {
          if(action!=='status')throw error;
          accounts.push({blocked:true,sessionId:`${runId}-append-v1-${strategyId}`,status:'BLOCKED_INTEGRITY',error:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'ACCOUNT_VERIFICATION_FAILED'});
        }
      }
      const target=Math.min(journal.sequence,Math.min(...accounts.filter(a=>!a.blocked).map(a=>a.status().committedCandles))+limit);
      if(action==='step') for(const a of accounts) a.run(Math.max(0,target-a.status().committedCandles));
      const states=accounts.map((a,i)=>{
        if(a.blocked)return {strategyId:candidates[i],...a,journalIdentity:commitments.journalIdentity,journalHeadSequence:journal.sequence,consumedSequence:null,consumedCommitment:null,pendingEligibleObservations:null,currentRiskState:'UNKNOWN',equity:null,realizedPnl:null,unrealizedPnl:null,financialReconciliation:'UNKNOWN'};
        const s=a.status(), pending=journal.sequence-s.cursor.sequence;
        return {strategyId:candidates[i],...s,journalIdentity:s.cursor.journalIdentity,consumedSequence:s.cursor.sequence,consumedCommitment:s.cursor.commitment,currentRiskState:s.snapshot.riskState,equity:s.snapshot.equity,realizedPnl:s.snapshot.realizedPnl,unrealizedPnl:s.snapshot.unrealizedPnl,journalHeadSequence:journal.sequence,pendingEligibleObservations:pending,
          status:s.snapshot.riskState!=='ACTIVE'?'BLOCKED_RISK':pending?'DIVERGED_RECOVERABLE':'SYNCHRONIZED'};
      });
      return {runId,identityVersion:'strategy-appendable-v1',mode:'ENGINEERING_REPLAY',sourceClassifications:journal.classifications,
        executionAssumptions:'MODEL_ONLY historical next-observed-open; no executable quote',tradingEnabled:false,brokerExecution:'DISABLED',
        journalHeadSequence:journal.sequence,journalHeadCommitment:commitments.head,accounts:states,
        synchronized:states.every(s=>s.financialReconciliation==='VERIFIED' && s.consumedSequence===journal.sequence && s.consumedCommitment===commitments.head)};
    } finally {for(const a of accounts)if(!a.blocked)a.close();}
  });
}
