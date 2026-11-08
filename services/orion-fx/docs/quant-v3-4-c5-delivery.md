# Orion Quant V3.4-C5 delivery — PARTIAL

Verified baseline: `eeca8f2a1b65c9bad4a8f2b07cb3c3b5121d25e5`, branch `feat/orion-quant-v3`. Changes are unstaged. No commit/push, broker contact, orders, real credential access, holdout use, dataset modification, privileged user/service creation or host configuration change was performed. Existing untracked `services/freqtrade/scripts/` is untouched.

## Exact modified-file inventory

Paths relative to `services/orion-fx/`:

| File | Change |
|---|---|
| `market-data/capital-history.js` | Pre-fsync/publication/cleanup fault boundaries; close retained parent even when cleanup fails |
| `market-data/forward-journal.js` | Named full-prefix traversal hooks; record-allocation injection boundary |
| `paper/appendable-operations.js` | Cursor synchronization independent of risk eligibility |
| `paper/ops-readiness.js` | Independent C5 gates and per-gate evidence/prerequisites |
| `paper/strategy-durable.js` | Opt-in storage mode; journal traversal and account-final-prefix barriers |
| `persistence/journal.js` | Opt-in verified WAL mode, FULL sync, soft checkpoint/size policy, shared-mode conflict rejection |

New files:

| File | Purpose |
|---|---|
| `deploy/orion-offline.service` | Opt-in, uninstalled systemd sandbox example |
| `security/linux-sandbox-probe.js` | Disposable unprivileged synthetic filesystem/network probe |
| `tests/fixtures/c5-worker.js` | Actual account subprocess with bounded IPC SIGKILL barriers |
| `tests/fixtures/c5-canary-worker.js` | IPC canary reader with independent nested child |
| `tests/quant-v3-4-c5.test.js` | Twenty C5 cases |
| `docs/quant-v3-4-c5-audit.md` | Threat model, baseline, evidence, prerequisites and limitations |
| `docs/quant-v3-4-c5-delivery.md` | Inventory and final validation record |

## Security and recovery outcome

T0/T1 application controls retain bounds, fail-closed validation and offline tripwires. T2 requires an operator-provisioned dedicated UID with private state and credential-free access. Ordinary owner permissions cannot isolate T3 same-UID processes: the negative control proves reads/replacement remain possible. T4 root compromise is outside the model.

The separately approved disposable bubblewrap run confirms actual OS filesystem denial for synthetic forbidden paths, outside symlink, parent/sibling and an independent child; allowed journal, state writes and SQLite work. Environment is cleared. Its network namespace denies TCP/TLS/HTTP/HTTPS/fetch and child TCP probes to a controlled host loopback listener. No external endpoint is probed. These are narrow disposable-boundary results; DNS/imported broker transports, actual dedicated identity and production systemd deployment remain unverified. Inside the tool sandbox the corresponding namespace launch returns EPERM and is explicitly UNKNOWN/skipped. Systemd verification itself is unverified due host SO_PASSRIGHTS/SO_PASSCRED EPERM diagnostics.

Same-UID SQLite replacement succeeds despite private permissions; the retained guard detects the observed replacement but cannot guarantee race prevention. Parent/file/companion checks are preflight and operation-boundary checks. Trusted writable-directory ownership and isolation remain prerequisites.

Seven new SIGKILL scenarios pass: two WAL transaction boundaries, four journal/account prefix boundaries and one dedicated laggard boundary. WAL recovery retains committed effects and rolls back uncommitted effects; concurrent reader snapshots remain stable, integrity_check passes, checkpoint/reopen works and repeated processing adds no duplicate financial effects. FULL synchronous is used; SIGKILL is not power-loss testing. Missing-SHM recovery with surviving WAL is still PENDING. WAL size settings are soft, not a hard growth cap.

