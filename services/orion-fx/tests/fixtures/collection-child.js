import { withHistoryPublicationLock } from '../../market-data/capital-history.js';
import { resumeCollection } from '../../market-data/collection.js';
// Retain the pending promise from a live event handler. An unreachable never-
// resolving promise can be collected, including its suspended FileHandle owners.
const waitForTermination = () => new Promise(resolve => {
  const timer = setInterval(() => {}, 1000);
  process.once('disconnect', () => { clearInterval(timer); resolve(); });
});
if (process.argv[3] === 'lock') {
  await withHistoryPublicationLock(process.argv[2], async () => {
    process.send('locked');
    await waitForTermination();
  });
  process.exit(0);
}
let calls = 0;
await resumeCollection(process.argv[2], {
  verifyContext: async () => {},
  findEurUsd: async () => ({ epic: 'EURUSD', metadata: { symbol: 'EUR/USD', instrumentType: 'CURRENCIES' } }),
  historicalCandles: async (_epic, request) => {
    if (++calls === 2) {
      process.send('in-flight');
      await waitForTermination();
    }
    const prices = [];
    for (let t = Date.parse(request.from); t <= Date.parse(request.to); t += 3600000) prices.push({ snapshotTimeUTC: new Date(t).toISOString(),
      openPrice: { bid: 1.1, ask: 1.1002 }, highPrice: { bid: 1.101, ask: 1.1012 }, lowPrice: { bid: 1.099, ask: 1.0992 }, closePrice: { bid: 1.1, ask: 1.1002 } });
    return { prices };
  },
}, { expectedAccountId: 'fixture-account-only', sleep: async () => {} });
