import { openDurableReplay } from '../../paper/durable.js';
const configuration=JSON.parse(process.argv[3]);
const replay=await openDurableReplay({directory:process.argv[2],configuration});
process.send('READY');
process.once('message',input=>{
 try {
  const result=replay.submitVirtualIntent(input);
  replay.closeReplay();process.send({idempotent:result.idempotent},()=>process.disconnect());
 } catch { replay.closeReplay();process.send({error:'WRITE_FAILED'},()=>process.disconnect()); }
});
