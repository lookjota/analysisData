# Orion Quant V3.2-F2 — PARTIAL

Implemented a bounded, offline strategy-to-SQLite reference replay. **F2 is PARTIAL**,
not production ready. Existing strategies now generate recoverable virtual work;
one candle's execution effects, mark, risk transitions, trailing update and pending
signal commit atomically. The exhaustive fault/supervision requirements are not
complete. No new strategy, ledger, broker transport or external order capability.

Baseline: feat/orion-quant-v3 at 1a674ea580e70d062bd0f54926f3638dc6d63acd,
Node v26.13.0. Pre-existing untracked services/freqtrade/scripts/ preserved.
Initial root suite passed 16 files; FX suite passed 15 files, and explicit FX
case run measured 117/117. The supplied 126 baseline was not independently counted
by the initial root command (Node summarizes files). See quant-v3-2-f2-audit.md.

## Architecture and contract

`openStrategyReplay` is exported from paper/strategy-durable.js and paper/replay.js.
Arguments: directory, filename (default strategy.sqlite), sessionId, rows, options,
create (default false). Methods: step(), run(limit), status(), report(), close().
Existing `openDurableReplay` and legacy replay remain available and compatible.
The strategy API accepts built-in strategyId/parameters, capital, costs, risk,
trailing, ambiguity, margin, executionMode, costSchedule, dataValidation and
provenance. Custom executable callbacks, arbitrary strategies and unknown options
are rejected. Initial session creation is explicit; opening a missing session fails.

Only validated local EUR/USD H1 datasets, at most 1000 rows, are accepted. Data is
copied/normalized; caller mutation cannot change execution. Calendar-v1 is required;
missing/unknown hours, out-of-order rows, unknown fields and observed closed-market
candles reject. Expected closures use the existing provider calendar, exceptions,
IANA zones and US/UK DST calculations. No fabricated bars. A deliberate closure
schedule must be declared; no universal venue schedule is asserted. Dataset hash,
strategy version/parameters, effective options, calendar identity and replay version
are bound to the session declaration and compared during recovery. `asOf` remains
an explicit historical validation option, not a wall-clock freshness guarantee.

The existing backtest has an opt-in third argument `{durableTrace:true}`. Its
existing strategy, indicator, execution, sizing and portfolio code produce traces.
No duplicate indicator algorithms or financial ledger were introduced. The trace
contains financial journal operations plus final pending signal and reconciliation
snapshot. The adapter translates those operations into existing journal events,
with additive STRATEGY_DECLARED, STRATEGY_CHECKPOINT, STRATEGY_RECOVERED and
VIRTUAL_TRAILING_UPDATED types. Storage schema version stays 1; older readers that
do not recognize these types cannot read strategy journals. Do not mix explicit
intent and strategy APIs in the same session.

## Timeline and atomicity

Candle timestamps are opens. A strategy sees a frozen closed prefix only after
open+1h. Before warm-up completion it receives no evaluation call; a hold decision
is checkpointed. Pending metadata includes deterministic intent ID, strategy hash
and version, dataset hash, candle open, signal availability, earliest eligibility,
instrument, direction, risk sizing policy, stop/take and risk configuration hash.
The earliest timestamp is a lower bound (signal availability), not a forecast of
the next observed open across a closure. The final pending signal is retained but
never executed beyond the bound dataset.

Stable order within a candle:
1. Day baseline, carried swap, adverse open-gap protective evaluation.
2. Existing open risk/margin checks and risk-reducing liquidation.
3. Previous pending exit/reversal, risk-assessed entry.
4. Existing conservative intrabar protective evaluation.
5. Close mark and risk latch.
6. Trailing update, closed-prefix signal evaluation, checkpoint.
7. Candidate USD8/position reconciliation, SQLite inserts, COMMIT, return.

No callbacks determine execution priority. Protective intrabar fills retain legacy
bar-open accounting timestamps; these are OHLC model labels, not observed tick
execution times. The entire candle is processed when available as a closed bar.
No future candle is used in signal calculation. Historical signals execute only
at a subsequent observed open, at or after signal availability. Trailing updates
cannot execute in the candle that produced them. Stops use executable bid for
long liquidation, ask for shorts, adverse slippage, worse open for stop gaps;
target gaps receive no favorable improvement. Simultaneous touches use stop-first
or reject-ambiguous, never invented tick order.