Resource evidence: seven injected error scenarios cover shared publisher ENOSPC/EIO/EACCES/cleanup, journal ENOSPC/allocation and financial transaction ENOSPC; one real SQLite SQLITE_FULL allocation case uses a bounded page count. Actual kernel ENOSPC tests: zero. JSON-size/count bounds are exercised. Financial transaction failure preserves cursor and event rows; retry reconciles. Cleanup after publication deliberately produces an error with a visible artifact and retained temporary evidence; collision-safe retry rejects overwrite.

The laggard child consumes six, is left behind while three peers consume twelve, commits its seventh observation, is SIGKILLed and restarts at seven. It consumes the remaining five only. All four reach sequence 12 and commitment `2b9056b2f7bd9134ce6f1e16b7d15b90f5230a97d485c15355dba5312871b120`. Advanced account financial rows remain unchanged. Risk HALTED does not imply an invalid observation cursor.

## Financial evidence

| Strategy | Final cash USD8 | Final equity USD8 | Risk | Ledger hash |
|---|---:|---:|---|---|
| trend | 99970944000 | 99970944000 | HALTED | `35302bcba41a54524315c11afd37bf3d776589589d89c5404bf9a4c04b5b2d94` |
| mean-reversion | 100000000000 | 100000000000 | ACTIVE | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| breakout | 100000000000 | 100070824000 | HALTED | `1468c63cd61f60188cd545311b607885f772c5c4c1da88e82127ad2505e95554` |
| ma-cross | 99970944000 | 99970944000 | HALTED | `35302bcba41a54524315c11afd37bf3d776589589d89c5404bf9a4c04b5b2d94` |

Synthetic fixtures only, not forward performance. Breakout retains its open position/unrealized USD8 `70824000`. Replay verifies financial trace, signed ledger, position, risk and pending intention; tests assert cash plus unrealized equals equity. Account configurations remain stable through extension/recovery. Existing historical numerical tests are unchanged. Old semantic identities are not migrated or silently accepted under new execution code.

## Actual readiness

Twelve-observation synthetic fixture, all accounts at head:

```json
{
  "classification": "FORWARD_OBSERVATION_BLOCKED",
  "engineeringAssessment": "UNKNOWN",
  "tradingEnabled": false,
  "brokerExecution": "DISABLED",
  "failedGates": ["riskEligibility", "sourceAuthenticity", "executionPrice"],
  "unknownGates": ["sqlitePathnameIntegrity", "trustedRuntimeIdentity", "walCrashRecovery", "resourceExhaustion", "laggardRecovery", "modelExecutionAssumptions", "offlinePersistenceSecurity", "completedCandleSourceVerification", "receiptJournalBinding", "credentialIsolation", "networkIsolation"],
  "passingGates": ["prefixVerification", "journalIntegrity", "accountIdentity", "cursorLedgerAtomicity", "financialReconciliation", "cursorSynchronization", "freshness", "brokerOrderProhibition"]
}
```

Full local output with gateEvidence and account commitments: `/tmp/orion-c5-readiness.json`. Passing engineering tests do not attest a deployed runtime. Production gates remain UNKNOWN where prerequisites are missing; missing/invalid evidence retains the prior UNKNOWN overall result.

## Validation

Commands use Node v26.13.0, `umask 077`, `TRADING_ENABLED=false`; full suites use `NODE_OPTIONS="--max-old-space-size=128 --import=/home/look/Downloads/orion-trading-engine/services/orion-fx/tests/fixtures/offline-network-guard.js"`. This preload denies external fetch for tests; it is not OS isolation. No env-file was loaded. Logs are local temporary evidence, not archived market data.

Final completed counts are appended below. File wrappers and individual cases are different units; repeat runs are not additional unique tests.

Diagnostic history: first focused run had 13 passed, 3 failed, 2 skipped because new snapshot comparisons included the expected STRATEGY_RECOVERED sequence increment. Correct economic comparisons exclude only audit sequence, while exact financial rows are still compared. A subsequent inline canary subprocess exited without its evidence token; accepting exit status alone would be unsound. The final canary uses actual IPC fixture messages and a nested child. Initial completed root/service runs had 30/31 and 29/30 file wrappers pass; the initial individual run had 364 pass, 1 canary failure, 3 skips among 368. These failures did not justify changing financial production logic or weakening old tests. Corrected focused run: 18 pass, zero fail, 2 skip among 20, duration 17842.920163 ms (`/tmp/orion-c5-focused-pass.log`). Fresh full regressions run against that corrected fixture.

