# V3.3-C2 architecture audit

Baseline: branch feat/orion-quant-v3, HEAD c4bb302. Existing untracked
services/freqtrade/scripts/ was present before work and was not modified.

Inspected cli/research.js and cli/index.js, optimization/readiness.js,
session.js, research.js and temporal.js; strategies/research.js; backtesting/index.js;
execution/prices.js; portfolio/virtual.js; risk/simulation.js; analytics/index.js;
reporting/index.js; capital-history.js and collection.js; C audit/delivery and
existing C fixtures. The journal's holdoutStatus/reserveHoldout/consumeHoldout contracts were inspected: scoped durable reservation precedes execution and consumption records the result identity.
The comparison imports no journal/final-evaluation API and cannot consume it.

The smallest integration is a verified-input orchestration module, not a new
ledger or optimizer. Reuse verifyHistory/assessReadiness and researchSplit,
createStrategy, backtest/enrich, existing rolling/expanding evaluation and
aggregateWalkForward, identity/deepFreeze, USD8 sums, htmlReport/writeExclusive.
No strategy, accounting, risk, broker, dataset or runtime configuration edits.

Comparison does not call optimize: its implicit profit-based winner selection
would be inappropriate here. Built-in candidates are validated and ordered
trend, mean-reversion, breakout, ma-cross, followed by optional diagnostic IDs.
Parameters are fixed, defaults remain unchanged, duplicate strategy IDs reject.
One common configuration supplies every strategy; effective capital/risk/model/
cost/calendar identity is checked for each partition and scenario.

Whole-envelope verification necessarily reads holdout observations. Once verified,
only the prefix ending at validation end is used for financial evaluation. This
is logical non-evaluation protection, not encrypted access control. Registry state
is not queried and no claim is made that a previous unrelated user never consumed
this dataset. No new final evaluation, authorization, reuse or promotion path exists.

Backtests pass closed prefixes only, execute close-N signals at open-N+1, discard
context signals, start flat and force-close. Accounts reset per strategy, partition,
cost scenario and walk-forward window. Training and validation PnL are never added.
Warmup comes from actual strategy metadata; all four defaults currently require
200 bars. Different supplied parameters preserve different requirements and usable
counts and trigger unequal-coverage warnings. Context is not eligible for trading.

Metrics reuse analyze/enrich. Gross profit/loss are sums of winning/losing **net**
trade PnL; grossTradingPnl excludes commissions/swap. Average loss is signed.
Win rate is a fraction. Return uses initial account capital; drawdown uses marked
equity and running peak. Undefined ratios remain null with reasons. Winning/losing
counts and side PnL are derived from existing closed ledger trades; commission and
swap totals use USD8 sums. Open positions are disclosed (normal comparison forces
closure). Sharpe/Sortino are suppressed to null in the new report because the
observed-H1 annualization contract is unverified. Legacy research:evaluate is unchanged.

Observed bid/ask embeds spread once; added spread remains zero. Baseline uses
0.1 pip adverse slippage per fill; stress uses 1.1 pips, or baseline slippage plus
USD1 per-order commission per side. Stop-first, adverse stop gaps and no favorable
target gap improvement are existing conservative semantics. No liquidity, tick
freshness, latency distribution, variable commission schedule or capacity claims.
Spread/slippage attribution fields are diagnostic, never extra cash debits;
protective spread can be unknown. Fixed-unit fixtures show monotone adverse costs,
but strategy paths and sizing can change, so overall PnL is not asserted monotone.

Walk-forward uses only the authorized prefix, baseline costs and fixed single
candidates; optional rolling/expanding windows use half that prefix for initial
training and one eighth for test steps (integer floors). OOS windows do not overlap;
existing aggregator rejects overlaps. Accounts are independent; return dispersion
is descriptive population standard deviation, not a confidence interval. Rolling
training indicators restart at its train origin; OOS indicators use context from
dataset origin, as the existing implementation does. This limitation is disclosed.
No parameter stability inference is possible with one unchanged parameter set.

Reports bind canonical dataset hash, artifact hash, parent dataset/artifact identities,
configuration digest, actual model/cost/risk/parameters, boundaries and runtime.
SHA-256 report identity is deterministic for the same runtime and inputs. Default
output is terminal only; explicit --out requires a new private directory and
exclusive JSON/HTML files. HTML uses existing escaping/CSP, filenames use validated
built-in IDs, and no CSV is added (existing formula escaping is regression-tested).
No arbitrary report fragment becomes a filename. An output error can leave a partial
new directory; durable replay and atomic multi-file publication remain PENDING.

Statistics always INSUFFICIENT_EVIDENCE. Warnings cover few trades, partition
lengths, dependence, regimes, multiplicity, unequal coverage and validation decline.
No bootstrap is justified here; no intervals or significance are invented.
