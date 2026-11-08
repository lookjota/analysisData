# V3.3-C3 audit — PARTIAL checkpoint

## Inspection and implementation plan — IMPLEMENTED

Baseline branch feat/orion-quant-v3, HEAD 3dc1316. Existing untracked services/freqtrade/scripts/ was present before work; untouched.

Inspected CLI research dispatch, comparison.js, session.js, temporal.js, readiness.js, strategy implementations, backtester, USD8 portfolio ledger, reporting, historical verification/publication functions, journal and existing research tests. Reuse comparison without financial or partition changes; wrap its verified historical input and deterministic result in a durable envelope; bind runtime source bytes; publish exclusively; add inspection, verification and replay; test actual offline artifact.

Reuse: verifyHistory/readStoredJson for historical integrity and anchored no-follow reads; existing sorted-key identity for hashes; comparison for costs, partitions and walk-forward; backtest/VirtualPortfolio for USD8 accounting and independent reset accounts. Journal canonical encoding has a 256 KiB limit, unsuitable for full comparison outputs. New publication follows existing exclusive-file and parent-fsync patterns, using a hard link to publish a complete single-file envelope atomically.

## Schema and identities — IMPLEMENTED

orion.research-session.v1 bundle contains COMPLETED state, sessionId, manifest, results, resultHash and bundleHash. Manifest records dataset ID, canonical hash, historical artifact hash and parent provenance; readiness includes instrument, H1 timeframe, calendar/version, coverage and chronological index boundaries. Per-strategy training/validation configurations record initial capital, risk/sizing, execution and costs; resolved parameters and warmup requirements are explicit. Configuration stores fixed candidates, smoke, cost stress and walk-forward mode; selection is NONE, evidence policy always insufficient, randomness seed null (no stochastic algorithm).

Hash rules: SHA-256 of sorted-key JSON using existing identity; arrays retain order, JSON projection removes undefined object properties, numbers use JS JSON rendering. No timestamp or output path enters identity. Full source/runtime identity is semantic. SHA hashes establish consistency, not authenticity against an attacker who can rewrite the complete envelope and all hashes. Reports retain exact USD8 strings and existing rounded numeric financial outputs; replay requires exact canonical equality, no tolerance. Runtime metadata is deliberately strict, not normalized away.

Source identity recursively digests JS in calendar, CLI, analytics, optimization, strategies, indicators, backtesting, financial, execution, risk, portfolio, market-data, reporting and persistence, plus service package.json; includes unstaged/untracked runtime JS bytes. Filesystem ordering is sorted. No Git-only equivalence claim; unrelated Freqtrade, credentials, reports and tests excluded. Strict Node version match. No external research dependencies. Git revision provenance and automated dependency-closure checks are PENDING.

## Persistence and lifecycle — IMPLEMENTED / PARTIAL

Private directory mode required; parent must exist and resolve without symlinks. Traversal in output directory rejected. Existing historical reader rejects symlink paths for input/session. UUID .incomplete file opened exclusively at 0600, written and fsynced; exclusive hard link publishes final session-ID filename; parent directory fsynced. Concurrent identical creators compare verified bundle hashes; conflicting/tampered prior output fails closed. No overwrite. Single-file envelope avoids cross-file commit ambiguity.

Lifecycle is deliberately small: computation is unpublished; temporary file means INCOMPLETE; published artifact means COMPLETED. Integrity VERIFIED and replay IDENTICAL are outcomes of commands, not mutations of original evidence. Failed computations/replays do not publish success or modify originals. Crash leftovers remain explicitly .incomplete and cannot pass session inspection. Cleanup/recovery listing, fault-injection coverage, durable failure/replay-attempt events and hostile concurrent directory replacement resistance are PENDING. Trusted private directory and ancestors must not be concurrently replaced by another writer; this is not a multi-tenant hostile-filesystem design.

## Replay — IMPLEMENTED

Read and validate bundle schema/state/hash rules and all envelope/result hashes. Read caller-supplied historical artifact through existing safe reader and verify mandatory original artifact/content/dataset identities. Reject changed runtime source identity. Reconstruct recorded fixed comparison options and execute original comparison. Recompute descriptive diagnostics and compare complete canonical result hashes. Never update originals, promote candidates, call final evaluation or consume holdout registry.

Inspect does self-hash checks but no research execution or historical reads. Verify checks integrity and referenced historical input, explicitly NOT_PERFORMED computational replay. Replay returns IDENTICAL only after recomputation. Detailed typed field-by-field schema validation and rejection of irrelevant CLI options are PARTIAL.

## Context and holdout — IMPLEMENTED

Existing C2 semantics preserved: 60/20/remainder chronological split; holdout removed before execution; full dataset still read for integrity checks. Closed historical prefix indicators; no trades from context; first context signal discarded. Accounts start flat at reset capital, force-close at boundary, final pending signals are not executed. Rolling train origin resets context; OOS uses origin context, expanding training grows; non-overlapping OOS windows, baseline costs only. Existing report warning explains this distinction.

No holdout consumption APIs called, no registry opened or altered. Registry freshness is UNKNOWN_NOT_QUERIED, never described as fresh. Read-only durable registry status integration is PENDING.

## Statistics and governance — IMPLEMENTED / PARTIAL

Descriptive validation trade counts, observed UTC dates, train/validation PnL (unequal duration warning), lag-one bar-equity return autocorrelation for at least 30 returns with positive variance; otherwise null. Autocorrelation is descriptive, includes calendar gaps and does not estimate independent sample size. Existing walk-forward report supplies positive/negative/flat validation windows. No IID trade bootstrap, intervals, effective-sample claims, significance or predictive certainty. Every strategy remains INSUFFICIENT_EVIDENCE. Governance counts strategies/configurations/scenarios; records no selection and unknown unrecorded dataset/validation reuse. Multiple comparison and selection-bias warnings explicit. Active evaluation-period diagnostics, recorded cross-session reuse index and dependence-aware uncertainty are PENDING.

## Reporting and safety — PARTIAL

CLI returns session ID, paths, hashes, evidence and inspection summaries; bundle is complete JSON result/configuration. Existing safe HTML/CSV unchanged. Session-aware optional HTML, canonical bytes on disk (hashes are canonical, stored JSON insertion order is not), concise text table and persisted replay reports are PENDING. Generated sessions ignored by service .gitignore. No network calls, environment reads or broker transport added; no ledger, historical data or Freqtrade modifications. API tests use actual local consolidated artifact.

See delivery for exact test execution and acceptance outputs. The full requested 35-item matrix, subprocess crash injection, implementation-change rejection test and network/credential tripwires specific to C3 remain PARTIAL; existing engine tests provide additional safeguards but are not a substitute for those missing targeted tests.

## Replay defect discovered during validation — IMPLEMENTED fix

Walk-forward embeds the original candidate syntax in selected candidates and frozen identities. Initial C3 creation used omitted default parameters while replay supplied resolved parameters, producing a legitimate exact-output mismatch in metadata. C3 now resolves and validates all default candidate parameters before its first comparison execution. Both creation and replay receive the identical effective syntax; legacy comparison commands remain unchanged. Financial output equality was never weakened or normalized around this difference.

Manual source-drift check: after the working-tree replay fix, replay of the earlier acceptance session (session-8720b019822a786603ca7854ccfe8962c277b618ab6ee5e59fab535c06eb2767) exited 1 with IMPLEMENTATION_IDENTITY_MISMATCH. The original artifact remained intact. This independently exercised rejection of changed uncommitted research implementation bytes without modifying source from inside tests.
