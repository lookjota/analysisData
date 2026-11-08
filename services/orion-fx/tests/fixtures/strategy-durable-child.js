import { openStrategyReplay } from '../../paper/strategy-durable.js';
// No transport can be used by this process; all input arrives from the controller.
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
process.once('message', async input => {
  try {
    const replay = await openStrategyReplay(input.open);
    replay.run(input.steps);
    process.send({barrier:true,status:replay.status()});
    process.on('message',()=>{});
  } catch(error) {process.send({error:error.message});process.exitCode=1;}
});
