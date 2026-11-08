import { hash } from '../../persistence/journal.js';
export const now='2026-11-03T00:05:00.000Z', clock=()=>now;
export function observations(count=12) {
 return Array.from({length:count},(_,i)=>{
  const open=1.1+i*.0002, close=open+(i%4<2?.0003:-.0003);
  const bar={open,close,high:Math.max(open,close)+.0001,low:Math.min(open,close)-.0001};
  const candle={instrument:'EUR/USD',timeframe:'H1',timestamp:new Date(Date.parse('2026-11-02T01:00:00Z')+i*3600000).toISOString(),...bar,source:'offline-c2',synthetic:true,quoteBars:{bid:bar,ask:Object.fromEntries(Object.entries(bar).map(([k,v])=>[k,v+.0001]))}};
  return {candle,classification:'ENGINEERING_REPLAY',timestampConvention:'UTC_BAR_OPEN',complete:true,observedAt:now,acquiredAt:now,sourceRevision:'synthetic-v1',evidence:{content:candle,contentHash:hash(candle)}};
 });
}
export async function accountOptions(directory, strategyId='trend') {
 const {inspectForwardJournal}=await import('../../market-data/forward-journal.js');
 const {operationalConfig}=await import('../../paper/operations.js');
 const j=await inspectForwardJournal(directory,clock);
 return {directory,filename:`demo-append-v1-${strategyId}.sqlite`,sessionId:`demo-append-v1-${strategyId}`,rows:j.accepted.map(r=>r.candle),appendable:{clock},options:{strategyId,parameters:operationalConfig.parameters,initialCapital:1000,risk:operationalConfig.risk,costs:{...operationalConfig.costs,spreadPips:0},executionMode:'OBSERVED_BID_ASK',dataValidation:{asOf:clock(),calendarMode:'calendar-v1',calendar:j.config.calendar}}};
}
