# Orion Quant V3.3-B delivery

Local implementation: IMPLEMENTED. Automated assurance: TESTED with offline fixtures, including actual process interruption. Real Demo acceptance: PENDING user execution. Physical power-loss assurance and broker-calendar accuracy: PARTIAL. No implementation blocker is known. Final counts are recorded below after regression execution.

## Architecture and contracts

`market-data/collection.js` orchestrates the existing `acquireHistory` function. `capital-history.js` exposes its existing anchored atomic JSON writer/reader for checkpoint reuse; existing file formats and canonical hashes are unchanged. The verified history loader additionally checks full requested coverage, resolution, acquisition identity, aggregate quote ordering and acquisition cutoff. A supplied response resolution other than HOUR is rejected. Existing JSON acquisitions remain readable.

Job creation is offline. A new private directory contains immutable `job.json`: random UUID, EUR/USD, H1, Demo environment, creation timestamp, exact normalized requested period, declared calendar, bounded windows, pacing/retry policy and a job-salted account ID hash. The account ID itself, credentials and session tokens are not stored. Resume compares the configured account hash before authentication in the CLI and verifies current broker context for every attempted window. Discovered epic changes fail closed.

Bounds: 1–100000 requested UTC hours, at most 1000 windows, each 1–1000 hours. Defaults: 168-hour windows, 200-ms read pacing, two retries per window per explicit resume, initial retry delay 1000 ms with exponential backoff capped at 60000 ms. Read pacing is 100–60000 ms; retries are 0–5; initial retry delay is 1000–60000 ms. Every retry repeats context verification, discovery and the same exact bounded period. Each window has at most retries+1 attempts per invocation. A later explicit resume gets a fresh bounded retry budget, with lifetime attempt counts retained. There is no uncontrolled retry loop, reauthentication, keepalive or session refresh. Authentication and logout are outside the read-pacing policy; login is performed once per user command and never retried.

Transient retry whitelist: HTTP 429/500/502/503/504, sanitized TIMEOUT and NETWORK_ERROR. HTTP 401/403 stop immediately and remain resumable only through a new user command/session. Retry-After headers are not exposed by the adapter; the explicit conservative backoff is used. Other malformed/invalid responses are rejected; missing market hours produce UNAVAILABLE with `INCOMPLETE_SOURCE_COVERAGE`, which describes the observed response and does not establish broker entitlement or permanent unavailability.

## Acquisition state machine and recovery

Windows start PENDING. Before a request, an exclusive fsynced hash-linked checkpoint records RUNNING and increments its attempt count. Successful complete segments are atomically stored as `segment-<artifactHash>.json`; only then does a checkpoint record ACQUIRED. Entirely declared closed windows become CALENDAR_CLOSED without price requests or invented bars. Recoverable faults record INTERRUPTED; quality/source failures record REJECTED or UNAVAILABLE. Those latter states require a new explicitly created job to preserve the rejected evidence. They are not silently retried with revised assumptions.

The job is STAGING while any window is incomplete, READY after every window is acquired/calendar-closed, and PUBLISHED only after publication has a durable checkpoint. READY is not a published research artifact. `history:job:verify` reports evidence verification and complete-coverage verification separately. No candle prices are printed by status or registry inspection.

Checkpoints are exclusive `checkpoint-000001.json` and subsequent files, each binding the preceding digest and job identity. Interior sequence gaps, invalid JSON, hash changes, wrong identities and corrupt segment references fail closed. A competing job writer loses on exclusive sequence creation and stops. No checkpoint is overwritten. Completed windows are verified and skipped on resume. A killed RUNNING window is requested again within its original bounds. The sequence limit is 14999 snapshots; reaching it fails before another request, requiring a new job rather than an unbounded journal.

Filesystem errors are outside broker-retry handling. Failure after a segment link but before its checkpoint can leave a valid orphan segment. Explicit resume can download the unfinished window again, retaining the orphan evidence; no orphan is automatically merged. Hard exits can also leave private `.tmp` files. No automated cleanup deletes datasets or evidence. A crash before the initial `job.json` publication leaves an unusable directory; preserve it and create a new job under a different name.

