import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineeringArtifact, openPaperRun } from '../paper/operations.js';
import { readStoredJson } from '../market-data/capital-history.js';
import { writeExclusive } from '../market-data/historical.js';
export const operationCommands=['paper:ops:fixture','paper:ops:init','paper:ops:step','paper:ops:status','paper:ops:report','paper:ops:verify'];
export async function runOperations(args,{output,errorOutput,rootDirectory=resolve(dirname(fileURLToPath(import.meta.url)),'..')}) {
  let worker;
  try {
    if(args.length===2&&args[1]==='--help'){output('Offline ENGINEERING_REPLAY only. fixture --out NEW.json; init|step|status|report|verify --run NAME --input FIXTURE.json [--limit 1..24 (step only)]. No daemon; each command exits. All four accounts use fixed versioned risk/cost settings.');return 0;}
    if(!operationCommands.includes(args[0])) throw new Error('INVALID_ARGUMENTS');
    const flags={};
    for(let i=1;i<args.length;i+=2){const k=args[i]?.slice(2);if(!args[i].startsWith('--')||!['out','run','input','limit'].includes(k)||Object.hasOwn(flags,k)||!args[i+1]) throw new Error('INVALID_ARGUMENTS');flags[k]=args[i+1];}
    if(args[0]==='paper:ops:fixture') {if(Object.keys(flags).join()!=='out'||!flags.out.endsWith('.json'))throw new Error('INVALID_ARGUMENTS');await writeExclusive(resolve(flags.out),JSON.stringify(engineeringArtifact()));output(JSON.stringify({mode:'ENGINEERING_REPLAY',created:true,tradingEnabled:false}));return 0;}
    if(flags.out||!flags.run||!/^[A-Za-z0-9_-]{1,64}$/.test(flags.run)||!flags.input?.endsWith('.json')||(!args[0].endsWith(':step')&&flags.limit!==undefined)||flags.limit!==undefined&&!/^(?:[1-9]|1[0-9]|2[0-4])$/.test(flags.limit)) throw new Error('INVALID_ARGUMENTS');
    const artifact=await readStoredJson(resolve(flags.input));
    const directory=resolve(rootDirectory,'runtime');await mkdir(directory,{recursive:true,mode:0o700});
    worker=await openPaperRun({directory,runId:flags.run,artifact,create:args[0].endsWith(':init')});
    const result=args[0].endsWith(':step')?worker.run(Number(flags.limit??1)):args[0].endsWith(':report')?worker.report():worker.status();output(JSON.stringify(result));return 0;
  }catch(error){errorOutput(JSON.stringify({error:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'PAPER_OPERATIONS_FAILED',tradingEnabled:false}));return 1;}finally{worker?.close();}
}
