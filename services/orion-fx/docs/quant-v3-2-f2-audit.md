# F2 engineering audit

Baseline: feat/orion-quant-v3, 1a674ea580e70d062bd0f54926f3638dc6d63acd,
Node v26.13.0. Working tree contains only pre-existing untracked
services/freqtrade/scripts/. Preserved without inspection or modification.
Before implementation: npm test PASS (16 files); npm test --prefix
services/orion-fx PASS (15 files). Counts are file counts, not assumed case counts.

Existing backtest owns execution ordering, risk sizing, costs, protective fills,
trailing and VirtualPortfolio USD8 accounting. Built-in research strategies:
trend, mean-reversion, breakout, ma-cross, no-trade, buy-hold, risk-managed-hold.
They compute indicators from closed prefixes. Legacy replay recomputes prefixes.
Durable explicit replay accepts commands but lacks strategy/pending/calendar.
Journal appendPlanned validates candidate projections under BEGIN IMMEDIATE and
publishes only after COMMIT. It is the appropriate atomic boundary.

Integration design: instrument existing backtest with an internal durable trace,
then commit one complete candle's trace and pending decision atomically. Bounded
prefix recomputation reconstructs strategy context; no serializable indicator
cache or second ledger. Session identity binds full normalized dataset, strategy
version/parameters, effective options, calendar and execution contract. Recovery
compares deterministic trace commitments and financial projection before progress.
Pending signals are committed with candle close; next observed validated open is
eligible, never earlier than close. Intrabar protective effects keep existing
bar-open accounting labels; ordering within a candle is stable, not inferred ticks.

Financial invariants: USD8 ledger projection must equal reference snapshot,
including positions/trades; one fee/swap per committed event; no replacement of
negative balances; no entries while persistent risk is PAUSED/HALTED. Temporal
invariants: frozen closed strategy prefix; warm-up; monotonic open/close events;
trailing applies only after current protective evaluation. Missing/unknown hours
must reject. Closed-market observations must reject in the durable path.

Compatibility risks: legacy daily block resets each day; durable pause must latch.
Legacy explicit durable planner uses different sizing/cost policy; do not translate
its rounded sizing into the strategy path. Extend journal types additively, leave
explicit API compatible. Bounded recomputation costs CPU and is not live streaming.
Failure conditions: incompatible config, corrupt journal, conflicting checkpoint,
lock/storage failure, projection disagreement, ambiguous fill under reject policy.
All must fail closed. No automatic administrative reset in strategy API.

Test strategy: financial/strategy regression; built-in strategy parity; continuous
versus reopened and actual SIGKILL child replay; pending and duplicate checkpoint;
calendar/config mismatch; no future signal effects; risk latch; HTML escaping;
offline CLI. Full fault matrix must remain PARTIAL without targeted evidence.

## Final review

Implementation is additive: opt-in backtest trace, four journal types, bounded
strategy replay API, offline CLI dispatch and escaped report metadata. Full-dataset
price-model consistency and cost-schedule length validate before journal creation.
Candle commits include pending work; recovery recomputes only committed prefixes,
checks trace/intent commitments and independently projects journal effects through
the existing portfolio. No external callback schedules fills.

Residual HIGH: per-entry/post-fill freshness/spread supervision and all requested
SIGKILL windows are incomplete. Risk states latch, but liquidation timing follows
the legacy H1 contract. Full fault matrix, UK DST/holidays, negative-balance strategy
crashes and administrative reactivation require a next checkpoint. Storage failure
means DEGRADED, not a fictitious persisted HALTED. Final classification: PARTIAL.
Detailed invariants, tested experiments, compatibility changes, completion matrix
and remaining risks are in quant-v3-2-f2-delivery.md.

Final evidence: combined explicit suite 141/141 cases PASS (15 new F2 cases),
root npm test 17/17 files PASS, earlier FX npm test 16/16 files PASS, check orders
disabled PASS, diff whitespace PASS, tracked Freqtrade diff empty. Final combined
case run includes the last dataset-model/schedule guards. Branch and HEAD preserved.
