import { processAppendableJournal } from '../../paper/appendable-operations.js';
import { appendForwardObservations } from '../../market-data/forward-journal.js';
import { observations,clock } from './appendable-c2.js';
import { accountOptions } from './appendable-c2.js';
import { openStrategyReplay } from '../../paper/strategy-durable.js';
globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};
const [directory,phase]=process.argv.slice(2);
if(phase==='after-journal-append'){await appendForwardObservations(directory,observations().slice(6),clock);process.kill(process.pid,'SIGKILL');}
if(phase==='all-status'){const status=await processAppendableJournal({directory,runId:'demo',action:'status',clock});await new Promise((resolve,reject)=>process.send(status,error=>error?reject(error):resolve()));process.exit(0);}
const account=await openStrategyReplay({...await accountOptions(directory),faultInjector:boundary=>{if(boundary===phase)process.kill(process.pid,'SIGKILL');}});
account.run(12);account.close();