Writers fsync the file before an atomic no-clobber hard link, then fsync the directory. Existing Linux `/proc/self/fd` directory anchoring, O_NOFOLLOW ancestors/finals, 0600 files and bounded regular-file reads are reused. Registry publication is serialized by SQLite BEGIN IMMEDIATE with zero busy wait and process-scoped locking, so another publisher fails promptly and can be explicitly retried. Its private `.publication.sqlite` stores no catalog or research state. The OS releases the lock after process exit; callers never delete a stale PID lock. Catalog truth is the immutable JSON files, so no mutable catalog/database commit can get ahead of the artifact.

## Calendar and price integrity

The default calendar is the existing declared FX New York 17:00 convention, including IANA US DST and weekly closures. Optional `--calendar FILE.json` at job creation accepts the existing calendar contract: provider, closures (New York local dates), reducedDates, weeklyOpenHour, weeklyCloseHour, weeklyTimezone and nonoverlapping explicit exceptions. It is frozen into the job and inherited by every segment. Unknown fields and invalid timezone/ranges fail. Calendar differences prohibit automatic merging; no implicit reconciliation is performed. A deliberately declared calendar change requires independently acquired data and an explicit version relationship.

Coverage checks include requested edges, empty windows and gaps between segments. Missing open hours fail; weekly/declared closures may be absent. Observations during declared closures remain observed evidence and are flagged by the existing manifest. The warning `CALENDAR_IS_DECLARED_NOT_BROKER_VERIFIED` remains visible. No price interpolation or calendar-derived price generation occurs. All-closed jobs may be READY but cannot publish an empty research dataset.

Observed positive finite bid/ask OHLC, intrabar bounds, contemporaneous endpoint spreads and necessary aggregate high/low ordering are preserved. Missing sides fail. Existing canonical midpoint normalization averages the two sides' extrema; it does not claim observed mid-tick extrema. H1 aggregates establish no exact tick order, freshness, liquidity or maximum executable spread. Source JSON numbers use the unchanged binary64 contract without tick rounding; lexical decimal precision is not retained and no broker tick-size rule is invented. The existing research execution quality/risk checks remain responsible for executable assumptions.

## Registry, identity and merging

Publication first independently verifies every segment, its requested bounds, epic, calendar and full consolidated coverage. A catalog file is `<registry>/sha256-<canonicalContentHash>.json`, using the existing `orion.capital-history.v1` envelope and existing manifest v2. The original candle canonicalization/hash versions are unchanged; no migration is performed.

The manifest retains ID, instrument, timeframe, source, acquisition timestamp, actual first/last bar-open coverage, requested half-open coverage, candle count, canonical SHA-256, data/manifest schema, transformation version, declared calendar, quality, license and provenance. The acquisition retains Demo environment, original timestamps, request windows, price basis and limitations. New `acquisition.registry` binds validation/provenance status, source segment filename/hash/ID references and explicit parent dataset IDs; the existing artifact hash covers it. Files must remain with their staging job to resolve segment references. A published artifact itself is self-contained for verification/research; publishing does not copy or delete its source evidence.

Repeated publication preserves the first complete envelope for identical canonical content. Acquisition timestamps, job IDs and parent lists do not create a different content ID. A later job with identical prices keeps its own evidence/checkpoints and references the existing catalog envelope. Changed candles yield a new content ID. A registry scan rejects conflicting overlapping prices unless each conflicting existing dataset is explicitly declared as a parent. Parent IDs must exist in the registry. CLI `--parent` accepts one parent; the programmatic API accepts multiple. Parent references are recorded in the publication checkpoint for idempotent repeats.

`history:merge` requires compatible EUR/USD H1 observed-quote, source/epic, normalization, schema, timestamp, license and calendar contracts. It deduplicates identical canonical observations and sorts chronologically. Different OHLC/quote/volume observations at the same timestamp fail with affected UTC timestamps; neither input is changed. Canonical output hashes are independent of segment order. Given the same acquisition timestamp/options, the merge envelope is deterministic too. Missing open hours in the union fail. Revisions are independently preserved as new datasets, never selected automatically during merge.

`history:registry:inspect` independently verifies each catalog artifact and reports conflicting pairs. Publication scans at most 1000 datasets; pairwise registry inspection is capped at 100 datasets. These explicit bounds avoid unbounded local work. Catalogs above those limits require a future indexed catalog implementation. Published files are immutable through application no-clobber semantics, not OS WORM storage: owners can modify/delete them outside Orion, and verification detects changes. SHA-256 hashes are integrity checks, not signatures or broker authenticity proof. Consistent malicious rewriting or valid-tail rollback requires external trusted anchors to detect.

## Offline research

