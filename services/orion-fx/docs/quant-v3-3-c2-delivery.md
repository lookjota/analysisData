# V3.3-C2 delivery — PARTIAL research checkpoint

Core offline comparison is IMPLEMENTED. Statistical validation and durable research
replay are not complete. Results are simulated, exploratory and never a recommendation
for live trading. No parameters were optimized, final holdout evaluated, external
network acquisition performed, orders placed, environment file read, commit or push made.

## Implementation and status

| Area | Status | Scope |
| --- | --- | --- |
| Verified comparison | IMPLEMENTED / TESTED | Existing verified envelope and canonical hash; default four built-ins; fixed canonical order; optional subset; independent train/validation accounts; no ranking |
| Fairness | IMPLEMENTED / TESTED | Common USD1000 capital, risk defaults, execution/calendar/cost identity checks; effective params/warmup, usable counts and boundaries retained |
| Metrics | IMPLEMENTED / TESTED | Existing ledger/analyzer definitions; closed wins/losses, side breakdown, explicit commission/swap; null undefined ratios; Sharpe/Sortino suppressed for unverified annualization |
| Cost sensitivity | IMPLEMENTED / TESTED | Baseline observed quotes once, +1 pip adverse per-fill slippage, USD1 per-order commissions; stop-first existing semantics; fixed-unit long/short independent numeric oracles |
| Walk-forward | PARTIAL / TESTED | Optional rolling/expanding fixed derived window sizes; baseline costs, fixed params, independent accounts; no overlapping OOS aggregation; positive/negative/flat counts and dispersion |
| Statistics | PARTIAL | Always INSUFFICIENT_EVIDENCE; dependence/regimes/multiplicity/sample warnings. Dependence-aware uncertainty PENDING; no invented intervals |
| Terminal reports | IMPLEMENTED / TESTED | Stable compact JSON/text; full output preserved by default; full artifacts independent of terminal summary |
| Artifacts | PARTIAL / TESTED | SHA-256 report/config identities, parent identities, exclusive JSON and escaped HTML. Atomic bundle publication and durable session replay PENDING |
| Safety | IMPLEMENTED / TESTED | Offline dispatch before credential configuration; no final evaluator or journal imports; no execution changes. Logical holdout protection, not encryption |

Defaults are deliberately fixed to minimize the comparison configuration surface.
JS API permits validated candidate parameters for research fixtures; CLI does not tune
or accept parameter grids or per-strategy financial settings. Unsupported CLI flags
are rejected. All four default strategies currently expose warmup=200. Differing
parameter warmups are reported without truncating every strategy to the largest
warmup. Training has 631 candles, validation 211, protected holdout 211 for the
1,053-candle input. Default usable train signals=431, validation=210; trades may
be fewer or zero. No context-only signal becomes an order.

Walk-forward initial training is floor(authorizedPrefix/2), tests advance by
floor(authorizedPrefix/8), minimum one. Incomplete trailing windows are excluded.
Only baseline costs are used for walk-forward even if cost stress is also requested.
Existing rolling training resets indicator context at its local origin; OOS context
starts at dataset origin. These are disclosed limitations. Summaries include each
OOS window, trade counts/PnL, positive/negative/flat counts and descriptive return
dispersion. They do not compound independent accounts or sum partition PnL.

## Offline usage

Run from repository root; direct node does not load .env:

```sh
node services/orion-fx/cli/index.js research:compare \
  --input services/orion-fx/data/capital-demo/v33b-registry/sha256-7d270873ef59f50a8f3a05c6f3bfc6b644503309cfb9c4599b1f850a0de83f17.json \
  --format text
```

Options: --strategies comma-separated built-in IDs; --smoke true|false;
--summary true|false; --format json|text; --cost-stress true|false;
--walk-forward rolling|expanding; --out NEW_DIRECTORY.
Defaults: all four strategies, smoke false, full JSON, baseline only, no walk-forward,
no files written. Text is always compact. --summary true affects terminal JSON only.
--out writes full research.json and per-scenario/per-strategy/partition HTML in a new
private directory; choose an external path such as /tmp/orion-comparison-NEW.
Existing directories fail; no overwrite or automatic output path is used. No CSV
bundle is added. Full equity/drawdown, trades, ledger, fills and decisions remain in
JSON. CLI paths follow the process working directory. npm start --prefix
services/orion-fx -- research:compare is also supported, with input relative to that
service directory. Existing research:evaluate flags/output remain unchanged.

## Actual historical observations

Executed offline on the specified 1,053-candle registry artifact. Baseline:

| Strategy | Train trades | Train PnL USD | Validation trades | Validation PnL USD | Validation PF | Validation max DD USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| trend | 24 | 21.43500101 | 22 | -14.26597187 | 0.36127722 | 16.53365187 |
| mean-reversion | 12 | -3.73568 | 6 | 6.98565 | 3.54124362 | 3.40985 |
| breakout | 20 | -8.71596092 | 10 | -13.27511901 | 0 | 13.27511901 |
| ma-cross | 1 | 3.13616005 | 1 | -0.5772 | 0 | 0.5772 |

Every row: INSUFFICIENT_EVIDENCE. The supplied Trend reference was reproduced
exactly. These partitions are independently reset, differently sized samples.
The positive Mean Reversion validation sample has only six trades. Do not select
or promote it on this basis. Cost stress is not an invariant trade-path experiment.

