# Orion Quant V3.4-C4 delivery — PARTIAL

PARTIAL: SQLite/credential isolation against hostile same-user processes is not proven. This work does not authorize read-only acquisition or broker execution. Baseline HEAD: `df7c2993c6a90ac7a147266ae61c749933bbd7ce`; branch `feat/orion-quant-v3`. Existing untracked `services/freqtrade/scripts/` remains untouched. No staging, commits or pushes.

## Exact file-change inventory

All paths below are relative to `services/orion-fx/`.

IMPLEMENTED modified files:

- `cli/forward-offline.js`: environment restriction and filesystem/child tripwires before runtime import.
- `market-data/acquisition-receipt.js`: optional shared-publisher synchronization hooks.
- `market-data/capital-history.js`: shared SQLite pathname helper for publication locking; deterministic JSON publication hooks.
- `market-data/forward-journal.js`: publication hooks and exact orphan temporary-name exclusion without repair.
- `paper/ops-readiness.js`: separate named gates, machine-readable failed/unknown lists and conservative classifications.
- `paper/strategy-durable.js`: existing-only account reopen and recovery-verification entry hook.
- `persistence/journal.js`: guarded SQLite lifecycle, reference-counted shared connections for legacy overlapping handles, path identity checks and rejection of unrelated database initialization.
- `security/offline-guard.js`: JavaScript credential-file tripwires, process.loadEnvFile denial, child-process denial and environment allowlist.

IMPLEMENTED new files:

- `security/sqlite-path.js`: retained directory descriptor, private-write boundary, exclusive creation, file/companion validation and identity checks.
- `tests/fixtures/c4-worker.js`: IPC-started publication/account workers and bounded named crash barriers.
- `tests/quant-v3-4-c4.test.js`: 25 focused cases, including 13 actual SIGKILL cases and independent concurrent workers.
- `docs/quant-v3-4-c4-audit.md`: threat model, evidence matrix, OS recipe and remaining gates.
- `docs/quant-v3-4-c4-delivery.md`: this inventory and validation record.

## Result and limits

IMPLEMENTED: both SQLite runtime callers retain a directory descriptor until database close, enforce owner-controlled runtime directories, reject symlinks/hardlinks/unsafe companions and detect observed inode/device replacement. Reopening a missing financial account fails rather than creating a new database. Version-zero unrelated databases are rejected without migration. Existing fixed-dataset account configuration and financial schema are unchanged. Appendable semantic source identity changes intentionally and does not silently migrate prior runs.

PARTIAL: pathname-based SQLite openings still have adversarial TOCTOU windows. The helper does not authenticate ACL/mount administration or prevent same-user native filesystem access. Separate service identity and reviewed filesystem confinement remain required. No descriptor-open SQLite API, universal sandbox or power-loss durability is claimed.

TESTED: crash checkpoints cover receipt/journal/report before creation, after temporary sync and after publication; account before/after commit and verifier entry; reader during prepared append and killed SQLite lock owner. Exclusive publication preserves collisions. Exact orphan UUID temporary names no longer break committed-prefix recovery. Tests retain orphan evidence, never silently repair it. Full per-boundary files, cursors, effects, retry/operator requirements are recorded in the audit.

TESTED: simultaneous same/overlapping observation appenders, conflicting appenders with revision quarantine, same/distinct strategy workers, receipt publisher collision, reader/writer and explicit retry after another worker. C2 covers account lag, pending intents, risk latches and financially identical replay. These tests are safe bounded retries, not a claim that every initial concurrent writer succeeds.

TESTED: synthetic credential canary reads through requested JavaScript APIs and process.loadEnvFile are denied; child spawn is denied and inherited fake sensitive environment removed. C3 checks six JavaScript transports. A separate shell-launched Linux namespace raw socket probe printed EPERM; the Node spawnSync-unshare probe is explicitly skipped because it reports EPERM before observable execution. This is OS denial evidence, not proof of filesystem isolation or attribution to a specific kernel policy. PARTIAL: credential access through native/internal/captured APIs or aliases requires the unimplemented OS filesystem boundary. Bubblewrap probes did not establish a working minimal filesystem sandbox. No real credentials were used.

TESTED financial evidence: 12-candle synthetic independent account equity USD8 = trend `99970944000`, mean-reversion `100000000000`, breakout `100070824000`, ma-cross `99970944000`; all reconcile against existing reference results. Six-candle trend crash retries converge to `99970944000` cash/equity, `-29056000` realized PnL, `0` unrealized PnL, no exposure. C2 asserts initial cash plus signed ledger equals cash and cash plus unrealized PnL equals equity. Financial event bodies/digests and commitments are compared across recovery; risk states are never reset. Fixture numbers are not performance claims.