appendPlanned holds BEGIN IMMEDIATE through history validation, deterministic
planning, complete projection and inserts. FULL synchronous / DELETE journal are
unchanged. Financial effects and pending work share one commit. No separately
committed signal-to-fill window exists inside a candle. Rollback leaves the last
candle checkpoint unchanged. Fees, swaps, quantities, margin release, realized and
unrealized PnL use VirtualPortfolio/USD8. Negative cash/equity are not clamped.

Each step reads the latest checkpoint under the writer lock and advances once;
reopening after an unknown acknowledgement resumes from the committed count.
Completion is a no-op. Event IDs hash session configuration, candle index and
stable effect index. A recovery event changes journal sequence, never financial
state. Recovery count counts verified reopens, including CLI status/report/verify;
these inspection commands currently append that operational event.

Recovery reconstructs the built-in strategy from the committed prefix, checks every
plan hash and pending identity, compares the complete ordered financial trace and
reconciles exact USD8 state, position, trades and ledger. A changed dataset,
calendar/configuration, bad digest or forged pending identity rejects. Failed
storage/planning sets the handle DEGRADED and prevents further steps; close and
reopen after repair. No automatic journal replacement or fallback to memory.

## Risk policy and legitimate differences

Durable tracing reuses legacy assessIntent sizing, fees and assessMargin. Entries
also obey a persistent ACTIVE/PAUSED/HALTED latch, with drawdown/daily-loss and
close-mark margin/exposure checks. Transitions include trigger metrics and session
configuration hash. Journal projection independently rejects opening while blocked.
No strategy API can reset risk. Legacy risk-reducing signal exits, protective stops,
swap and existing open-risk liquidation continue while blocked. No new entry is
allowed. Storage failure blocks all mutation; it cannot truthfully persist HALTED
while storage itself is unavailable.

Intentional legacy differences:
- PAUSED latches across days; legacy daily blocking resets on the next UTC day.
- Close-mark exposure/leverage/margin may HALT durable replay earlier than legacy.
- Durable rejects missing/unknown hours and observed closed-market candles.
- Durable retains positions and pending signals at end; parity uses legacy
  closeAtEnd:false. Final liquidation is deliberately not implicit.
- Exact journal sequence/recovery metadata differ between continuous and reopened
  runs; financial state, signals and eligible execution remain equivalent.
- The separate explicit-intent durable API has a different sizing/cost contract;
  this integration does not route strategy sizing through that contract.

PARTIAL supervision: no independent per-entry/post-fill quote age or maximum-spread
supervisor is connected to this trace mode. Bid/ask endpoint integrity is validated,
but H1 aggregates cannot prove tick freshness. Margin/stop-out checks retain legacy
open/close timing; there is no continuous intrabar margin observer or immediate
close-mark liquidation beyond existing next-open policy. No administrative
reactivation is exposed. These limitations prevent COMPLETE status.

## CLI and reports

Commands: paper:durable:run, paper:durable:status, paper:durable:recover,
paper:durable:report, paper:durable:verify. All take the same CSV and configuration
so identity can be verified. `run` creates; `recover` opens and continues; the
others inspect existing state. `report --out NAME` writes existing JSON/HTML/CSV
report formats to a new reports/NAME directory. Session selects a restricted
basename in services/orion-fx/runtime/NAME.sqlite; no CLI arbitrary database path.
Journal canonical-path, symlink, hardlink and Freqtrade protections are reused.
Reports parent canonicality and exclusive output creation are checked. API callers
must still supply trusted local directories; this is not an OS sandbox.

Example (local historical CSV must already exist):

```sh
npm start --prefix services/orion-fx -- paper:durable:run --input /path/local.csv --session research --strategy trend --capital 1000 --risk '{"maxExposure":1000}' --costs '{"spreadPips":1,"slippagePips":0.1}'
npm start --prefix services/orion-fx -- paper:durable:status --help
```

Reuse identical options for recover/status/report/verify. Parameters, risk, costs,
calendar and execution assumptions are JSON objects. `--execution` permits only
trailingDistance, intrabarPolicy, marginModel and executionMode. Defaults come from
the existing research engine; they are assumptions, not recommended financial
settings. CLI does not load .env or instantiate/authenticate a broker on this path.

JSON separates operational durability metadata/risk history from financial metrics.
HTML exposes the same metadata through existing escaped rendering and CSP. Existing
CSV formula escaping remains. Synthetic labels, cost assumptions and simulated
performance limitations are retained. Reports contain committed prefixes only;
no uncommitted financial result is presented as durable.

