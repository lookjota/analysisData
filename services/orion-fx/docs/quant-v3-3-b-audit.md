# Orion Quant V3.3-B audit

Baseline: `feat/orion-quant-v3`, HEAD `22704b2`, repository `lookjota/analysisData`. The only initial status entry was the pre-existing untracked `services/freqtrade/scripts/` directory. It remains untouched. No environment file, credential, session token or user dataset was read or printed. No broker request, order, infrastructure change, commit or push was made.

## Phase zero: actual architecture reviewed

Read `brokers/capital-demo.js`, `market-data/{capital-history,historical,manifest,prices}.js`, `calendar/forex.js`, `cli/{history,index,offline,durable}.js`, existing V3.3-A audit/delivery, test fixtures and acquisition/security tests. Inspected backtesting, paper replay/durable replay, research session, walk-forward optimization, temporal splits, indicators, reporting and persistence integration.

The baseline already contains working historical retrieval. `acquireHistory` verifies Demo account context, discovers EUR/USD, converts explicit UTC/end-exclusive periods to disjoint inclusive API windows of at most 1000 hours, paces reads, normalizes observed bid/ask OHLC and rejects incomplete coverage. It returns a verifiable `orion.capital-history.v1` artifact. `parseHistoricalPrice`, `normalizeCandle`, `normalizeQuoteBars`, `validateDataset` and `datasetManifest` provide price validation and unchanged canonical quote hashes. `verifyManifest` and `verifyHistory` bind content/provenance. `saveHistory` provides exclusive atomic hard-link publication after file fsync, directory fsync, private files and anchored Linux O_NOFOLLOW path traversal. `importDataset` is already the common offline JSON/CSV loader.

`marketSession` supplies IANA timezone conversion, New York 17:00 weekly sessions, US DST, declared holidays and explicit schedule exceptions. This is a declared calendar, not a verified broker schedule. Research systems already consume canonical candles, use observed quote prices, keep chronological splits and restrict strategy inputs to the authorized historical prefix. Durable replay retains its existing 1000-row limit. No replacement pipeline or strategy was needed.

Missing at baseline: durable multi-request progress, bounded retries, recoverable staging, an immutable consolidated catalog, explicit overlap revision handling and corresponding CLI/recovery evidence. Existing V3.3-A documents describe an older commit/test count and pending live verification; they were read as historical documentation, not current test evidence. The user's reported successful Demo acquisitions were not repeated here.

## Integrity decisions

- Reuse `acquireHistory` per bounded window. Each retry repeats the entire uncommitted window; it never broadens dates. Verify account and discovery each time. Retain the first committed epic and reject changes.
- Append hash-linked, exclusive checkpoint snapshots. Stable job configuration and requested boundaries never mutate. Competing writers collide on the next sequence and fail rather than overwriting another writer.
- Store complete independently verified segments before marking them acquired. A crash can leave an orphan private segment/temp file; it cannot publish partial final content. Preserve that evidence and repeat the unfinished window on explicit resume.
- Publish only after verifying all windows, segment identities and requested edges. Calendar-only windows contain no invented prices. An entirely closed job cannot produce a nonempty research dataset.
- Use existing content identity `sha256-<canonicalContentHash>`. Do not change v1/v2 candle, manifest or artifact contracts. Additional registry metadata lives inside the existing hashed acquisition envelope. Same canonical content retains the first catalog provenance envelope.
- Preserve source bid/ask numbers; midpoint aggregates remain the existing explicit derived normalization. Never infer a missing quote side. Number values retain the existing JavaScript binary64 contract; lexical decimal formatting and arbitrary precision source strings are not recoverable from JSON numeric values. There is no documented broker tick-size metadata here, so no invented precision/tick rounding rule is applied.
- Merge only compatible normalization, temporal, calendar, license, epic and price contracts. Exact canonical overlaps deduplicate; different overlapping candles fail with UTC timestamps. Revised source data can publish under a different content identity only with explicit existing parent references covering detected conflicts.
- The registry is the set of immutable content-addressed JSON files. A SQLite BEGIN IMMEDIATE lock serializes publication scans and final links; the database stores no catalog metadata or holdout state. A process exit releases its OS lock. Scanning the files recovers publication even if the job's final checkpoint was interrupted.

## Scope and assurance

IMPLEMENTED: bounded acquisition, durable staging/recovery, strict continuity, price preservation, immutable catalog, revision detection, offline merge/verification and explicit CLI commands.

TESTED: offline fixtures, sanitized broker error objects plus existing mocked HTTP adapter tests, actual child SIGKILL, filesystem path interruption, concurrent publication rejection, registry recovery, canonical hashing, research prefix isolation and unused final holdout. Exact final regression results are in the delivery document.

PARTIAL: physical power-loss durability assurance. Fsync/link ordering and process faults are exercised; these are not universal proofs for every filesystem, storage controller, kernel failure or power-loss timing. Hash chains detect modification and interior deletion, but cannot prove a valid tail was not rolled back without an external trusted checkpoint.

PENDING: user-run Capital.com Demo acceptance, actual broker historical entitlement/availability, real rate-limit behavior and broker-calendar reconciliation. No mocked result establishes these.

BLOCKED: none for local implementation. External trading remains disabled and unsupported.

Final evidence: root 203/203 individual cases (20/20 default-mode files), Orion FX 194/194 cases (19/19 files), focused 31/31 cases; all have zero final failures, skips and cancellations. `npm run check` and `git diff --check` pass. External fetch was blocked by preload during regression runs. See the delivery document for exact commands, fixture-failure corrections, security boundaries and manual Demo acceptance.