## Validation method

TESTED commands use `TRADING_ENABLED=false`, synthetic/offline transports, no env-file load. Full regressions use the existing absolute external-fetch-denying preload (loopback permitted for foundation tests). It is a test tripwire, not OS network isolation. Dedicated namespace runs provide separate OS network evidence.

The host's default umask is 000. Initial full runs exposed older tests creating runtime directories with mode 0777, which correctly fail the new writable-directory policy. Final full runs explicitly use `umask 077`; no test expectation or numeric oracle was weakened. Deployments must likewise use owner-controlled runtime directories. An initial C4 run also found two real journal orphan-temp recovery failures; the new exact-name exclusion fixes those. Intermediate ancestor ownership rejection was incompatible with this tool environment's UID mapping and was replaced with permission checks plus explicit operator ownership trust for ancestors. Early runs while source was evolving are diagnostic, not final passing evidence. The initial exclusive same-process descriptor registry broke four legacy persistence cases that intentionally retain overlapping journal handles; reference-counted shared connections restore that API without reopening the inode. The repaired persistence suite passes all eight cases. A namespace spawnSync probe initially failed on empty output despite status 0; its EPERM error is now treated as an explicit unsupported-condition skip, and a shell probe provides separate OS denial evidence. One interim recovery test hit its finite timeout under overlapping diagnostic load; it is not reported as a passed crash case. A later service-only failure was traced to the canary test using a repository-relative subprocess import; the fixture now uses an absolute module URL and passes from both repository and service working directories. This changes test portability, not production behavior. Superseded diagnostic process trees were explicitly stopped by their exact log-file ownership to release resources; interrupted runs are not counted as completed validation. Logs are `/tmp/orion-c4-*.log`; they are temporary local evidence, not immutable archived market artifacts.

Final validation table follows after completed runs. File totals from default Node isolation and individual totals from test:cases are distinct units; repeated runs must not be added as unique cases.

## Remaining blockers and next milestone

BLOCKED: hostile same-user SQLite replacement and process-wide credential confidentiality without dedicated identity/filesystem confinement. PENDING: WAL-mode recovery (engine uses DELETE), kill inside prefix-verification loop, distinct CLI acknowledgment interruption, complete ENOSPC/permission/ACL and allocation-budget matrix, and independent retained head anchoring. PARTIAL: report publisher coverage does not encompass every report CLI orchestration.

BLOCKED: authenticated forward source, independently verified source candle finalization and executable-price evidence. Readiness cannot return FORWARD_PAPER_MODEL_READY; valid engineering fixtures remain FORWARD_OBSERVATION_BLOCKED and missing evidence UNKNOWN. OS credential/network/persistence gates remain UNKNOWN absent deployment evidence, even if functional ENGINEERING_READY is reported.

Recommended next safe milestone: validate an operator-provisioned minimal offline service identity/filesystem sandbox and close the remaining named crash/resource gates. Then review a separately authorized bounded read-only acquisition integration. Orders remain disabled throughout.

## Actual readiness output

TESTED: six-candle synthetic fixture, after bounded paper processing. Risk eligibility is independent of cursor/ledger validity; no reset or forced advancement was performed.

```json
{
  "classification": "FORWARD_OBSERVATION_BLOCKED",
  "engineeringAssessment": "UNKNOWN",
  "failedGates": [
    "riskEligibility",
    "cursorSynchronization",
    "sourceAuthenticity",
    "executionPrice"
  ],
  "unknownGates": [
    "offlinePersistenceSecurity",
    "completedCandleSourceVerification",
    "receiptJournalBinding",
    "credentialIsolation",
    "networkIsolation"
  ],
  "gates": {
    "offlinePersistenceSecurity": "UNKNOWN",
    "journalIntegrity": "PASS",
    "accountIdentity": "PASS",
    "cursorLedgerAtomicity": "PASS",
    "financialReconciliation": "PASS",
    "riskEligibility": "FAIL",
    "cursorSynchronization": "FAIL",
    "freshness": "PASS",
    "sourceAuthenticity": "FAIL",
    "completedCandleSourceVerification": "UNKNOWN",
    "receiptJournalBinding": "UNKNOWN",
    "executionPrice": "FAIL",
    "credentialIsolation": "UNKNOWN",
    "networkIsolation": "UNKNOWN",
    "brokerOrderProhibition": "PASS"
  },
  "tradingEnabled": false,
  "brokerExecution": "DISABLED"
}
```

