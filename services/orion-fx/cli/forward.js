import { processAppendableJournal } from '../paper/appendable-operations.js';
import { processJournalSnapshot } from '../paper/journal-operations.js';
import { resolve } from 'node:path';
import { readStoredJson } from '../market-data/capital-history.js';
import { initializeForwardJournal, appendForwardObservations, inspectForwardJournal } from '../market-data/forward-journal.js';
export const forwardCommands=['paper:ops:journal:init','paper:ops:journal:append','paper:ops:journal:status','paper:ops:journal:verify','paper:ops:journal:paper:init','paper:ops:journal:paper:step','paper:ops:journal:paper:status'];
export async function runForward(args,{output,errorOutput}) {
  try {
    if(!forwardCommands.includes(args[0])) throw new Error('INVALID_ARGUMENTS');
    if(args.length===2&&args[1]==='--help'){output('Offline journal: --journal NEW_OR_EXISTING_DIRECTORY; append also requires --input BATCH.json. Paper commands accept --mode appendable-v1; omission preserves fixed-watermark replay. FORWARD_OBSERVED and forward execution are blocked pending authenticated acquisition.');return 0;}
    const flags={};
    for(let i=1;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!['journal','input','run','limit','mode'].includes(key)||Object.hasOwn(flags,key)||!args[i+1])throw new Error('INVALID_ARGUMENTS');flags[key]=args[i+1];}
    const paper=args[0].includes(':paper:');
    const append=args[0].endsWith(':append');
    if(paper){if(flags.mode!==undefined&&flags.mode!=='appendable-v1')throw new Error('INVALID_ARGUMENTS');if(!flags.journal||!flags.run||flags.input||flags.limit!==undefined&&(!args[0].endsWith(':step')||!/^(?:[1-9]|1[0-9]|2[0-4])$/.test(flags.limit)))throw new Error('INVALID_ARGUMENTS');output(JSON.stringify(await (flags.mode==='appendable-v1'?processAppendableJournal:processJournalSnapshot)({directory:resolve(flags.journal),runId:flags.run,action:args[0].split(':').at(-1),limit:Number(flags.limit??1)})));return 0;}
    if(flags.run||flags.limit||flags.mode)throw new Error('INVALID_ARGUMENTS');
    if(!flags.journal||append!==Boolean(flags.input)||flags.input&&!flags.input.endsWith('.json'))throw new Error('INVALID_ARGUMENTS');
    const directory=resolve(flags.journal);
    const result=args[0].endsWith(':init')?await initializeForwardJournal(directory):append?await appendForwardObservations(directory,await readStoredJson(resolve(flags.input))):await inspectForwardJournal(directory);
    const {records,accepted,config,...status}=result;output(JSON.stringify({...status,acceptedCandles:accepted.length}));return 0;
  }catch(error){errorOutput(JSON.stringify({error:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'FORWARD_JOURNAL_FAILED',status:error.message==='INVALID_ARGUMENTS'?'UNKNOWN':'BLOCKED_INTEGRITY',tradingEnabled:false,brokerExecution:'DISABLED'}));return 1;}
}