Published JSON uses the existing `importDataset` contract. Backtesting, indicators, all four existing research strategies, walk-forward optimization, replay, risk and reporting consume its canonical candles and stored calendar/provenance. Durable replay retains its existing 1000-candle maximum. No ingestion operation imports strategy or optimization modules, launches research, consumes final holdout authorization or changes chronological boundaries. Status/registry inspection prints metadata, not observations. Existing APIs still permit explicit research access to the full local dataset; this is logical holdout isolation, not access-control encryption of final prices.

## Exact CLI and controlled manual Demo acceptance

Run from `~/Downloads/orion-trading-engine`. The following commands are for the user to execute, not part of automated testing. Keep the existing service-local Demo configuration and `TRADING_ENABLED=false`; configure `CAPITAL_EXPECTED_ACCOUNT_ID` locally. Do not put keys, passwords or tokens in command arguments or share the local environment file. The `demo` script loads that file. Creating a job via that script only uses the expected account ID; it does not authenticate.

This test requests three completed EUR/USD weekday hours in three separate one-hour windows. A new job name is required if one already exists. The dates deliberately remain fixed; lack of broker history causes explicit failure rather than fabricated data.

```sh
mkdir -p -m 700 services/orion-fx/data/capital-demo/v33b-registry
npm run demo --prefix services/orion-fx -- history:job:create --job data/capital-demo/v33b-small-job --from 2026-11-02T00:00:00Z --to 2026-11-02T03:00:00Z --window-hours 1 --retries 1
npm start --prefix services/orion-fx -- history:job:status --job data/capital-demo/v33b-small-job
```

Only this next command performs the new job's broker operations: one explicit login, paced context/discovery/prices per window and logout. On transient interruption, run the same command again yourself. It never changes the approved dates or submits orders. Do not loop authentication commands.

```sh
npm run demo --prefix services/orion-fx -- history:job:resume --job data/capital-demo/v33b-small-job
```

Continue offline. Verification must show three ACQUIRED windows with complete coverage; publication must report count 3 and a `sha256-...` identity. Copy the printed path if individual artifact inspection is desired.

```sh
npm start --prefix services/orion-fx -- history:job:verify --job data/capital-demo/v33b-small-job
npm start --prefix services/orion-fx -- history:job:publish --job data/capital-demo/v33b-small-job --registry data/capital-demo/v33b-registry
npm start --prefix services/orion-fx -- history:registry:inspect --registry data/capital-demo/v33b-registry
npm start --prefix services/orion-fx -- history:job:status --job data/capital-demo/v33b-small-job
```

Expected registry metadata: EUR/USD, H1, Demo, three candles, exact requested bounds, PASS continuity under the declared calendar, observed bid/ask, unverified license, no detected conflicts. Repeating the publish command must return the same ID without rewriting the artifact. Repeating resume for a complete job verifies local evidence and makes no broker request. Logout failure returns nonzero even if acquisition completed; inspect offline status before deciding whether another resume is necessary.

Other offline commands (replace illustrative paths/IDs with actual existing files):

```sh
npm start --prefix services/orion-fx -- history:inspect --input data/capital-demo/v33b-registry/sha256-ACTUAL_HASH.json
npm start --prefix services/orion-fx -- data:validate --input data/capital-demo/v33b-registry/sha256-ACTUAL_HASH.json
npm start --prefix services/orion-fx -- history:revisions --left data/capital-demo/first.json --right data/capital-demo/revised.json
npm start --prefix services/orion-fx -- history:merge --left data/capital-demo/segment-a.json --right data/capital-demo/segment-b.json --out data/capital-demo/new-merged.json
npm start --prefix services/orion-fx -- history:job:publish --job data/capital-demo/revised-job --registry data/capital-demo/v33b-registry --parent sha256-ACTUAL_PARENT_HASH
```

Each command has `--help`. Only `history:job:resume` among the new commands accesses the broker; the pre-existing `history:download` remains an explicit network command. Creation, status, verification, publication, merge and revision/catalog inspection do not call the broker. Use `npm start` for offline commands without loading environment files; supply the expected account ID in the process environment when creating a job without the `demo` script. Local artifacts under `data/capital-demo/` remain Git-ignored.

## Test evidence and limitations

