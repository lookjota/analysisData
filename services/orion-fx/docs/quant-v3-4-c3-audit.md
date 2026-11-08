# Orion Quant V3.4-C3 audit — PARTIAL

Baseline: branch `feat/orion-quant-v3`, HEAD `0daa85d6ca912de7f7c37b51ebf299f5383e1bf8`. Initial status contained only untracked `services/freqtrade/scripts/`; it was not inspected or modified. Changes are limited to services/orion-fx. No credentials, protected research registry, immutable datasets, broker sessions or orders were used.

## Architecture and trust boundaries

IMPLEMENTED (existing): `forward-journal.js` verifies sealed genesis, calendar version, contiguous observation filenames/sequences, predecessor hashes, candle evidence, timing, calendar/gaps and immutable revision quarantine. JSON is caller-controlled evidence. Its SHA-256 chain detects internal corruption and provides local tamper evidence relative to retained anchors; it provides no external origin authentication. A coordinated rewrite of all evidence and accounts remains outside this guarantee. A standalone journal cannot distinguish valid suffix deletion from an earlier valid prefix without an external retained head; consumed account commitments detect truncation below their cursors. No automatic repair is implemented.

IMPLEMENTED (existing): `appendable-commitments.js` overlays domain-separated commitments without rewriting v1 journal bytes. `strategy-durable.js` binds genesis, calendar, configuration, pending intent and semantic source identity. It reconstructs every committed prefix, compares each cursor, financial event, risk transition and projected USD8 state against the reference engine. `persistence/journal.js` uses BEGIN IMMEDIATE, synchronous FULL, DELETE journaling and one effects-plus-checkpoint transaction per candle. Neither financial effects without a checkpoint nor checkpoints with missing expected effects pass recovery verification. SQLite supplies locking; no lock files are deleted to recover a writer.

PARTIAL: four accounts commit independently. A killed worker can leave visible recoverable divergence; there is no four-account atomic transaction. Status/readiness uses normal F2 recovery, appending recovery audit events: it is financially read only, not byte read only. Existing risk latches persist without administrative reset. Fixed-watermark `journal-operations.js` uses a separate snapshot identity and account filenames. SQLite schema version remains 1; historical C3/C4 compatibility is verified by the regression suites, not a migration.

## Filesystem boundary

User-controlled inputs: journal directory, receipt/batch JSON path, run ID and account filename in programmatic APIs. Run IDs and account filenames have existing strict allowlists. Relative evidence paths resolve against the invoking process working directory; callers should use absolute paths in operational scripts.

IMPLEMENTED: `security/path-policy.js` rejects lexical traversal before resolve, backslashes, NUL, named credential directories/files, repository metadata, freqtrade and holdout-named components before filesystem access in shared JSON helpers. Forward CLI no longer erases traversal evidence with an early resolve. This is a conservative lexical policy, not secret-content discovery; an innocuously named hardlink/copy or arbitrary native filesystem reader is not covered.

IMPLEMENTED (reused): shared JSON reads/publications traverse Linux directories via O_DIRECTORY|O_NOFOLLOW and /proc/self/fd anchors. Final opens use O_NOFOLLOW; reads use O_NONBLOCK then descriptor fstat to reject nonregular or oversized input. Publication creates UUID temporary files with O_EXCL, mode 0600, syncs data, uses exclusive hardlink publication, and syncs the containing directory. Existing collisions fail without replacing evidence. New journal directories use mode 0700. No preflight lstat claim substitutes for anchored operations.

PARTIAL: directory enumeration, initialization and subsequent SQLite opens are not one anchored operation. SQLite validates realpath, type/link count and permissions, but reopens by pathname after its preflight descriptor closes. A hostile actor able to rename/replace a run directory or SQLite inode can race these checks. Private operator-owned directories and trusted ancestors remain REQUIRED. Preventing arbitrary same-user filesystem attackers needs a native openat2/SQLite VFS or isolated service identity; this checkpoint does not meet that acceptance gate. Linux /proc descriptor availability is required; unsupported platforms fail rather than falling back silently. Temporary files can survive SIGKILL; they are not verified publications and are not auto-promoted.

TESTED: file, parent and dangling symlinks; traversal; protected names; directory input; readonly /proc publication failure; collision preservation and mode 0600. The /proc test proves visible write failure, not exhaustive ownership/ACL denial handling. PENDING: directory-replacement race, FIFO/device matrix, hostile temporary-file races and permissions under a separate unprivileged identity.

## Broker, network and credentials

IMPLEMENTED (existing): exact Demo base URL allowlist, Live/alternative URL rejection, redirect:error plus returned-origin checks, read-only endpoint allowlist (session management only writes), exact EUR/USD discovery, HOUR historical resolution, bounded UTC intervals/requests, AbortController timeout and sanitized errors. `capital-demo.js`, history collection and acquisition receipts are network-capable boundaries; the paper ledger has no order adapter. Receipt collection requires an explicitly injected transport and always labels output ENGINEERING_REPLAY/UNVERIFIED_OFFLINE_FIXTURE. Verification recomputes metadata from raw provider-shaped evidence and rejects resealed provenance promotion. These are offline adapter tests, not verification of provider behavior.

