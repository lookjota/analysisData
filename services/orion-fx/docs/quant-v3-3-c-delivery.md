# V3.3-C delivery — PARTIAL

Implemented and tested a verified-history readiness gate and offline single-strategy
TRAIN/VALIDATION preview. V3.3-C is **not COMPLETE**. No claim of trading edge,
profitability, statistical significance or actual broker earnings is made.

## Completion matrix

| Checkpoint | Status | Evidence / remaining work |
| --- | --- | --- |
| Phase zero | IMPLEMENTED | quant-v3-3-c-audit.md; existing component contracts inspected |
| C1 readiness | PARTIAL / TESTED | Verified envelope, SHA-256, EUR/USD H1 observed quotes, provenance declaration, calendar continuity, coverage, UTC date count, warmup/effective partition observations. Independent trades/session adequacy not established. |
| C2 partitions | PARTIAL / TESTED | Reused 60/20/20 chronological split, prefix isolation and reset accounts. Configurable split through readiness JS API. New CLI never evaluates final. Durable preview registration and nonzero label horizons PENDING. |
| C3 benchmarking | PARTIAL | Existing four algorithms reused by single-strategy preview; unified comparison/passive bundle PENDING. No trade forcing. |
| C4 execution | PARTIAL | Existing USD8 financial/execution regression suite reused unchanged; C-specific comprehensive reference oracles PENDING. No ledger changes. |
| C5 metrics | PARTIAL | Existing analyze/enrich reused; full requested extended metrics/attribution not implemented. |
| C6 costs | PENDING | Existing lower-level sensitivity API available; protected verified-input orchestration absent. |
| C7 walk-forward | PARTIAL | Existing rolling/expanding API and overlap checks remain; C verified-input CLI/report integration PENDING. |
| C8 statistics | PARTIAL | Always INSUFFICIENT_EVIDENCE; no fabricated confidence intervals. Bootstrap, dependence/regimes and search-wide multiplicity tracking PENDING. |
| C9 reproducibility | PARTIAL | Original artifact/canonical hashes, frozen session identity, effective params/config, runtime and deterministic reportId captured; optional exclusive output. Durable session catalog/replay/config compatibility PENDING. |
| C10 reports | PARTIAL | JSON preview only. No ranking. Existing general escaped CSV/HTML writers unchanged; C report bundle PENDING. |
| C11 CLI | PARTIAL / TESTED | research:readiness and research:evaluate implemented; other requested research operations PENDING. |

## Readiness contract

Inputs must be existing `orion.capital-history.v1` JSON envelopes verified through
readStoredJson and verifyHistory. No CSV, bare candles, synthetic fixture or implicit
download fallback. Declared provenance remains unverified externally. Hash integrity
is distinct from provider authenticity and licensing. Calendar-v1 is required;
unknown/missing hours reject. No interpolation or synthetic favorable spreads.

Defaults in readinessDefaults: exploratorySessions=20 UTC observation dates,
researchSessions=252 UTC observation dates, researchUsablePerPartition=500.
These are conservative planning floors, not universal sample adequacy criteria.
They are configurable in assessReadiness's thresholds object; invalid/unknown
thresholds reject. The field names retain 'Sessions' for policy identity but count
UTC observation dates explicitly, not independent venue sessions.

INSUFFICIENT_DATA means at least one usable partition is empty or the exploratory
coverage floor is unmet. Explicit smoke=true changes that label to
ENGINEERING_SMOKE_TEST only, never evidence. EXPLORATORY requires positive usable
observations in every partition and the exploratory date floor. RESEARCH_READY
also requires the research date and every usable-partition floor. Every class
retains evidenceStatus=INSUFFICIENT_EVIDENCE. Three and 117 default-strategy candles
do not clear the warmup requirement and cannot qualify for inferential research.

Effective usable count conservatively removes observations before shared indicator
warmup and one last observation without a next execution bar. Final counts are
metadata only. No final prices are passed to an optimizer/backtester by the preview;
verification necessarily reads the complete input to check its integrity.

## Execution and metrics

Preview uses default USD 1000 independent reset accounts, built-in risk defaults,
observed bid/ask, zero additional spread, 0.1 pip adverse slippage per side,
default zero commissions/swap, conservative stop-first and next-open execution.
These declared cost assumptions are not a broker fee estimate. No active optional
margin-call/stop-out model is claimed. The frozen configuration/report records
actual effective assumptions. Default strategies retain warmup 200; short inputs
legitimately yield no trades. No parameter optimization occurs across candidates:
one candidate is frozen and evaluated with validation enabled.

