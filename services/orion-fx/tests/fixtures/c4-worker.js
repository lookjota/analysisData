import { hash } from '../../persistence/journal.js';
import { writeAtomicJson } from '../../market-data/capital-history.js';
import { appendForwardObservations, inspectForwardJournal } from '../../market-data/forward-journal.js';
import { collectOfflineReceipt, saveAcquisitionReceipt } from '../../market-data/acquisition-receipt.js';
import { openStrategyReplay } from '../../paper/strategy-durable.js';
import { observations, clock, accountOptions } from './appendable-c2.js';
import { fixtureEnv, offlineTransport, from, to, asOf } from './acquisition-offline.js';
const [directory, operation, boundary, strategy = 'trend'] = process.argv.slice(2);
process.on('message', async message => { if (message === 'go') await work(); });
const barrier = phase => {
  if (phase !== boundary) return;
  process.send({ phase });
  // Synchronous fault callback: wait for parent SIGKILL, bounded fallback.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000);
  throw new Error('BARRIER_NOT_TERMINATED');
};
async function work() {
  try {
    if (operation === 'receipt') {
      const receipt = await collectOfflineReceipt({ env: fixtureEnv, ...offlineTransport(), from, to, asOf });
      await saveAcquisitionReceipt(`${directory}/receipt.json`, receipt, {checkpoint:barrier});
    } else if (operation === 'journal') {
      await appendForwardObservations(directory, observations(1), clock, {checkpoint:barrier});
    } else if (operation === 'conflict') {
      const batch=observations(1);batch[0].candle.close+=.00001;batch[0].evidence={content:batch[0].candle,contentHash:hash(batch[0].candle)};
      await appendForwardObservations(directory,batch,clock);
    } else if (operation === 'append') {
      const result = await appendForwardObservations(directory, observations(Number(strategy)), clock);
      process.send({sequence:result.sequence});
    } else if (operation === 'reader') {
      const result = await inspectForwardJournal(directory, clock); process.send({sequence:result.sequence});
    } else {
      const account = await openStrategyReplay({...await accountOptions(directory,strategy),faultInjector:barrier});
      try {
        if (operation === 'report') await writeAtomicJson(`${directory}/report.json`, account.report(), {checkpoint:barrier});
        else account.run(6);
      } finally {account.close();}
    }
    process.send({done:true}); process.exit(0);
  } catch (error) { process.send({error:/^[A-Z_]+$/.test(error.message)?error.message:'CONFLICT_OR_FAILURE'});process.exit(1); }
}
process.send({ready:true});
