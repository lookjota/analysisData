import { openDurableReplay } from '../../paper/durable.js';
import { hash } from '../../persistence/journal.js';
const time='2026-01-05T10:00:00.000Z';
const configuration={sessionId:'f_test',datasetIdentity:hash('synthetic'),strategyIdentity:hash('explicit-fixture'),configurationIdentity:hash('fixture-v1'),initialCapital:1000,executionModelVersion:'explicit-intent-v1',riskModelVersion:'simulation-v1',journalSchemaVersion:1,clockPolicy:'EXPLICIT_UTC',recoveryPolicy:'VERIFY_FULL',durabilityMode:'DURABLE',risk:{},quotePolicy:{maxAgeMs:3600000,maxSpread:.001}};
const r=await openDurableReplay({directory:process.argv[2],configuration,create:true});
r.submitMarketEvent({sourceId:'source_1',sequence:1,timestamp:time,kind:'mark',payload:{bid:1,ask:1,quoteTimestamp:time}});
r.submitVirtualIntent({sourceId:'source_2',sequence:2,timestamp:time,kind:'entry',payload:{side:1,stopDistance:.01,takeDistance:.02,commissionUsd8:'100000000'}});
process.send('COMMITTED');
process.on('message',()=>{});