Existing metrics: netProfit = final marked equity minus initial capital (USD8);
profitFactor = positive net trade PnL / absolute negative net trade PnL;
expectancy = mean net trade PnL; undefined denominator gives null. Drawdown uses
running equity peak. Sharpe uses sample standard deviation; Sortino uses all
observations' zero-target downside deviation. Annualization is 24*252 observed
H1 periods/year, zero risk-free rate. Irregular coverage makes these descriptive;
no daily returns are manufactured. Net trade metrics are realized; equity can
include unrealized marks in general APIs; preview force-closes each partition.
Full cost attribution, drawdown duration, long/short reporting, uncertainty and
regime analysis are PENDING. Do not use preview metrics for strategy ranking.

## Offline commands

From repository root (no environment file loaded):

```sh
npm start --prefix services/orion-fx -- research:readiness --input data/capital-demo/eurusd-h1-20261026-31.json
npm start --prefix services/orion-fx -- research:evaluate --input data/capital-demo/eurusd-h1-20261026-31.json --strategy trend --smoke true
```

Supported flags for both commands: --input REQUIRED, --strategy built-in ID
(default trend), --smoke true|false (default false), --out NEW_DIRECTORY.
Use --help alone after the command for help. `--out` creates a new private directory
and exclusive research.json; existing directories/files are never overwritten.
Output failure can leave a partial directory for inspection. No report is persisted
without --out. New report identity binds inputs/configuration/runtime; no timestamps
or random UUIDs perturb repeated evaluations. The frozen registrationIdentity is a
logical session identity, not a durable registered session. New commands expose no
final holdout consumption/authorization/reuse flag. Existing durable registry is
unchanged; its historical consumption state is not queried by preview.

## Files and tests

Changed: cli/index.js; added cli/research.js, optimization/readiness.js,
tests/quant-v3-3-c.test.js and the two C documents. No dependency, Docker, broker,
financial, risk, strategy, historical dataset or Freqtrade edits. No commit/push.
TRADING_ENABLED=false and external execution remain unchanged.

Focused tests cover hash/price mutation, tiny sample classification, explicit
non-inferential smoke, warmup counts, immutable assessment, invalid thresholds,
invalid partitions, unsupported horizons, deterministic preview, zero trades,
exclusive report output and no final evaluation. Local real 117-candle acceptance
runs when the ignored artifact exists; clean checkouts explicitly skip that one
case. Mock history fixtures validate engineering only, never market evidence.
Existing tests provide the financial/calendar/isolation/journal regression coverage;
the complete 38-item C-specific matrix is PENDING.

## Recorded validation — 2026-11-08

Node v26.13.0. Automated runs preload the existing external-fetch guard; broker
transports in existing tests are mocks. Root HTTP tests use loopback only.
No external acquisition was performed. Logs are local under /tmp/orion-c-*.log.

| Command | Result |
| --- | --- |
| Guarded npm test | PASS 21/21 files, 0 failures/skips/cancellations |
| Guarded npm test --prefix services/orion-fx | PASS 20/20 files, 0 failures/skips/cancellations |
| Guarded npm run test:cases --prefix services/orion-fx | PASS 199/199 cases, 0 failures/skips/cancellations |
| Guarded node --test --test-isolation=none | PASS 208/208 cases, 0 failures/skips/cancellations |
| Guarded focused quant-v3-3-c.test.js with --test-isolation=none | PASS 5/5 cases, 0 failures/skips/cancellations |
| npm run check | PASS, orders disabled |
| git diff --check | PASS |
| Actual local 117-candle preview | PASS engineering acceptance; ENGINEERING_SMOKE_TEST, INSUFFICIENT_EVIDENCE, TRAIN=0 trades, VALIDATION=0 trades, no final evaluation |

Reproduce validation from repository root:

```sh
ORION_TEST_GUARD="$PWD/services/orion-fx/tests/fixtures/offline-network-guard.js"
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm test
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm test --prefix services/orion-fx
NODE_OPTIONS="--import=$ORION_TEST_GUARD" node --test --test-isolation=none
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm run test:cases --prefix services/orion-fx
NODE_OPTIONS="--import=$ORION_TEST_GUARD" node --test --test-isolation=none services/orion-fx/tests/quant-v3-3-c.test.js
npm run check
git diff --check
```

No inference about strategy quality is justified by this dataset. Further work
requires adequate independently sourced historical coverage and completion of the
PENDING matrix, rather than parameter changes designed to induce trades here.
