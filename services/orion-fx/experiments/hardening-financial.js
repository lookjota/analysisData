import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { VirtualPortfolio } from '../portfolio/virtual.js';
import { assessMargin } from '../financial/margin.js';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const base = { entry: 1.1, units: 1000, margin: 110, commission: .02, stopDistance: .01, takeDistance: .02 };
const start = Date.parse('2024-01-08T00:00:00Z');
let seed = 20261105;
const events = Array.from({ length: 1200 }, (_, i) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return { timestamp: new Date(start + i * 3600000).toISOString(), side: i % 2 ? -1 : 1, ticks: seed % 2001 - 1000 };
});
const account = new VirtualPortfolio(100000);
let expected = 10000000000000n;
for (const event of events) {
  account.open({ ...base, side: event.side, timestamp: event.timestamp });
  account.chargeSwap(.03, event.timestamp);
  account.close((11000 + event.ticks) / 10000, event.timestamp, 'experiment-A', .02);
  expected += BigInt(event.side * event.ticks) * 10000000n - 7000000n;
  const state = account.snapshot(1.1, event.timestamp);
  assert.equal(state.exactUsd8.cash, String(expected));
  assert.equal(state.exactUsd8.equity, String(expected));
  assert.equal(state.marginUsed, 0);
}
const results = [{ experiment: 'A', config: { operations: 1200, initialCapital: 100000, seed: 20261105, ...base, swap: .03 }, datasetHash: digest(events), result: 'PASS', cashUsd8: String(expected), invariants: ['independent integer cash oracle', 'cash equals flat equity', 'margin released'], limitations: ['synthetic booking inputs; no profitability evidence'] }];
const scenarios = [1, -1].map(side => ({ side, exit: side === 1 ? .9 : 1.3 }));
for (const scenario of scenarios) {
  const p = new VirtualPortfolio(1000), timestamp = new Date(start).toISOString();
  p.open({ ...base, units: 10000, margin: 900, commission: 1, side: scenario.side, timestamp });
  assert.equal(assessMargin(900, 900).status, 'MARGIN_CALL');
  const before = p.snapshot(scenario.exit, timestamp);
  assert.equal(assessMargin(before.equity, before.marginUsed).status, 'STOP_OUT');
  p.close(scenario.exit, timestamp, 'STOP_OUT', 2);
  const after = p.snapshot(scenario.exit, timestamp);
  assert.equal(after.exactUsd8.cash, '-100300000000');
  assert.equal(after.marginUsed, 0);
}
results.push({ experiment: 'B', config: { initialCapital: 1000, units: 10000, margin: 900, entry: 1.1, entryFee: 1, exitFee: 2, marginCallRatio: 1, stopOutRatio: .5 }, datasetHash: digest(scenarios), result: 'PASS', invariants: ['margin call threshold', 'stop-out at adverse quote', 'negative balance retained', 'full margin release', 'costs once'], limitations: ['explicit assessMargin + portfolio close; does not model intrabar liquidation or broker rules'] });
console.log(JSON.stringify(results, null, 2));