## Remaining blockers and next checkpoint

PARTIAL / PENDING: provision and validate the dedicated nonlogin UID and production mount/ACL/environment/descriptor boundary; validate systemd unit on target; prove missing-SHM recovery with surviving WAL; add hard WAL/resource quotas and exhaustive syscall/ACL/full-disk failures without consuming real disk. T3 pathname races require maintained isolation, not more optimistic inode labels. Native hostile same-UID and root attacks are outside the supported guarantee.

BLOCKED: authenticated forward source, independent completed-candle timing and executable-price assumptions. No acquisition or order authorization is implied.

Recommended next safe checkpoint: operator-authorized transient deployment validation of the dedicated identity and minimal credential-free root, followed by the remaining bounded recovery/resource cases. Only after evidence review should separately authorized read-only market-data acquisition be considered. Keep broker execution disabled.

## Completed final runs

| Command | Unit | Passed | Failed | Skipped | Duration ms | Local log |
|---|---|---:|---:|---:|---:|---|
| `npm test` | 31 file wrappers | 31 | 0 | 0 | 326238.798509 | `/tmp/orion-c5-root-final.log` |
| `npm test --prefix services/orion-fx` | 30 file wrappers | 30 | 0 | 0 | 319888.567944 | `/tmp/orion-c5-service-final.log` |
| Focused C5, isolation disabled | 20 individual cases | 18 | 0 | 2 | 17842.920163 | `/tmp/orion-c5-focused-pass.log` |
| Foundation, isolation disabled | 9 individual cases | 9 | 0 | 0 | 244.011125 | `/tmp/orion-c5-foundation.log` |
| `npm run check` | check | PASS | 0 | 0 | — | `/tmp/orion-c5-check-final.log` |

TESTED: root and service runs completed normally, exit 0. File wrappers do not expose individual skipped cases in their top-level summary. The individual-case run supplies that count below. Final syntax checks for probe and IPC fixture and `git diff --check` pass.

TESTED OS cases: one disposable mount-boundary procedure containing allowed journal/SQLite/state operations and four main-process forbidden-path checks, a child forbidden-file check and sensitive-environment absence; one network procedure containing five main transports plus child TCP against a controlled host loopback listener. Both succeed outside the tool sandbox. They are not additional Node test cases. The dedicated-UID deployment case and inner namespace case remain skipped/UNKNOWN. C4 contributes its existing inner-namespace skip in the full individual inventory.

TESTED C5 fault/crash inventory: 7 distinct SIGKILL cases, 7 simulated resource faults, 1 actual SQLite allocation-full case, 0 kernel ENOSPC/resource-fault cases. C4's 13 existing distinct SIGKILL scenarios and C2's three actual SIGKILL scenarios remain covered by the full suite; repeated suite executions are not counted as new scenarios.

TESTED final individual run: `npm run test:cases --prefix services/orion-fx` exited 0, **368 cases across 30 files: 365 passed, 0 failed, 0 cancelled, 3 skipped**, duration **472886.488826 ms**, log `/tmp/orion-c5-cases-final.log`. Adding the separately completed 9/9 foundation cases yields **377 cases across 31 files: 374 passed, 0 failed, 3 skipped**. The three skips are C4 inner namespace, C5 unprovisioned dedicated-UID filesystem isolation and C5 inner namespace. The separately successful disposable bubblewrap probes do not turn these into passed deployment tests.

TESTED final inventory: six tracked files modified, seven new files, all within `services/orion-fx/`; exact paths above. Final `git diff --check` passes. Baseline HEAD is unchanged and the pre-existing untracked freqtrade directory remains untouched. C5 acceptance is **PARTIAL**, not COMPLETE; production classification remains **FORWARD_OBSERVATION_BLOCKED** for valid local evidence.
