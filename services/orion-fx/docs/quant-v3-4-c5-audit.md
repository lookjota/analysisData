# Orion Quant V3.4-C5 audit — PARTIAL

C5 is PARTIAL. Disposable filesystem confinement is tested, but an operator-provisioned dedicated service identity and its production credential boundary are unverified. This checkpoint does not authorize acquisition. Trading remains disabled and forward observation remains blocked.

## Baseline, inspected before changes

| Finding | Evidence | Status |
|---|---|---|
| HEAD / branch | `eeca8f2a1b65c9bad4a8f2b07cb3c3b5121d25e5`, `feat/orion-quant-v3` | TESTED |
| Initial status | Only untracked `services/freqtrade/scripts/`; untouched | TESTED |
| Runtime | Node v26.13.0, Linux 7.2.14-arch1-1 x86_64; UID/GID 1001, supplementary GID 65534 | TESTED |
| Filesystem | `/tmp` reports tmpfs; private synthetic directories created with mode 0700; SQLite files mode 0600, runtime owner | TESTED |
| SQLite | Built-in `node:sqlite` (SQLite 3.54.0), `DatabaseSync(path)`; retained parent descriptor before pathname open; post-open checks | TESTED |
| Original durability | DELETE journal, synchronous FULL, busy timeout 1000 ms | TESTED |
| Connections | Reference-counted one connection per path; independent child processes have separate connections | TESTED |
| Storage | Caller-supplied private directory for journal JSON, account SQLite and publication-lock SQLite | TESTED |
| Publication | Exclusive UUID temporary file, file sync, hard-link publication, directory sync, temporary unlink | TESTED |
| Crash boundaries | C4 before-create, temporary-synced, published, account before/after commit, verification entry | TESTED |
| Readiness | Local evidence only; credential/network/persistence gates UNKNOWN, forward blocked | TESTED |

Priority files inspected: security sqlite-path/path-policy/offline-guard; persistence journal; strategy-durable, appendable-operations/commitments, semantic-identity, ops-readiness; forward-journal, acquisition-receipt, capital-history; forward-offline; C4 tests, worker, audit and delivery. No env-file or real credential was loaded. No historical dataset, protected holdout, freqtrade source, host firewall, user, service or SSH configuration was modified.

## Original C4 blockers and C5 disposition

| Gate | C5 disposition | Evidence / remaining prerequisite |
|---|---|---|
| Dedicated runtime UID | IMPLEMENTED design; PENDING deployment | Opt-in unit, no identity created |
| OS credential confinement | TESTED disposable mount boundary; PARTIAL deployment | Synthetic main/child canaries; real service identity/ACL/mount audit missing |
| Hostile same-UID pathname changes | TESTED possible; BLOCKED as a universal guarantee | Replacement succeeds in private directory; subsequent guard detects observed change |
| WAL termination recovery | TESTED opt-in WAL | Actual SIGKILL before/after transaction commit; current default remains DELETE |
| Interior prefix interruption | TESTED | Four new SIGKILL boundaries, corruption detected on fresh restart |
| Resource failures | TESTED selected deterministic faults; PARTIAL exhaustive matrix | Six publication/journal injections, financial transaction ENOSPC injection, actual bounded SQLITE_FULL |
| Laggard subprocess | TESTED | Four accounts, six then twelve observations; laggard killed after seventh commit |
| Network isolation | TESTED disposable bubblewrap loopback probes; PARTIAL deployment | Namespace test inside tool environment skipped EPERM; DNS/broker transports not OS-tested |
| Forward provenance / finalization / executable quotes | BLOCKED | Engineering fixtures cannot supply authenticated market evidence |

## Threat model

| Level | Capability | Mitigation and limits |
|---|---|---|
| T0 | Accidental application misuse | Argument, schema, bounds, path, commitment and atomic transaction checks; offline guards |
| T1 | Malicious input, no filesystem access | Bounded inputs and fail-closed validation mitigate tested malformed inputs; not a universal allocation proof |
| T2 | Separate unprivileged UID | Dedicated owner, 0700 state, 0600 files, no supplementary groups/ACL grants; read-only root-owned code; sandbox mount/network restrictions. Deployment must verify these prerequisites |
| T3 | Hostile process under Orion's UID | Ordinary permissions do not separate it. Can replace files and read owned 0600 credentials. A separately established mount boundary hides tested paths, but ptrace/proc/inherited-descriptor/native-code threats require further deployment controls. No general T3 guarantee |
| T4 | Administrator / compromised root | Unsupported threat; no root-compromise defense claimed |

