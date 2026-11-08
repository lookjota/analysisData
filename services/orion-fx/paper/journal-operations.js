import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { inspectForwardJournal } from '../market-data/forward-journal.js';
import { readStoredJson, writeAtomicJson, withHistoryPublicationLock } from '../market-data/capital-history.js';
import { hash } from '../persistence/journal.js';
import { candidates, operationalConfig } from './operations.js';
import { openStrategyReplay } from './strategy-durable.js';

/** Explicit fixed-watermark replay bridge. F2 does not support appendable datasets. */
export async function processJournalSnapshot({directory,runId,action='status',limit=1,clock=()=>new Date().toISOString()}) {
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(runId??'')||!['init','step','status'].includes(action)||!Number.isSafeInteger(limit)||limit<1||limit>24)throw new Error('INVALID_ARGUMENTS');
 // Validate directory policy before creating even the advisory lock file.
 await inspectForwardJournal(directory,clock);
 return withHistoryPublicationLock(directory,async()=>{
  const journal=await inspectForwardJournal(directory,clock);
  if(journal.quarantinedSequences.length)throw new Error('QUARANTINED_REVISION_BLOCKS_PROCESSING');
  const path=join(directory,`${runId}-snapshot.json`);let manifest;
  try{manifest=await readStoredJson(path);}catch(error){if(error.code!=='ENOENT'||action!=='init')throw error;}
  if(!manifest){
   if(!journal.accepted.length)throw new Error('EMPTY_JOURNAL');
   const body={version:'orion.journal-snapshot.v1',runId,watermark:journal.sequence,head:journal.head,inputHash:hash(journal.accepted.map(r=>r.candle)),classifications:journal.classifications};
   manifest={...body,digest:hash(body)};await writeAtomicJson(path,manifest);
  }
  const {digest,...body}=manifest;
  const records=journal.accepted.filter(r=>r.sequence<=manifest.watermark), rows=records.map(r=>r.candle);
  if(hash(body)!==digest||manifest.version!=='orion.journal-snapshot.v1'||manifest.runId!==runId||journal.records[manifest.watermark-1]?.digest!==manifest.head||hash(rows)!==manifest.inputHash)throw new Error('SNAPSHOT_IDENTITY_MISMATCH');
  const accounts=[];
  try{
   for(const strategyId of candidates){
    const filename=`${runId}-${strategyId}.sqlite`;let exists=true;
    try{await lstat(join(directory,filename));}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
    if(!exists&&action!=='init')throw new Error('PARTIAL_INITIALIZATION_REQUIRES_INIT');
    accounts.push(await openStrategyReplay({directory,filename,sessionId:`${runId}-${strategyId}`,rows,create:!exists,options:{strategyId,parameters:operationalConfig.parameters,initialCapital:1000,risk:operationalConfig.risk,costs:{...operationalConfig.costs,spreadPips:0},executionMode:'OBSERVED_BID_ASK',dataValidation:{asOf:records.map(r=>r.ingestedAt).sort().at(-1),calendarMode:'calendar-v1',calendar:journal.config.calendar}}}));
   }
   const before=accounts.map(a=>a.status().committedCandles);
   // Reconcile laggards to one common bounded target. Completed histories stay intact.
   const target=Math.min(rows.length,Math.min(...before)+limit);
   if(action==='step')for(const account of accounts)account.run(Math.max(0,target-account.status().committedCandles));
   const states=accounts.map((a,i)=>{const s=a.status();return {strategyId:candidates[i],...s,journalSequence:records[s.committedCandles-1]?.sequence??null,latestCommittedCandle:records[s.committedCandles-1]?.candle.timestamp??null,closedTradeCount:s.snapshot.trades.length};});
   return {runId,mode:'FIXED_WATERMARK_OFFLINE_REPLAY',sourceClassifications:manifest.classifications,watermark:manifest.watermark,pendingJournalRecords:journal.sequence-manifest.watermark,journalIntegrity:journal.integrity,inputFreshness:journal.inputFreshness,revisionStatus:'NONE',executionAssumptions:'Historical next-open endpoint simulation; 0.1 pip adverse slippage; protective liquidity and intrabar spreads unavailable; no current executable quote',brokerExecution:'DISABLED',tradingEnabled:false,synchronized:new Set(states.map(s=>s.committedCandles)).size===1,accounts:states};
  }finally{for(const a of accounts)a.close();}
 });
}