## Test matrix

New C2 tests group the requested cases; existing suites retain the established
financial, temporal, registry and broker isolation regression fixtures.

| Requested cases | Evidence |
| --- | --- |
| 1–4 verified/tampered/four strategies/partitions | C2 verified/order and partition tests |
| 5–11 warmup, holdout, state, order, determinism, partition isolation, future data | differing warmup; candidate-alone equality; reversed order; repeated run; changed validation/holdout/future quote fixtures |
| 12–14 zero trades/negative returns/undefined metrics | no-trade/default warmup, negative oscillation fixture, null ratios with reasons |
| 15–18 costs/spread/monotonicity semantics | independent long/short USD reference -0.20/-0.40/-2.40 at fixed 1000 units; explicit duplicate spread rejection; baseline independence; no path-level monotonicity assertion |
| 19–20 overlap/evidence | rolling and expanding fixed candidates; overlap rejection; INSUFFICIENT_EVIDENCE |
| 21–24 summary/full reports/injection/options | summary curve omission; saved JSON preservation; HTML escaping/CSV formula regression; invalid flags, paths-as-strategies and values |
| 25–27 offline/credentials/orders | CLI injected env access and fetch throw; offline external-fetch preload; existing broker/execution regression tests. No new broker path |
| 28 holdout unconsumed | no final API/import; changed-holdout results invariant. Existing registry state deliberately not queried or mutated |
| 29 Freqtrade | before/after git status/diff scope, existing untracked scripts left untouched |
| 30 legacy research | original C tests rerun unchanged |

This is focused coverage, not proof against arbitrary hostile filesystem or custom
Node loaders. External-fetch preload blocks external fetch and permits loopback
for root service tests; existing tests inject mock broker transports. Test suites
were not weakened. No test needs real broker credentials.

## Validation

Exact completed command results are recorded below after execution. File counts
from Node's default isolation reporter must not be mistaken for individual cases.

Completed on 2026-11-08, Node v26.13.0. No failures, skips or cancellations.

| Command | Exact result |
| --- | --- |
| Guarded npm test | PASS 22/22 test files, 0 failures |
| Guarded npm test --prefix services/orion-fx | PASS 21/21 test files, 0 failures |
| Guarded focused C and C2 with --test-isolation=none | PASS 14/14 individual cases (5 existing C, 9 new C2), 0 failures |
| npm run check | PASS; orders disabled |
| git diff --check | PASS |
| Actual dataset, all four strategies and three cost scenarios | PASS; Trend reference reproduced |
| Actual dataset, Trend rolling walk-forward | PASS; four OOS windows, 1 positive / 3 negative, 46 total trades; no final evaluation |
| Persisted full report identity recomputation | PASS; SHA-256 matches reportId, both parent dataset identities present, Sharpe suppressed |

Final logs: /tmp/orion-c2-root-final.log, /tmp/orion-c2-service-final.log,
/tmp/orion-c2-focused-final.log, /tmp/orion-c2-check-final.log.
Actual cost-stress output: /tmp/orion-c2-sample.txt; full JSON and 24 HTML reports:
/tmp/orion-c2-real-report/. Actual rolling output: /tmp/orion-c2-walk-real.txt.

Reproduce the offline regression commands:

```sh
ORION_TEST_GUARD="$PWD/services/orion-fx/tests/fixtures/offline-network-guard.js"
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm test
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm test --prefix services/orion-fx
NODE_OPTIONS="--import=$ORION_TEST_GUARD" node --test --test-isolation=none services/orion-fx/tests/quant-v3-3-c.test.js services/orion-fx/tests/quant-v3-3-c2.test.js
npm run check
git diff --check
```

The actual Trend rolling window PnLs were -1.90947992, +3.63278557,
-5.88834618, -9.37653267 USD, with 12, 9, 10, 15 trades respectively.
Return dispersion was 0.48371396 percentage points (descriptive population
standard deviation). No continuous-account return is inferred.

## Remaining work and next checkpoint

PENDING: durable session catalog/replay, atomic report-bundle publication, validated
dependence-aware uncertainty and a predeclared evidence/selection policy.
PARTIAL: walk-forward exposes fixed derived windows only, with inherited training/
OOS context asymmetry; no cross-cost walk-forward grid or confidence intervals.
BLOCKED: none for the delivered implementation. Statistical conclusions are limited
by exploratory data and too few trades, not an engineering error.

Next checkpoint: add replayable, predeclared research sessions with explicit window
and indicator-context policies, then collect broader independently verified history
under separately authorized acquisition. Validate dependence/regime assumptions
before implementing uncertainty or selecting parameters. Keep holdout sealed.

Exact changed files:
- cli/research.js
- optimization/comparison.js (new)
- tests/quant-v3-3-c2.test.js (new)
- docs/quant-v3-3-c2-audit.md (new)
- docs/quant-v3-3-c2-delivery.md (new)

All paths are relative to services/orion-fx. No historical data, broker, ledger,
risk, strategy, package/dependency, Freqtrade or cryptocurrency files changed.
TRADING_ENABLED=false remains enforced by unchanged config/index.js.
