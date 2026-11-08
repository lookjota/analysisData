import { mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCsv } from '../market-data/historical.js';
import { openStrategyReplay } from '../paper/strategy-durable.js';
import { writeReports } from '../reporting/index.js';

export const durableCommands = ['paper:durable:run','paper:durable:status','paper:durable:recover','paper:durable:report','paper:durable:verify'];
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function runDurable(args,{output,errorOutput,rootDirectory=root}) {
  let replay;
  try {
    if(args[1]==='--help' && args.length===2) {
      output('Offline durable replay: --input local.csv --session NAME [--strategy trend] [--capital 1000] [--parameters JSON] [--risk JSON] [--costs JSON] [--calendar JSON] [--execution JSON] [--out NAME]. run creates; recover resumes; status/verify/report verify an existing journal. Same input/configuration required on every command. SQLite: services/orion-fx/runtime/NAME.sqlite. No end liquidation. Maximum 1000 candles.');return 0;
    }
    const flags={};const allowed=['input','session','strategy','capital','parameters','risk','costs','calendar','execution','out'];
    for(let i=1;i<args.length;i+=2) {
      const key=args[i].startsWith('--')?args[i].slice(2):'';
      if(!allowed.includes(key)||flags[key]!==undefined||args[i+1]===undefined) throw new Error('INVALID_ARGUMENTS');
      flags[key]=args[i+1];
    }
    if(!flags.input?.endsWith('.csv')||!flags.session||!/^[A-Za-z0-9_-]{1,80}$/.test(flags.session)|| (flags.out && !/^[A-Za-z0-9_-]{1,80}$/.test(flags.out))) throw new Error('INVALID_ARGUMENTS');
    const object = text => {const value=JSON.parse(text??'{}');if(!value || Object.getPrototypeOf(value)!==Object.prototype) throw new Error('INVALID_ARGUMENTS');return value;};
    const execution=object(flags.execution);
    if(Object.keys(execution).some(k=>!['trailingDistance','intrabarPolicy','marginModel','executionMode'].includes(k))) throw new Error('INVALID_ARGUMENTS');
    const dataValidation={calendarMode:'calendar-v1',calendar:object(flags.calendar),gapPolicy:'reject',maxRows:1000};
    const dataset=await importCsv(resolve(flags.input),dataValidation);
    const options={...execution,strategyId:flags.strategy??'trend',parameters:object(flags.parameters),initialCapital:Number(flags.capital??1000),risk:object(flags.risk),costs:object(flags.costs),dataValidation};
    const directory=resolve(rootDirectory,'runtime');await mkdir(directory,{recursive:true,mode:0o700});
    replay=await openStrategyReplay({directory,filename:`${flags.session}.sqlite`,sessionId:flags.session,rows:dataset.candles,options,create:args[0]==='paper:durable:run'});
    if(['paper:durable:run','paper:durable:recover'].includes(args[0])) replay.run();
    if(args[0]==='paper:durable:report') {
      const result=replay.report();
      if(flags.out) {const reports=resolve(rootDirectory,'reports');await mkdir(reports,{recursive:true,mode:0o700});if(await realpath(reports)!==reports) throw new Error('UNSAFE_DIRECTORY');await writeReports(result,resolve(reports,flags.out));}
      output(JSON.stringify(result,null,2));
    } else output(JSON.stringify(replay.status(),null,2));
    return 0;
  } catch(error) {
    errorOutput(`Orion FX durable: ${/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'DURABLE_COMMAND_FAILED'}`);return 1;
  } finally {replay?.close();}
}
