# V3.4-A delivery

PARTIAL: bounded synthetic ENGINEERING_REPLAY workflow. FORWARD_PAPER is PENDING and unavailable.

IMPLEMENTED: paper/operations.js composes four existing F2 accounts (trend, mean-reversion, breakout, ma-cross), each in an independent SQLite file. Versioned fixed configuration: EUR/USD H1, USD 1000, riskFraction .005, dailyLossFraction .01, USD 1000 exposure cap, leverage 1, one position. Default maximum drawdown remains the established .10. Risk sizing includes validated stops and transaction costs; exposure/margin may reduce intended risk. Costs assume 1 pip spread, .1 pip adverse slippage, zero commission and swap. These are engineering assumptions, not broker estimates. Gaps, costs and slippage can exceed the intended stop loss.

IMPLEMENTED: strict commands and fixed fixture verification; changed artifacts are rejected. No network, credential loader, broker instance or order adapter is called by the new workflow. TRADING_ENABLED remains false; no configuration or environment file is changed. No daemon exists; each bounded command exits and closes journals. Stop by letting the command finish; interrupted transactions use existing SQLite recovery.

From repository root:

```sh
node services/orion-fx/cli/index.js paper:ops:fixture --out /tmp/orion-engineering.json
node services/orion-fx/cli/index.js paper:ops:init --run engineering --input /tmp/orion-engineering.json
node services/orion-fx/cli/index.js paper:ops:step --run engineering --input /tmp/orion-engineering.json --limit 7
node services/orion-fx/cli/index.js paper:ops:status --run engineering --input /tmp/orion-engineering.json
node services/orion-fx/cli/index.js paper:ops:verify --run engineering --input /tmp/orion-engineering.json
node services/orion-fx/cli/index.js paper:ops:step --run engineering --input /tmp/orion-engineering.json --limit 24
node services/orion-fx/cli/index.js paper:ops:report --run engineering --input /tmp/orion-engineering.json
```

Use a new output filename and run ID on each initialization. Fixture publication refuses overwrite. Runtime files stay under services/orion-fx/runtime/. Reports are JSON including configuration, source, strategy identity, candle count, pending intent, recovery count, ledger snapshot, risk state and reconciliation. Status/verify reopen journals and record recovery; they are not read-only inspections. Report requires at least one processed candle. lastError null describes the successful invocation; failures return a sanitized JSON error and exit 1, and are not persisted.

PARTIAL recovery: each account commits independently, and initialization is not a four-account transaction. Interrupted initialization can leave a partial run; preserve it for inspection and use a new ID. An interruption between accounts can leave different candle counts; status exposes this. Repeated step calls intentionally advance the next candles; they are not retries keyed by a request ID. Already completed inputs have no repeated financial effects. Existing F2 reconstructs state, risk and pending signals from committed evidence on every reopen.

PENDING: supplied real historical artifact support, append-only forward journal, stable forward identities, duplicate/correction and late-arrival policy, wall-clock completion/freshness and spread gates, and durable input-quality/error states. Proposed journal: retain immutable original quote-bar evidence plus source receipt UTC time, bar-open UTC time, mode and provenance; identify by instrument/timeframe/bar-open, hash normalized payload; exact repeats become no-ops, changed hashes are corrections requiring halt, older unseen bars reject, missing expected open hours pause without fabrication. Validate calendar closure exceptions and completed candles before publishing. Historical backfill must always be ENGINEERING_REPLAY, never forward evidence. Implementation and adversarial testing of this design are required before any separately authorized Demo data acquisition.

The new operational workflow opens no research datasets and overwrites none; V3.3-C source/results were not modified. No staging, commit or push.

Engineering-only strategy parameters use fast 2, slow 3, period 2, RSI 2 and ATR 2 to exercise entries on 24 invented candles. These are test settings, not optimized or recommended strategy parameters.

## Actual validation evidence

TESTED: focused `node --test services/orion-fx/tests/quant-v3-4-a.test.js` exited successfully (test-file runner reports 1 passed, 0 failed, 31.5 seconds). Its assertions cover four-account restart equivalence, USD8 cash = initial cash + ledger amounts, actual closed trades, completed-input idempotency, modified-artifact rejection, and strict CLI settings. This adds to existing F2 tests; no new subprocess interruption test was added to the wrapper.

TESTED: direct CLI handler fixture/init/step/verify/status sequence with global fetch replaced by a throwing function. All commands returned 0; all four accounts started at USD 1000, progressed to one candle, retained that candle on reopen, and recovery counts increased from 0 to 3. TESTED: `npm run check` exited 0 with `orders disabled`. TESTED: `git diff --check` passed. All tracked changes and newly authored files are under services/orion-fx/; original untracked Freqtrade directory remains untouched.

TESTED final acceptance: `npm test` exited 0, 25/25 test files passed (186.9 seconds). `npm test --prefix services/orion-fx` exited 0, 24/24 test files passed (185.2 seconds). Final logs: /tmp/orion-v34-root-final.log and /tmp/orion-v34-service-final.log. The runner reports test files as tests; these are not individual assertion counts. Isolated C3 with --test-isolation=none passed all six named tests, including the exact historical trade-count/PnL baseline and computational replay identity (/tmp/orion-v34-c3-diagnostic.log). V3.3-C, C2, C3 and C4 passed in both final full runs.

The initial full runs failed the C3 file (root 24/25, service 23/24) while source files were still being edited. C3 hashes working JavaScript during session creation/replay. After freezing all JavaScript, the diagnostic and both full reruns passed without research implementation changes. Do not run source-identity regression checks concurrently with implementation edits. Existing research output files were not overwritten or optimized, and no independently archived report comparison was performed.
