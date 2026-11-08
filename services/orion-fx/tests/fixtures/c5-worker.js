import { openStrategyReplay } from '../../paper/strategy-durable.js';
import { accountOptions } from './appendable-c2.js';
const [directory,strategy,boundary,mode='WAL']=process.argv.slice(2);
const barrier=phase=>{
  if(phase!==boundary)return;
  process.send({phase});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20000);
  throw Error('BARRIER_NOT_TERMINATED');
};
process.on('message',async()=>{
  try {
    const account=await openStrategyReplay({...await accountOptions(directory,strategy),journalMode:mode,faultInjector:barrier});
    account.run(24);account.close();process.send({done:true});process.exit(0);
  }catch(e){process.send({error:e.message});process.exit(1);}
});
process.send({ready:true});