New focused tests cover multi-window bounds/pacing/UTC/exclusive endpoints; weekend and both DST regimes; declared holidays; missing, duplicate, unordered, malformed, crossed and outside-period data; unsupported resolution; 401/403 with no retry; bounded 429/500/503/timeout/network retries; resumed and repeated jobs; actual child SIGKILL; filesystem failure; corrupt metadata, sequence gaps and modified candles; identity mismatch; atomic no-clobber publication and final-checkpoint recovery; deterministic merge and conflicting revisions; explicit parent version creation; concurrent publication exclusion and crash-released locks; offline research/indicators/replay/report compatibility; untouched holdout and historical strategy prefixes; sanitized error storage and account-hash privacy. Existing tests cover real adapter mocked HTTP statuses/timeouts, endpoint/order restrictions, token echo rejection, durable replay and risk/financial regressions.

The optional `tests/fixtures/offline-network-guard.js` preload forbids external global fetch and allows loopback fetch for root HTTP tests. Broker adapters still receive mocked transports. The implementation added no alternate broker transport. All recorded broker operations were mocks; no Capital.com request was made. No unit test claims live source availability or universal power-loss recovery. The adapter retains the existing Demo-only origin, request allowlist and disabled trading checks. No broker, risk, config, strategy, Freqtrade or Docker code was changed.

Known limits: account identity is a salted integrity declaration, not a broker-signed identity; no independent Demo attestation beyond pinned endpoint/configuration. Acquisition requires a fresh user login after session expiration. Broker holidays/maintenance/entitlements remain unverified. License remains unverified and redistribution disallowed. Large catalogs and full tick/decimal-string storage are future work. Trusted private local Linux directories, procfs, SQLite file locking and same-filesystem hard links are required; network/shared filesystems are not certified. Filesystem corruption must fail closed and be recovered from preserved evidence/backups, not silently repaired. Never delete SQLite lock files while a publisher may be running.

## Final recorded validation — 2026-11-08

All commands below completed with exit 0 against the final implementation. Node v26.13.0 reports files in its default isolated mode, so additional individual-case runs make the exact counts explicit.

| Command | Final result |
| --- | --- |
| `npm test` with external-fetch guard | PASS, 20/20 files; 0 failures |
| `npm test --prefix services/orion-fx` with guard | PASS, 19/19 files; 0 failures |
| Root `node --test --test-isolation=none` with guard | PASS, 203/203 individual cases; 0 failures/skips/cancellations |
| `npm run test:cases --prefix services/orion-fx` with guard | PASS, 194/194 individual cases; 0 failures/skips/cancellations |
| Focused collection `--test-isolation=none` with guard | PASS, 31/31 cases; 0 failures/skips/cancellations |
| Focused collection default isolation with guard | PASS, 1/1 file |
| `npm run check` | PASS; orders disabled |
| `git diff --check` | PASS |

Reproduce offline checks from the repository root:

```sh
ORION_TEST_GUARD="$PWD/services/orion-fx/tests/fixtures/offline-network-guard.js"
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm test
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm test --prefix services/orion-fx
NODE_OPTIONS="--import=$ORION_TEST_GUARD" node --test --test-isolation=none
NODE_OPTIONS="--import=$ORION_TEST_GUARD" npm run test:cases --prefix services/orion-fx
NODE_OPTIONS="--import=$ORION_TEST_GUARD" node --test --test-isolation=none services/orion-fx/tests/collection.test.js
npm run check
git diff --check
```

Intermediate failures exposed a service-relative fixture path, inherited test-runner arguments and a Node 26 garbage-collection issue in the fixture's unreachable never-resolving promise. Fixtures now use module-relative paths, plain Node child processes, explicit cleanup and a live IPC disconnect handler retaining the wait. The final runs above passed in both runner modes. An in-process guard also prevents opening/closing a second raw descriptor for an inode already locked by this process; SQLite owns the lock descriptors after initial safe creation. Interrupted-publication recovery fsyncs the registry parent again before recording the final job checkpoint.

Final diff review: only Orion FX collection/storage/CLI/tests and these two documents changed. Config, broker adapter, risk engine, strategy code, Docker and Freqtrade have no tracked changes. The original untracked Freqtrade scripts remain untouched. No files are staged; no credentials or acquired datasets were added. The documented local job/registry paths are confirmed Git-ignored. Branch remains `feat/orion-quant-v3`, HEAD `22704b2`. No commit or push occurred.

Acceptance classification: local implementation and offline verification COMPLETE; actual Capital.com Demo collection/availability PENDING the explicit manual commands above. Real-world interruption recovery, broker-calendar accuracy and every possible power-loss scenario remain unverified.
