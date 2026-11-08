import { appendForwardObservations } from '../../market-data/forward-journal.js';
import { readStoredJson, withHistoryPublicationLock } from '../../market-data/capital-history.js';
if(process.argv[2]) {
 const [directory,input,now]=process.argv.slice(2);
 await appendForwardObservations(directory,await readStoredJson(input),()=>now);
 await withHistoryPublicationLock(directory,async()=>{
  setInterval(()=>{},1000); // Keep the process alive until the parent sends SIGKILL.
  process.send?.('COMMITTED_AND_LOCKED');
  await new Promise(()=>{});
 });
}