## Executed experiments

15 new tests in strategy-durable-f2.test.js (some parameterize multiple scenarios):
- Four built-in strategies: continuous legacy versus reopened durable signals,
  orders, fills, trades, ledger, equity, margin and risk-event parity on fixtures.
  Some strategies can produce no trades on a short fixture; no claim of complete
  strategy-path branch coverage is made.
- Future alteration after the checkpoint leaves prior signal and USD8 state
  unchanged; warm-up leaves no position. Dataset alteration blocks same-session
  recovery. Final repeated step has no financial effect.
- Real forked children, SIGKILL after four committed bars (pending entry) and six
  (open position); resumed ledger/equity/final financial state equal continuous.
- Daily-loss PAUSED and drawdown HALTED survive normal reopen and block entries.
- Additional actual SIGKILL immediately after a protective close and persisted
  PAUSED/HALTED; resumed risk/ledger/equity match uninterrupted references.
- Short replay with variable bid/ask endpoints, slippage, commission, trailing
  and midnight swap; legacy parity plus independent integer cash-sum reference.
- Conservative stop/target ambiguity, rejected ambiguity with no candle effects,
  take profit, adverse long/short gaps; independent USD8 gap PnL on decimal-grid
  fixtures (one USD8 unit rounding tolerance), and worse-than-stop fill assertions.
- Tight trailing stop remains open through producing candle, survives reopen and
  executes only in the next candle.
- Missing hours/closed-market data reject; calendar identity mismatch rejects.
  US spring DST weekend closes exactly 47 missing UTC hours without fabricated bars.
- Real SQLite writer lock fails closed. SQL trigger ABORT on checkpoint insertion,
  after planned entry, rolls back all inserted candle effects and pending work.
- Bad digest and changed pending identity with a recomputed checksum block reopen.
- JSON/HTML metadata/escaping, unsafe CLI session path rejection, help without
  credentials, positive create/status/recover/verify/report flow in private temp root.
  The production CLI fixes its root; the test directly injects a trusted temp root.

These SIGKILL barriers are AFTER confirmed candle commits, not inside COMMIT and
not between signal calculation and insert. The SQL ABORT is a real transactional
failure, not a SIGKILL. Do not attribute those untested crash windows to this suite.
Independent financial references do not establish an independent strategy oracle;
legacy parity deliberately shares the existing implementation.

## Completion matrix

| Checkpoint | Status | Evidence / remaining work |
|---|---|---|
| Phase 0 audit | TESTED | branch, HEAD, tree, baseline, contracts |
| A adapter | IMPLEMENTED / TESTED | existing built-ins, deterministic pending metadata |
| B scheduling | IMPLEMENTED / TESTED | atomic candle ordering/reconstruction; bounded datasets |
| C management | IMPLEMENTED / TESTED | existing entry/exit/protective/trailing/cost ledger; intrabar margin limits remain |
| D supervision | PARTIAL | persistent latch tested; quote freshness/spread/post-fill supervision pending |
| E calendar | PARTIAL | strict calendar path, DST/weekend tested; venue holiday/UK DST recovery matrix pending |
| F parity | PARTIAL | fixture parity demonstrated; exhaustive direction/cost/risk combinations pending |
| G crash recovery | PARTIAL | actual pending/open/protective/risk SIGKILL; inside-transaction windows pending |
| H CLI | IMPLEMENTED / TESTED | local CSV, validated destinations, offline lifecycle/report flow |
| I reporting | IMPLEMENTED / TESTED | JSON/HTML/CSV existing safeguards and durability metadata |
| Final F2 | PARTIAL | critical supervisor and targeted crash evidence incomplete |

Adversarial matrix status (TESTED means the scope stated here, not exhaustive):