Target: an otherwise unused, nonlogin, unprivileged Orion UID/GID, isolated writable state, no credential-readable groups, no real broker credential files accessible in its namespace. Do not run under the developer's UID and call it isolated. The disposable bubblewrap test maps the invoking user into a namespace; it is not evidence of a separately provisioned host service UID.

## Dedicated service sandbox contract

IMPLEMENTED sample: `deploy/orion-offline.service`. Operator review and authorization are required before provisioning or installation. There is no Install section and no service was installed, started or enabled.

Deploy only reviewed runtime `.js` modules and package metadata to `/opt/orion-offline`, owned by an administrator and not writable by the runtime. Do not copy the whole repository: exclude env-files, secrets, evidence, datasets, holdouts, `.git`, research data and personal files. Necessary module directories must be explicitly allowlisted. `/opt` and all code ancestors must be trusted. Keep the user's checkout where it is; executing `~/Downloads/...` is incompatible with ProtectHome and is not the deployment design.

Require private `/var/lib/orion-offline` and `/run/orion-offline`, UMask 0077, clean environment, no preloads or sensitive inherited descriptors, explicit trusted Node executable, controlled working directory, empty capabilities, NoNewPrivileges, RestrictSUIDSGID, PrivateTmp, ProtectSystem=strict, ProtectHome, AF_UNIX only, PrivateNetwork and IPAddressDeny. Sample executable paths must be verified on the target distribution. No runtime package installation or download is allowed.

ProtectHome hides home/SSH material. It does not hide arbitrary credentials in `/etc`, `/opt` or other mounts. The operator must inventory credential locations without exposing their values and add reviewed InaccessiblePaths or use a minimal credential-free RootDirectory/RootImage. Deny ACLs/group grants and inherited file descriptors; verify `/proc` access, ptrace policy and trust of all processes under the service UID. Do not assert credential isolation until actual deployment canaries and identity evidence pass. The sample alone is not a complete credential-free root image.

Safe unprivileged procedure:

1. From a clean shell run `env -i PATH=/usr/bin:/bin TRADING_ENABLED=false /usr/bin/node /absolute/reviewed/orion-fx/security/linux-sandbox-probe.js`. This creates only bounded synthetic temporary directories and removes only its own temporary tree. It needs working unprivileged bubblewrap namespaces. A failure emits UNKNOWN; do not fall back to unconfined execution.
2. Verify a dedicated identity separately with operator-supplied identity evidence, group list, code/state ownership, ACL/mount review, canary denies and environment checks. Do not substitute the developer UID. Initialize only synthetic journals for acceptance. Use the existing offline CLI, never `.env`/demo scripts.
3. Review the opt-in unit with `systemd-analyze verify` on the target. Here verification returned 1 with SO_PASSRIGHTS/SO_PASSCRED EPERM diagnostics, so unit deployability is unverified. No start/enable was attempted.
4. Test an operator-authorized transient sandbox before any persistent installation; retain sanitized identity, mount, environment, filesystem and network evidence. Services must fail closed if their sandbox features are unavailable.

Rollback/removal is operator-only: stop any separately authorized service, remove its unit and reload the service manager; preserve/export synthetic or paper state before removing anything. Remove a dedicated account or deployment tree only after confirming it has no other ownership/use. Do not remove the developer checkout or modify its permissions. This checkpoint performs none of those actions.

Unsupported/unverified: non-Linux, absent `/proc/self/fd`, missing node:sqlite, unavailable user/mount/network namespaces, missing bubblewrap, systemd not present or directives unsupported, ACL/NFS/FUSE/remote filesystem semantics not tested, preloaded or compromised runtime, compromised administrator. No silent downgrade is allowed.

## Actual OS filesystem and network evidence

TESTED: `security/linux-sandbox-probe.js` uses only synthetic controlled temporary files. Bubblewrap binds `/usr` read-only, provides fresh proc/dev/tmp, binds only private state writable, clears environment, unshares namespaces and executes Node. Main Node reads the allowed journal, writes state and opens its SQLite database. It receives OS ENOENT/EACCES/EPERM for a forbidden canary, forbidden parent, outside symlink and protected sibling. An independent child also cannot read the canary; a synthetic sensitive environment variable is absent. These checks use native fs calls, not the application's JavaScript guard. Result outside the tool sandbox: `OS_FILESYSTEM_DENIAL_CONFIRMED synthetic mount boundary; main and child`.