IMPLEMENTED / TESTED: dedicated `cli/forward-offline.js` installs deny-all fetch, HTTP, HTTPS, TCP, Socket.connect and TLS tripwires before dynamically importing the forward runtime. Builtin ESM exports are synchronized. Six independent API attempts in a subprocess throw before connection. `npm run forward:offline -- ...` and `npm run paper:ops:readiness -- ...` use this boundary.

PARTIAL: legacy cli/index.js retains broker-capable commands and imports. Programmatic APIs and legacy forward dispatch do not install process-global guards. The tripwire does not prevent native addons, child processes, previously captured references, other protocols or deliberate restoration of APIs. Shared JSON helpers block sensitive paths before opening, but there is no process-wide credential-read syscall interceptor or OS credential sandbox. No .env was opened. Full regressions use the existing external-fetch preload and injected offline fixtures, with root HTTP tests allowed loopback; that preload alone does not deny direct TCP/HTTP.

TESTED: all 18 focused C3 cases passed inside a fresh unprivileged Linux user/network namespace (12008.504358 ms). The namespace probe and test both exited 0 on this host. Reproduce from the repository root:

```sh
unshare --user --map-root-user --net node --test services/orion-fx/tests/quant-v3-4-c3.test.js
```

This needs no privilege escalation but can be disabled on other hosts. This result covers the focused C3 suite, not the full regressions or real provider behavior. An isolated namespace does not itself constrain filesystem reads.

## Execution and readiness

IMPLEMENTED: four existing accounts trend, mean-reversion, breakout, ma-cross; EUR/USD H1; USD 1000 each; risk .005, daily loss .01, one position. No financial formulas or strategy signals changed. Forward appendable replay uses observed historical bid/ask OHLC with zero additional assumed spread and 0.1 pip adverse assumed slippage; ordinary fixed fixtures retain their configured assumed spread. These are historical next-open model fills, never verified executions or current executable quotes.

IMPLEMENTED / TESTED: readiness emits UNKNOWN when evidence cannot be inspected; otherwise FORWARD_OBSERVATION_BLOCKED. It includes journal verification, freshness, receipt verification/missing status, account identity/cursors, reconciliation and risk visibility. ENGINEERING_READY is a subordinate assessment only when four active accounts reconcile at the head. Receipt-to-journal binding is explicitly UNVERIFIED. Independent source authentication and executable quotes remain missing; no current path can return FORWARD_PAPER_MODEL_READY. Synthetic fixture success cannot promote readiness.

## Crash and concurrency coverage

Existing B/C/C2 tests use actual child SIGKILL and explicit IPC or fault callbacks. These establish process interruption behavior, not power-loss or storage-controller durability.

| Requested window | Evidence / status |
|---|---|
| Before journal append | TESTED C receipt after-publication barrier, before append |
| During append writes | PENDING interruption inside write/link/fsync |
| After append before paper | TESTED C2 after-journal-append self-SIGKILL |
| Before account transaction commit | TESTED C2 before-commit callback after inserts |
| After first account commit | PARTIAL C2 direct trend worker after-commit; laggard visibility/convergence covered separately |
| Commit before acknowledgment | TESTED C2 after-commit callback |
| During recovery verification | PENDING synchronized kill inside verifier |
| During receipt publication | PARTIAL C before/after publication barriers; no kill inside publisher |
| During report publication | PENDING |

TESTED existing: same-account subprocess workers, killed journal lock owner and retry, immutable duplicate append, four-account retry event-byte equality, pending-intent identity, resealed cursor rejection, PAUSED/HALTED recovery. PENDING: dedicated simultaneous different-strategy workers, simultaneous receipt publishers, conflicting appenders and stale-writer matrix. Advisory locking is not bypassed. Duplicate success alone is not treated as exactly-once proof; C2 compares stored event bodies/digests and USD8 ledger/cash/equity.

## Remaining gates and Demo prerequisites

BLOCKED: complete hostile-filesystem protection, all requested synchronized crash windows, exhaustive concurrency and credential-read isolation acceptance. PENDING: independent retained-head policy/export, native anchored SQLite design and operational recovery policy. Local hashes are not provider signatures. No authenticated forward source or executable quote exists.

Next: complete those engineering gates offline, then separately review a bounded read-only Demo acquisition design with exact host/instrument/UTC coverage, operator-controlled credentials, sanitized telemetry, independent receipt capture, freshness policy and explicit activation authorization. Do not activate acquisition from this readiness command.

## Completed validation

TESTED: root npm test 29/29 files; service npm test 28/28 files; service no-isolation run 323/323 individual cases across 28 files; separate foundation 9/9 cases in one file. Focused C3 18/18 cases; focused B+C3 37/37; network namespace C3 18/18. All completed runs had zero failures and skips. npm run check and git diff --check passed. Exact commands, durations, changed files, the failed preload invocation before discovery and remaining blockers are recorded in [delivery](quant-v3-4-c3-delivery.md). Financial reference regressions and C4 schema validation passed without changed expected results.