TESTED: missing evidence returns classification UNKNOWN, engineeringAssessment UNKNOWN, no failed gates and fourteen named unknown gates; brokerOrderProhibition remains PASS.

## Completed final validation

TESTED on Node v26.13.0. All final commands exited 0. Full commands use `umask 077`, `TRADING_ENABLED=false`, and absolute `NODE_OPTIONS="--max-old-space-size=128 --import=/home/look/Downloads/orion-trading-engine/services/orion-fx/tests/fixtures/offline-network-guard.js"`. The namespace focused run invokes `unshare --user --map-root-user --net node --test --test-isolation=none` with the C3/C4 files.

| Command | Unit | Passed | Failed | Skipped | Duration ms | Log |
|---|---|---:|---:|---:|---:|---|
| `npm test` | files | 30 | 0 | 0 | 520818.259017 | `/tmp/orion-c4-root-verified.log` |
| `npm test --prefix services/orion-fx` | files | 29 | 0 | 0 | 198254.116279 | `/tmp/orion-c4-service-final-pass.log` |
| `npm run test:cases --prefix services/orion-fx` | individual cases / 29 files | 347 | 0 | 1 | 216030.705696 | `/tmp/orion-c4-cases-final-pass.log` |
| `C3 + C4 under unshare, no isolation` | individual cases / 2 files | 42 | 0 | 1 | 93188.96273 | `/tmp/orion-c4-focused-verified.log` |
| `Foundation, no isolation` | individual cases / 1 file | 9 | 0 | 0 | 835.188896 | `/tmp/orion-c4-foundation.log` |
| `Repaired legacy persistence` | individual cases / 1 file | 8 | 0 | 0 | 6892.857387 | `/tmp/orion-c4-persistence-final.log` |

TESTED: service inventory **348 individual cases across 29 files: 347 passed, 0 failed, 1 skipped**. Foundation contributes 9 passed cases in one file. Combined inventory: **357 cases across 30 files, 356 passed, 0 failed, 1 skipped**. Default isolated npm runs report file wrappers: 30/30 root and 29/29 service, with zero skipped file wrappers. Their internal skipped namespace case is visible in the individual run; it is not hidden or counted as passed. Repeated focused runs are not added to the inventory.

TESTED: the C3/C4 namespace run has 43 cases: all 18 C3 cases pass; C4 has 24 passed and 1 skipped among 25. All **13 distinct new C4 SIGKILL scenarios** complete successfully, plus the three inherited C2 SIGKILL cases in the full suite. Eight direct C4 concurrency scenarios pass. The raw shell-launched namespace socket probe printed EPERM and exited 0; attribution to network namespace versus inherited syscall policy is not proven. Node spawnSync namespace launch is the explicit skip.

TESTED: root and service regressions include V3.4-A/B/C/C2/C3, historical V3.3-C3 reference results, V3.3-C4 research-schema tests and F/F2. No expected numerical results were edited. `npm run check` exited 0 with orders disabled; `git diff --check` passed. The absolute canary module URL portability correction was tested separately from both working directories (1/1 each), then the complete service file and individual suites passed. The root and focused runs previously exercised the same canary logic from repository root.

PARTIAL diagnostic history (superseded, not acceptance): initial C4 19/21 passed with 2 real orphan-temporary recovery failures; initial root 25/29 files passed, then 26/30 as code evolved; writable-directory and source-identity failures were retained in their logs. Secure-umask intermediate root/service runs each failed one file while the namespace test was unresolved. The exclusive-handle prototype passed 4/8 legacy persistence cases, then the shared-connection fix passed all 8. One namespace run had 42/43 passed and one unsupported-probe failure; another had 41 passed, 1 timeout cancellation and 1 skip. The pre-portability-fix service run had 28/29 files passed, and its already-loaded individual run had 346 passed, 1 canary path failure, 1 skip among 348. Fresh corrected final results are in the table above. Interrupted diagnostic runs are not assigned invented final counts.

BLOCKED / PENDING acceptance remains as described above and in the audit. Passing regressions do not remove the OS trust, authenticity, WAL, interior-verification, allocation/ENOSPC or dedicated laggard-child gates. Final source changes remain unstaged and uncommitted.