TESTED negative control: the C5 IPC child and its nested child can read private canaries and an outside symlink under the same host UID without a mount boundary. Classification: `OS_FILESYSTEM_ISOLATION_FAILED` for chmod-only same-UID design. Dedicated deployed runtime classification: `OS_FILESYSTEM_ISOLATION_UNKNOWN`. C4 API guard cases remain `APPLICATION_GUARD_PASS` only.

Inside the tool sandbox bubblewrap/Node namespace spawning reports EPERM; recorded as UNKNOWN. A separately approved disposable execution outside that sandbox succeeds. No privileged account or persistent configuration is created. Loopback-only TCP, TLS, HTTP, HTTPS, fetch and a child TCP attempt return denied/unreachable/refused under bubblewrap. The final probe uses a controlled listening socket in the host loopback namespace and requires explicit child evidence. This is a narrow loopback probe with no external contacts; DNS and imported broker transports are not independently OS-probed. It does not validate the sample systemd unit or every possible deployment. Production networkIsolation remains UNKNOWN.

## SQLite pathname identity

IMPLEMENTED inherited checks: trusted/private parent mode and current owner; symlink-free traversal via retained directory descriptor; exclusive initial creation; file ownership/mode/type/link count; device/inode checks at open and operation boundaries; companion type/link/owner/mode checks; missing financial reopen rejected; shared connection lifetime avoids opening/closing a second lock-dropping descriptor. WAL/SHM follow the same companion checks.

TESTED C4: hardlinks, replacement, unsafe directories, unrelated DB, missing reopen, shared handle lifetimes. TESTED C5: same UID renames a verified database and installs a hostile replacement successfully, then guard.verify rejects the observed identity change. A retained directory descriptor does not stop pathname replacement or SQLite canonicalization. Parent inode comparison is detection at a point in time, not a syscall-level guarantee. Directory rename, companion swaps, reopen disappearance and checks between operations remain races against a writer with the same UID. Post-open checks do not undo arbitrary SQLite activity that occurred during an adversarial window. Ancestor ACLs/mount ownership are not authenticated. Trusted directory ownership and OS identity isolation are mandatory operational prerequisites. No risk-closed claim follows from an inode comparison.

## WAL recovery and financial verification

IMPLEMENTED opt-in `journalMode: 'WAL'` for openJournal/openStrategyReplay; DELETE remains default. Same-process conflicting mode leases reject. FULL synchronous, busy_timeout 1000, wal_autocheckpoint 100 pages and journal_size_limit 1 MiB are configured. The checkpoint threshold and size limit are soft housekeeping settings, not hard WAL quotas: a reader can retain WAL growth. Strict quota/reader-lifetime enforcement is PENDING. No old ledger is automatically migrated.

TESTED: two real SIGKILL writer deaths before/after COMMIT. A concurrent reader retains its prior snapshot while the writer dies; a WAL exists at restart. Fresh process/account reconstruction preserves uncommitted cursor 0 or committed cursor 1 as appropriate, runs to 6, then repeats with unchanged financial event body/digest rows, pending intent and economic snapshot. Integrity_check returns ok. WAL and SHM are observed during child transaction; SQLite manages companions normally. No WAL/SHM is manually edited or deleted. A TRUNCATE checkpoint followed by reopen preserves state. SHM creation is exercised by connection lifetimes, but deliberate missing-SHM recovery with retained WAL is not separately proven and remains PENDING.

Trend six-observation result: cash/equity USD8 `99970944000`, realized `-29056000`, unrealized/exposure/margin zero; HALTED preserved. Financial rows exclude only STRATEGY_RECOVERED audit events when comparing idempotent financial effects. Snapshot.sequence includes those audit events and legitimately increases on reopen; economic comparisons exclude that field only. Reconciliation still verifies full trace, ledger, position, pending intent, account configuration and cursor before READY. FULL protects the SQLite commit protocol subject to filesystem/storage guarantees; SIGKILL does not emulate power failure or prove hardware flush durability.

## Prefix interruption

IMPLEMENTED named uncached journal traversal hooks: prefix-before-start, prefix-record-verified (sequence metadata), prefix-before-final, prefix-complete. Strategy opening passes its fault injector through the actual full journal verification. Account checkpoint replay also exposes account-prefix-before-final and account-prefix-complete. No partial success flag is persisted.

TESTED four SIGKILL scenarios: before traversal, after the first verified interior prefix, before final journal record, before final account checkpoint verification. Account already consumed six observations; kills leave financial event rows unchanged. Restart verifies all six and preserves cursor 6. Corrupting the final synthetic commitment after each restart makes a fresh open reject JOURNAL_CORRUPTION before processing, without modifying account financial rows. No repair or successful verification is cached for another head. Full journal inspection precedes account creation/processing, and source rows must match the verified journal.