| Requested scenarios | Status | Evidence / limit |
|---|---|---|
| 1-2 future access/warm-up | TESTED | prefix isolation fixture; existing B/C indicator regressions |
| 3 pending recovery | TESTED | SIGKILL committed pending candle |
| 4-6 duplicates/conflicts | PARTIAL | deterministic checkpoint/completion, forged pending rejected; explicit API regressions cover source/fill conflicts; adapter concurrent-process conflict matrix pending |
| 7-10 long/short/stop/target | TESTED | built-in fixtures, conservative protection, long/short gap oracles |
| 11-13 trailing/ambiguity/gap | TESTED | dedicated producing-candle, abort, both-side gap assertions |
| 14-16 weekend/DST/missing | PARTIAL | US DST/weekend/missing tested; UK DST/holiday recovery matrix pending |
| 17-20 spread/slippage/fee/swap | TESTED | observed short fixture and recovered parity; no max-spread supervisor claim |
| 21 margin stop-out | PARTIAL | existing component regressions; automatic strategy crash stop-out fixture pending |
| 22-23 daily/drawdown | TESTED | latched PAUSED/HALTED, normal reopen and actual SIGKILL |
| 24 stale data | PARTIAL | strict missing-hour/asOf validation; tick freshness supervisor pending |
| 25-26 PAUSED/HALTED recovery | TESTED | actual child processes and subsequent entry blocking |
| 27 SQLite contention | TESTED | actual second writer lock and reopen |
| 28 commit acknowledgement loss | PARTIAL | committed-work restart equivalence; exact COMMIT/return fault injection pending |
| 29-30 open/pending crashes | TESTED | real SIGKILL barriers |
| 31 corruption | TESTED | digest and forged pending with recomputed checksum |
| 32-33 legacy/continuous/recovered parity | TESTED | scope and legitimate differences above |
| 34-35 CLI/reports | TESTED | full temp-root lifecycle, JSON/HTML metadata/escaping |
| 36 offline | PARTIAL | no new network imports; child fetch denied and CLI credential-free; OS network namespace isolation not executed |
| 37 no orders | TESTED | paths have no broker execution capability; check orders disabled |
| 38 Freqtrade | TESTED | tracked diff empty; pre-existing untracked directory preserved |

Acceptance 1-5, 7-11, 13-18 have implementation/test evidence within the bounded
contract above; 6, 12 and 19 remain PARTIAL where the full supervision, comprehensive
parity and fault matrix require further evidence. No COMPLETE or production claim.

## Risks and next steps

HIGH: finish per-entry and post-fill quote/spread supervision, specify close-mark
stop-out liquidation and administrative recovery policy, and test negative balances
and margin transitions through automatic strategy crashes. Existing explicit API
financial regressions are not substitutes for those strategy integration cases.
HIGH: inject actual process termination during signal computation, before insert,
before COMMIT, after COMMIT/before acknowledgement and during risk transition;
validate rollback/recovery without test-only production bypasses.
MEDIUM: prefix recomputation and full journal projection under a writer lock are
intentionally expensive (quadratic or worse with indicators); 1000-row cap is a
bound, not a latency promise. No incremental indicator checkpoint optimization,
large-dataset performance proof, backup/anchor or concurrent hostile-owner defense.
MEDIUM: source provenance is declared; dataset hashing proves identity, not truth.
OHLC cannot establish tick order/liquidity/freshness. H1 intrabar fill labels remain
legacy conventions. No wall-clock time, live stream, real-money readiness claim.
LOW: only Node26 measured, no coverage percentage or external independent audit.

Changed: backtesting/index.js (opt-in trace/latch), persistence/journal.js (additive
types/trailing projection), paper/replay.js (export), cli/offline.js (dispatch),
reporting/index.js (HTML operational metadata). Added: paper/strategy-durable.js,
cli/durable.js, tests/strategy-durable-f2.test.js, tests/fixtures/strategy-durable-child.js,
quant-v3-2-f2-audit.md and this delivery document. No dependencies added.
No .env or credentials accessed, Docker operations, broker authentication, external
orders, Freqtrade changes, Git commits, pushes or merges performed.

## Final measured verification

- `node --test --test-isolation=none tests/*.test.js services/orion-fx/tests/*.test.js`:
  **141/141 cases PASS**, zero failures/skips/cancellations, after final input guards.
  Includes 15 F2 cases; fixtures parameterize additional scenarios without inflating
  the test count. Output captured during this session at /tmp/orion-f2-final-cases.txt.
- `npm test`: **17/17 files PASS**, including the complete F2 file.
- `npm test --prefix services/orion-fx`: **16/16 files PASS** in the earlier integration
  pass; subsequently expanded F2 cases are covered by the final combined case run.
- `npm run check`: PASS, Node v26.13.0, orders disabled.
- `git diff --check`: PASS.
- `git diff --exit-code -- services/freqtrade`: PASS, no tracked modifications.
- Required branch and HEAD remain feat/orion-quant-v3 / 1a674ea. No staging,
  commits, pushes, merges, dependency installs or changes to trading configuration.
