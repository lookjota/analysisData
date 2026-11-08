# V3.4-B audit — PARTIAL

Verified starting HEAD: `3fc0c16` (`feat(orion-fx): add bounded offline multi-account paper operations`), branch `feat/orion-quant-v3`. Node v26.13.0. Pre-existing untracked `services/freqtrade/scripts/` was left untouched. No staging, commits or pushes. No environment file was opened. Historical datasets and final research holdout were not opened by the implementation or manual acceptance workflow.

## Existing contracts and reuse

`paper/operations.js` verifies canonical equality with its fixed 24-candle synthetic artifact before opening four F2 sessions. Fixed parameters are engineering fixtures, not selected trading recommendations. Accounts begin with USD 1000, risk fraction .005, daily loss .01, exposure USD 1000, leverage 1, maximum one position. Risk defaults additionally apply a .10 drawdown threshold. Broker execution stays disabled.

`paper/strategy-durable.js` validates a strict chronological calendar-aware complete dataset, at most 1000 candles, and binds its whole dataset hash, options, calendar and strategy in STRATEGY_DECLARED. It reconstructs backtest prefixes, validates every checkpoint/financial trace and reconciles USD8 projection. Per-candle financial effects, pending intent and STRATEGY_CHECKPOINT commit in one SQLite BEGIN IMMEDIATE transaction. Reopening records STRATEGY_RECOVERED. READY becomes DEGRADED on verification/step failure, CLOSED on close. Reconciliation errors never manufacture account balances. PAUSED/HALTED are reconstructed from immutable risk transitions and never automatically cleared. Opening/status can add recovery events; they are not read-only financial inspections.

`persistence/journal.js` supplies canonical encoding, SHA256, bounded payload/depth, safe local SQLite paths, FULL synchronous DELETE journaling, writer transactions and financial event projection. `portfolio/virtual.js` owns ledger/trades/position and USD8 arithmetic. `risk/simulation.js` sizes integer units using stop risk plus costs, cash margin and exposure. No parallel financial arithmetic was introduced. `risk/index.js` rejects all orders and allowlists read-only Demo/session endpoints.

`market-data/historical.js` normalizes EUR/USD H1 bar-open timestamps, validates OHLC, and rejects missing open hours through `calendar/forex.js`. NY17 uses America/New_York and therefore US DST. Declared holidays, reductions and nonoverlapping exceptions are supported; this is not a broker-verified calendar. Quote normalization checks each side and simultaneous declared open/close; high-bid versus low-ask is never interpreted as a spread. New journal validation also requires high-bid <= high-ask and low-bid <= low-ask, necessary aggregate ordering without synchronized extrema assumptions. A standalone quote snapshot has a separate max-age gate and is not inferred from bar close.

Historical acquisition (`capital-history.js`) is explicit Demo-only, bounded/paced and preserves source timestamps/bid-ask data in manifested artifacts. Its timestamp parser canonicalizes snapshotTimeUTC as bar-open by the existing contract; actual broker timestamp convention and latency still require independent confirmation before activation. Collection/registry (`collection.js`) publishes immutable segment artifacts, detects conflicts and declares provenance. New code never scans that registry. It reuses anchored no-symlink JSON reads, exclusive hard-link publication, file/parent fsync, and SQLite publication locking from `capital-history.js`.

CLI offline dispatch occurs before config loading and broker construction. New routes follow that convention. No new transport or broker adapter exists.

## Execution contract

Backtest generates a signal from the closed prefix N and evaluates the pending intent at observed historical open N+1. Gap protective handling precedes pending signal handling; intrabar protective evaluation follows entry. Stops worsen to an adverse opening gap; target gaps receive the target without favorable improvement; simultaneous stop/target uses stop-first unless explicitly configured otherwise. Trailing changes apply after current-candle protective evaluation. Open positions persist at dataset end in F2. H1 marks use close timestamps; protective fills retain established simulation event labels rather than pretending to reconstruct ticks.

The new snapshot bridge uses supplied bid/ask endpoints with spreadPips 0 (avoids double charging spread) and adverse .1 pip slippage. Protective liquidity, synchronized intrabar spread, queue, latency and capacity are unavailable. It is historical simulation, including when replayed today; no current executable quote is invented.

## HALTED investigation

Reproduced the unmodified V3.4-A artifact and all 24 trend candles. Result: realized USD .53250068, equity USD 1000.53250068, no position, HALTED. Durable transition sequence 21, timestamp `2024-01-08T09:00:00.000Z`, reason `EXPOSURE_LIMIT`, previous ACTIVE. Supporting USD8 metrics:

- equity `100054661431` = USD 1000.54661431;
- exposure `100001550272` = USD 1000.01550272;
- free margin `107772590` = USD 1.07772590;
- peak USD 1000.54661431, day start USD 1000.

The entry was 908 units at 1.100736661248049 at 04:00, entry margin USD 999.46888841. A favorable marked-price movement pushed gross exposure just over the fixed USD 1000 cap. This close-time exposure check latches HALTED even though equity improved. It was not drawdown, daily loss, stale data, negative free margin, or virtual stop-out. Operational marginModel is null; no optional ratio stop-out model is enabled. Intrabar stops follow the legacy OHLC protective contract rather than continuous adverse-mark risk sampling. The fixture is invented mixed-regime data, not source evidence.

The existing position subsequently closed by signal at 14:00 at 1.101323115743753, ledger CLOSE +`53250068` USD8, ending cash `100053250068`. HALTED prohibits new entries but does not erase an existing position or its subsequent legitimate exit. No threshold or reset changed. Account status now exposes the complete latestRiskEvent; V3.4-A asserts its exact reason and exposure and the original trade PnL.

## Scope decision

F2's whole-dataset binding cannot safely be relabeled an expanding feed. This delivery implements a fixed-watermark offline bridge only. Forward receipt authentication, continuous account extension, and genuine forward executable quotes remain unavailable. Therefore the mission is PARTIAL, not production-ready forward paper trading.
