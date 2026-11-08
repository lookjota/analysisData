# V3.3-C architecture audit

Overall checkpoint: PARTIAL. Inspected branch `feat/orion-quant-v3`, HEAD
`ee790d1`. Initial working tree contained only untracked
`services/freqtrade/scripts/`; it is outside this change. No environment file was
read. No network acquisition, order, commit or push was performed.

## Existing architecture

| Area | Existing contract and integration decision |
| --- | --- |
| market-data | `capital-history.js` readStoredJson/verifyHistory verifies the envelope, manifest, canonical candle SHA-256, observed quotes, Demo provenance declaration, request resolution/ranges and complete calendar coverage. `collection.js` publishes no-clobber content-addressed datasets and deterministic merges. Reuse without downloads. |
| calendar | `forex.js` fx-ny17-v1, IANA New York DST, declared closures/exceptions. Broker schedule accuracy remains unverified. `historical.js` records temporal and session metadata, missing/unknown hours. |
| strategies | Executable interface is `strategies/research.js` createStrategy, not the future observation-only interface in index.js. Trend uses EMA, MA Cross uses SMA crossings, Mean Reversion uses BB/RSI and directional mean exit, Breakout uses prior extrema. No algorithm duplication. |
| parameters/indicators | fast/slow/period/rsiPeriod/atrPeriod integers 2–1000; fast < slow; positive stopAtr/rewardRisk; adxMinimum 0–100; boolean trendFilter. Shared conservative warmup is max(slow, period+1, atrPeriod, 2*rsiPeriod). Existing SMA/EMA/ATR/ADX/RSI/BB and others reused. No new indicator. |
| backtesting | Built-in strategies receive deeply frozen closed prefixes. Signals execute next eligible open, context signals discarded; reset capital/start flat/force close at each independent evaluation. End-exclusive evaluation ranges. |
| execution/financial | Existing executable bid/ask, adverse slippage, USD8 VirtualPortfolio ledger, commissions and swap, conservative stop-first ambiguity and stop gaps. Spread is embedded once. Explicit optional fixed-entry margin/stop-out model; no replacement ledger. Aggregated H1 cannot establish intrabar quote freshness/liquidity. |
| risk | Existing risk sizing, exposure, leverage, one-position, daily-loss/drawdown limits. Optional margin model must be declared; it is not implicitly enabled by this checkpoint. |
| optimization | temporal.js provides chronological 60/20/20 researchSplit and rolling/expanding windows. research.js evaluates train/validation then OOS and rejects overlapping OOS aggregation. Independent accounts, no stitched equity. Existing selection criterion netProfit is descriptive, not evidence of edge. |
| sessions/persistence | session.js freezes parameters/configuration/hash and restricts callbacks. journal.js provides durable reservation before final execution and consumption after, scoped to dataset/split rather than caller session name. Explicit reuse is supported by legacy API. New command exposes no final execution or reuse operation. Local files are logical isolation, not encrypted holdout access control. |
| paper | Existing replay and durable strategy replay reuse the financial implementation; durable replay bounded to 1000 candles. No changes needed for readiness preview. |
| analytics/reporting | analyze/enrich provide net trade PnL metrics, equity drawdown, observed-H1 Sharpe/Sortino with explicit 6048 periods/year assumption, zero risk-free/target, null undefined ratios. Gross profit/loss refer to winning/losing NET trades. Existing CSV cells and HTML escaping. Extended research bundles remain missing. |
| CLI/tests | Existing offline command dispatcher precedes broker configuration/authentication. Add separate research dispatcher at that boundary. Existing financial, isolation, calendar, journal and collection regression fixtures remain unchanged. |

Reviewed V3.2 B/C, D/E and F2 contracts, research-methodology, V3.3-B delivery,
manifest and registry implementations. Prior delivery totals are claims until
rerun; current evidence is in the C delivery document.

## Minimal integration implemented

`optimization/readiness.js` requires a verified history envelope, explicit
calendar-v1 continuity with no missing/unknown hours, chronological partitions,
built-in strategy parameter validation and usable observations after warmup and
next-bar eligibility. It returns a deeply frozen planning assessment. No arbitrary
candles, synthetic fallback or user executable callback is accepted.

`cli/research.js` adds readiness and single-strategy training/validation preview.
The preview calls existing createResearchSession/optimize/freeze; it never calls
evaluateFinal. Reports use deterministic content identity and exclusive file
creation in a new directory. Full provenance remains in the input; report summaries
allowlist provenance fields and bind the original artifact hash.

## Missing functionality and risks

This is a coherent preview increment, not the complete research system. Pending:
verified-input strategy comparison and passive benchmark bundle, persisted session
inspection/replay, walk-forward and cost-stress CLI integration, complete research
JSON/CSV/HTML bundle, independent extended metric oracles, trade dependence and
regime assessment, dependence-aware uncertainty, multiplicity correction and
predeclared selection criteria. Existing lower-level APIs are not claimed to meet
all C requirements just because their tests pass.

Readiness floors are planning conventions, not power calculations. UTC dates do
not identify exchange sessions. Expected independent trades cannot be estimated
from data count alone. RESEARCH_READY describes data availability only and always
retains INSUFFICIENT_EVIDENCE. Nonzero event-label horizons fail closed until
purging/embargo is implemented; built-ins use no supervised event labels, start
flat and force-close per partition. Variable holding periods remain a dependence
limitation. Hashes detect mutation relative to an envelope, not malicious
consistent rewriting, authenticity or rollback without a trusted external anchor.
