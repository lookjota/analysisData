# V3.4-A audit

PARTIAL checkpoint. Expected HEAD adbceecbb2a04a1020717563484d6d680383db57 verified on feat/orion-quant-v3. Initial worktree contained untracked services/freqtrade/scripts/; left untouched.

IMPLEMENTED previously: paper/strategy-durable.js (F2) wraps backtest with prefix-only strategy evaluation, deterministic pending next-open intents, atomic per-candle financial effects and SQLite checkpoints. persistence/journal.js verifies event digests and reconstructs VirtualPortfolio. portfolio/virtual.js uses USD8 accounting and independently reconciles cash, realized and unrealized balances. risk/simulation.js sizes integer EUR units from stop distance, costs, exposure and margin; backtest persists PAUSED/HALTED transitions. execution/prices.js implements conservative protective fills including adverse gaps and stop-first ambiguity. No parallel ledger was needed.

Existing tests cover actual SIGKILL, lock contention, transaction rollback, corrupt journal, pending identity forgery, persistent loss limits, conservative long/short gaps, swap and DST weekends. Calendar-aware strict dataset validation rejects missing expected open hours and closed-market candles. Quote bars validate bid/ask endpoint integrity; aggregated H1 bars do not establish tick freshness.

Existing historical acquisition is separate, explicitly invoked Demo read-only tooling. Historical artifact manifests, collection registry and research temporal partitions exist. The new operational workflow does not open registry datasets, run research, or evaluate a final holdout. Required existing regression tests use their established TRAIN/VALIDATION artifact paths. Existing offline and durable CLI routes precede credential-loading code.

Missing: F2 binds the entire dataset identity and is limited to 1000 candles with expensive prefix reconstruction. It is not appendable. There is no verified forward journal, production freshness/spread gate, or genuine forward evidence in this delivery. These require explicit design and tests before feed ingestion. No profitability claim or strategy selection is supported.