## Resource faults

| Failure | Method | Result / limitation |
|---|---|---|
| Receipt temporary creation ENOSPC | Injected before-create callback in shared publisher | No acknowledgment/target; retry publishes once |
| Journal append ENOSPC | Injected before-create | Head unchanged; retry reaches next sequence |
| SQLite financial transaction ENOSPC | Injected before-commit, after planned inserts | Rollback; cursor/effects unchanged, retry reconciles |
| Publication EIO | Injected before hard-link | No target/acknowledgment; retry succeeds |
| fsync EACCES | Injected immediately before file sync | No target/acknowledgment; retry succeeds |
| Record allocation ENOMEM | Injected before record construction | No new head; retry succeeds; not heap exhaustion |
| JSON and excessive count | Real canonical bound / 101-observation batch rejection | Rejected, head unchanged |
| Cleanup EIO | Injected before temporary unlink after publication | Target remains and temp evidence retained; no success return, retry EEXIST; ambiguity is explicit |
| SQLite allocation full | Real SQLite max_page_count=8, 128 KiB zeroblob | SQLITE_FULL, no committed row, integrity ok, smaller retry works |
| Kernel ENOSPC/quota | Not induced | PENDING; no disk filling or privileged mount performed |
| WAL growth ceiling | Soft autocheckpoint/size policy only | PARTIAL; no hard quota guarantee |

There are seven simulated fault scenarios (four shared publication, two journal, one financial SQLite transaction) and one actual SQLite-engine allocation failure. Actual OS ENOSPC/resource-fault count is zero. These are selected boundaries, not exhaustive syscall-interposition/ACL/cleanup coverage. A batch can have a committed prefix before a later error; callers must inspect/retry idempotently. No whole-batch atomicity is claimed. Cleanup-after-publication errors are not false success; consumers must inspect verified artifacts rather than infer absence from an error.

## Dedicated lagging account

TESTED actual IPC child: initialize four accounts, consume six observations each, append to twelve, advance trend/mean-reversion/breakout to twelve, leave ma-cross at six, SIGKILL laggard immediately after its seventh commit. Fresh laggard starts at seven and consumes only eight through twelve. All four finish at sequence 12 with equal journal commitments and unchanged configuration hashes. Advanced financial rows are compared unchanged. Retry creates no duplicate financial events and preserves economic state, pending intent and risk latches. USD8 equity equals cash plus unrealized PnL; durable replay reconciles signed ledger, positions and full financial trace.

Synchronization now uses verified cursor sequence/commitment independently of ACTIVE/HALTED/PAUSED risk. A synchronized HALTED account remains blocked for trading. No risk reset was introduced.

## Readiness and compatibility

IMPLEMENTED independent C5 gates: sqlitePathnameIntegrity, trustedRuntimeIdentity, walCrashRecovery, prefixVerification, resourceExhaustion, laggardRecovery and modelExecutionAssumptions, plus retained journalIntegrity, cursorLedgerAtomicity, financialReconciliation, accountIdentity, credentialIsolation, networkIsolation, sourceAuthenticity, completedCandleSourceVerification, receiptJournalBinding, executionPrice, riskEligibility, cursorSynchronization, freshness and brokerOrderProhibition. Every gate has gateEvidence or an explicit missing prerequisite. Allowed gate values remain PASS/FAIL/UNKNOWN (NOT_APPLICABLE is permitted by contract but unused).

Functional test evidence is recorded here; readiness does not infer production WAL/laggard/OS deployment evidence from the presence of tests. Those gates stay UNKNOWN until runtime-specific evidence exists. prefixVerification PASS means a full current local traversal only. Receipt hash integrity is not authenticity; sourceAuthenticity remains FAIL; completed candle provenance and executable price are unproven. Valid fixtures remain FORWARD_OBSERVATION_BLOCKED. Missing evidence retains the existing UNKNOWN classification, never a forward-ready result.

Financial configuration unchanged: EUR/USD H1, USD1000 per strategy, risk .005, daily loss .01, leverage 1:1, one position, four existing strategies, exact USD8, no orders/optimization. No historical schema or dataset is migrated. Semantic identity deliberately hashes execution dependencies; new code requires a new appendable run under the existing fail-closed policy. Old ledgers are preserved and are not silently rebound to changed code. C3/C4 schema and historical numerical regression oracles are retained.

See delivery for completed regression counts, exact changed-file inventory, logs, actual readiness and remaining acceptance blockers.
