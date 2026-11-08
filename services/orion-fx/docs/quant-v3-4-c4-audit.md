# Orion Quant V3.4-C4 audit — PARTIAL

PARTIAL: this checkpoint improves offline reliability but does not establish hostile same-user filesystem safety or OS credential isolation. It does not authorize acquisition. Forward observation remains blocked.

## Baseline and scope

TESTED: baseline `df7c2993c6a90ac7a147266ae61c749933bbd7ce`, branch `feat/orion-quant-v3`. Initial status: only untracked `services/freqtrade/scripts/`, left untouched. No staging, commits, pushes, real credentials, protected holdout content, immutable dataset edits, broker traffic or orders. All new data are synthetic. Tests use `TRADING_ENABLED=false`; historical adapter fixtures inject in-memory transports, including fake session responses, without contacting a broker.

## Actual implementation and original C3 residuals

IMPLEMENTED (inherited): the durable F2 ledger is `persistence/journal.js`, opened by `paper/strategy-durable.js` and the earlier durable/replay APIs. Runtime SQLite connection sites are that ledger and `market-data/capital-history.js` publication lock. No alternate SQLite VFS or descriptor-open API exists in these callers. The installed Node `DatabaseSync` opens pathnames. Test-only raw connections deliberately inject corruption/locks.

IMPLEMENTED (inherited): financial events, persistent risk transitions, pending intent and consumed cursor are rows in one `BEGIN IMMEDIATE` transaction per candle. Projection and reference trace validation precede inserts; commit precedes returning candidate state. Write failure rolls back. Primary/unique keys and reference reconstruction reject duplicate effects, missing checkpoints, fabricated cursors, wrong identities and malformed event schemas. Four strategy databases commit independently. Their recovery audit rows may change on status; financial effects must not change.

PARTIAL (C3): the financial database creation descriptor closed before the SQLite pathname reopen; no post-open inode check existed. Parent replacement, same-user replacement, arbitrary credential reads, subprocess transports, publication-interior kills, concurrent publishers and reports were incompletely covered. Shared JSON I/O already traversed directories with `O_DIRECTORY|O_NOFOLLOW` and retained `/proc/self/fd` parent anchors. Publication used exclusive UUID temporary creation, file sync, hardlink without replacement, then directory sync. The original journal enumerator counted orphan temporary names as observations.

IMPLEMENTED (inherited): lexical protected-name/traversal rejection in `security/path-policy.js`; finite batch/candle/step limits; canonical JSON depth 30 / 262144-byte event bound; stored JSON descriptor size bound 128 MiB. Journal reads validate every committed sequence, predecessor, digest, evidence and candle. Receipts prove local consistency only, not authenticated Capital.com evidence. `FORWARD_OBSERVED` is rejected.

## SQLite pathname assessment

IMPLEMENTED: `security/sqlite-path.js` walks parent directories through retained Linux descriptors, rejecting symlink components. Ancestors may not be group/other writable except sticky directories. The final directory must be owned by the process UID and must not be group/other writable. Newly created runtime directories remain 0700. Existing owner-controlled 0755 directories remain compatible; use 0700 operationally. Existing writable runtime directories fail closed and require operator review of permissions, without changing account contents.

IMPLEMENTED: exclusive initial creation, `O_NOFOLLOW|O_NONBLOCK` reopening, descriptor `fstat` regular-file/UID/link-count/0600 checks, no automatic chmod, inode/device checks of both anchored and public paths and parent directory before/after opening and before reads/transactions/commit. Companion `-journal`, `-wal`, `-shm` paths are checked for regular type, single link, owner and restrictive mode. The directory descriptor survives until SQLite closes. Preflight database descriptors close BEFORE SQLite takes POSIX record locks; no second raw database descriptor is opened/closed during transactions. Both ledger and publication lock use this helper. A process-local path/inode registry rejects overlapping helper opens before opening a second descriptor for an active SQLite inode; it is a descriptor-lifetime guard, not an interprocess lock. Ledger clients retain backward-compatible overlapping handles by leasing one shared SQLite connection per pathname, released after the last handle closes. This avoids descriptor preflight on an already locked inode. Direct native/raw SQLite opens outside the helper are outside that registry. No PID lock or stale-lock deletion was introduced.

IMPLEMENTED: strategy reopening requires an existing file. A missing account does not silently create a replacement financial database. A version-zero database with unrelated tables is rejected before schema or journal-mode initialization; versions other than 0/1 reject. Fixed-dataset configuration/schema and USD8 precision are unchanged. Appendable semantic identity intentionally changes because execution source changed; existing appendable runs fail identity checks rather than migrating. No account is rewritten to accept the new identity.

PARTIAL: these checks are observations, not atomic validation-plus-SQLite-open. SQLite can canonicalize `/proc/self/fd` paths and opens companions internally. Another same-UID process can replace and restore paths between checks, alter contents in place, or exploit unchecked ACLs/mount behavior. An inode comparison cannot prove which file SQLite opened in every adversarial schedule. Sticky ancestors permit deployment under `/tmp` but do not authenticate arbitrary ancestor owners. Directory-owner trust, ACLs, ancestors and mount administration remain operator responsibilities. A new file created by SQLite during a hostile race might exist before post-open rejection. No unsupported SQLite descriptor API is claimed.

BLOCKED: a hostile same-user deployment requires a separate service identity and inaccessible credentials/runtime paths, or a reviewed native anchored SQLite VFS/openat2 architecture plus suitable OS sandbox. Without that boundary this checkpoint is not accepted as adversarial-path secure. WAL is not the engine's configured mode: production remains DELETE with synchronous FULL. WAL-mode crash recovery has not been demonstrated and is PENDING; changing existing account modes solely for a test was avoided.

## Deterministic process-crash evidence

IMPLEMENTED: optional publication checkpoints (`before-create`, `temporary-synced`, `published`) in the actual shared JSON publisher; receipt and observation publication pass these through. Normal callers have no hook. Existing account before/after commit hooks remain; a recovery-verification entry hook was added. Child workers announce readiness, await parent `go`, signal a named boundary and block with a bounded 20-second fallback. The parent sends actual SIGKILL and verifies the exit signal. There is no timing-only kill scheduling.

IMPLEMENTED: journal enumeration excludes only exact UUID temporary names produced by the publisher. It neither promotes nor removes them. Malformed committed names still reject. This fixes the demonstrated SIGKILL restart gap error. Committed-prefix validation still runs on every reopen. Orphans should be retained for operator examination; never delete active worker temporary files.

The focused C4 suite contains 13 actual SIGKILL cases: nine publication cases, three account cases and one reader/lock-owner case. The matrix below distinguishes shared-path evidence from untested orchestration details. Genesis always exists. `N` denotes already verified account state; account kill fixtures start with cursor 0 and two declaration events. Receipt/journal-only fixtures have no financial database.

| Boundary | Status and termination | Durable artifacts / committed database | Verified journal / account cursor / events | Retry / operator action |
|---|---|---|---|---|
| A receipt before create | TESTED SIGKILL | genesis; no receipt/temp; no account | journal 0; account absent; 0 financial effects | safe new publication; no repair |
| B receipt temporary synced | TESTED SIGKILL | private synced temp, no receipt | journal 0; account absent | safe publication; retain orphan |
| C receipt published before ack | TESTED SIGKILL | receipt + temporary hardlink | journal 0; locally valid receipt | exclusive collision; verify identical bytes before accepting retry; retain orphan |
| D journal append preparation | TESTED SIGKILL at before-create and temporary-synced | publication lock DB, possible rollback journal/temp; no committed observation | journal 0; no account | SQLite releases lock on death; retry produces sequence 1 |
| E append durable before paper | TESTED journal published SIGKILL; inherited C2 after-journal-append | observation 1 + temp; paper not started in C4 fixture | verified journal 1; no account in C4 fixture | identical append is idempotent; no automatic repair |
| F account before commit | TESTED SIGKILL after inserts | SQLite may leave rollback journal; inserted effects/cursor roll back | journal 6; cursor 0; declaration rows only | restart verifies prefix; retry reconciles |
| G one account committed | TESTED direct trend worker after-commit SIGKILL | trend commit retained; other accounts stay at 0 | journal 6; trend cursor 1; 4 total nonrecovery events, including one mark and one checkpoint | safe bounded catch-up; no risk reset |
| H cursor commit before ack | PARTIAL same after-commit child boundary | same atomic commit as G | cursor 1 and effects inseparable | tested engine acknowledgment loss; not a separate kill inside CLI output |
| I recovery / prefix verification | PARTIAL SIGKILL at verifier entry | committed prefix unchanged; recovery transaction rolls back | journal 6; cursor 0 in C4 fixture | safe restart; interior journal-prefix loop kill remains PENDING |
| J report publication | TESTED all three publication barriers, actual account report | absent report / synced temp / published report + temp; DB unchanged | journal 6; cursor 6; 17 nonrecovery event rows, 6 checkpoints; 9 financial effect rows | published report needs collision verification; never overwrite; retain orphan |

TESTED: account retries compare stored event bodies/digests excluding recovery audits, exact equity, cursor, and repeated-run state. Before-commit and recovery-entry interruption retain the previous prefix; after-commit retains exactly one candle. Named reader test observes journal sequence 0 while the prepared writer holds the lock, kills the owner and retries to sequence 1.

PARTIAL: SIGKILL is process interruption, not sudden power loss. JSON publication syncs file data and containing directory before its published barrier; temporary unlink cleanup is not separately directory-synced. SQLite uses FULL + DELETE; directory creation, storage cache/controller behavior and power-failure recovery have no corresponding physical fault test. No power-failure durability guarantee is made. A publication whose link succeeds but directory sync errors can be visible despite a reported error; inspect and validate the existing artifact on retry, never overwrite or silently repair it.

## Concurrency and financial evidence

TESTED: independent children synchronize start via IPC for same-observation append, overlapping extensions, same-account workers, distinct trend/breakout workers, receipt publisher collision and journal reader/writer. A zero-wait publication conflict is an explicit failed attempt requiring retry; tests do not require both initial submissions to succeed. Account writers use SQLite busy_timeout 1000 ms and transactional revalidation. Publication locks have busy_timeout 0 and process death releases the SQLite lock. No lock is removed or PID reused for ownership decisions.

TESTED: conflicting appenders preserve both observations, quarantine a revision and explicitly block paper processing with `QUARANTINED_REVISION_BLOCKS_PROCESSING`; v1 retains its audited quarantine contract rather than replacing a committed observation. Retry after another process finishes is idempotent. Inherited C2 tests cover lagging accounts converging without modifying ahead accounts, PAUSED/HALTED latches, existing positions, pending intents, altered cursor/effect/identity detection and exact accounting.

PARTIAL: eight direct C4 child-process concurrency scenarios are exercised. Laggard convergence is inherited C2 direct-API evidence, while restart status is independently checked by a C2 child. A dedicated concurrent laggard-child schedule remains PENDING. Low-level SQLite busy errors remain explicit; the CLI can sanitize them to a generic blocked-integrity error, so a stable typed retry classification remains PENDING.

TESTED reference fixture: initial cash per account `100000000000` USD8. After 12 synthetic candles the unchanged expected equities are trend `99970944000`, mean-reversion `100000000000`, breakout `100070824000`, ma-cross `99970944000`. All four reconcile; these are fixture outcomes, not profitability claims. The focused six-candle trend recovery reaches cash/equity `99970944000`, unrealized PnL `0`, realized PnL `-29056000`, zero exposure/margin. Its final consumed commitment is `33464c39638c66b69985a5bd85f1be41dad88eba4b66c300a10e549e8decd938`; 12-candle head is `2b9056b2f7bd9134ce6f1e16b7d15b90f5230a97d485c15355dba5312871b120`. C2 verifies cash = initial cash + signed USD8 ledger, equity = cash + unrealized PnL, retained prefix bytes, pending state and identity after restart.

IMPLEMENTED (preserved): EUR/USD H1; four independent USD1000 accounts; risk fraction .005; daily loss .01; existing maximum exposure; leverage 1:1; one position; orders disabled. No strategy signal, sizing, precision, financial formula or administrative reset was changed. Historical next-open fills remain simulated, including assumed adverse slippage. Synchronization does not override risk eligibility.

## Credential and network execution graph

IMPLEMENTED: `cli/forward-offline.js` installs network tripwires, strips environment to PATH/LANG/LC_ALL/TZ/TERM, forces TRADING_ENABLED=false, installs filesystem and child-process tripwires, then dynamically imports `cli/forward.js`. That imports receipt verification and thus broker/config modules; their presence does not authenticate or invoke an adapter. Legacy `cli/index.js`, receipt collector and programmatic APIs remain separate capabilities and do not acquire these guards automatically.

IMPLEMENTED / TESTED: synthetic `.env.canary` only; fs readFile/readFileSync/open/openSync, promises readFile/open, process.loadEnvFile and child spawn deny before content access. File guards also cover createReadStream, URL/Buffer paths and raw descriptor arguments to wrapped read/open APIs. Builtin ESM exports synchronize. Child spawn/exec/execFile/fork sync and async are denied; inherited fake sensitive environment is removed. No real secret was read or logged.

PARTIAL: JavaScript monkey-patches are defense in depth. Previously captured references, native addons, direct bindings/syscalls, internal module loading, alternative filesystem APIs, descriptors opened earlier, renamed/hardlinked secrets and startup NODE_OPTIONS/--env-file preloads are outside this boundary. Stripping process.env is not reliable memory erasure or OS environment isolation. Do not invoke the CLI with dotenv/preload credentials. A hostile module in the same UID session cannot be safely confined by this guard.

TESTED: C3 retains independent fetch, HTTP, HTTPS, TCP, Socket.connect and TLS rejection probes. C4 adds a raw-socket namespace probe. In this environment Node spawnSync of unshare reports EPERM (with status 0 and empty stdout), so that individual test is explicitly skipped rather than claiming isolation. A separate shell-launched `unshare --user --map-root-user --net node` raw socket attempt to TEST-NET 192.0.2.1 printed EPERM and exited 0. This proves OS denial for that probe; it does not attribute the denial exclusively to the network namespace rather than an inherited seccomp policy. No external host is contacted. The namespace supplies the OS transport boundary for that probe, not filesystem isolation or an assertion about an arbitrary invoking shell.

PARTIAL: an initial bubblewrap probe inside the tool sandbox failed creating NETLINK_ROUTE. An explicitly approved out-of-tool-sandbox probe reached exec but failed because the minimal `/usr` binding did not supply `/usr/bin/true` in this host layout. No filesystem sandbox execution is established by either result. No OS configuration was changed. Namespace availability depends on unprivileged user namespaces, seccomp/capabilities and host policy; do not silently fall back if it fails.

## Explicit opt-in offline execution recipe

IMPLEMENTED recipe / PARTIAL deployment: from a clean shell with an absolute trusted Node binary and existing owner-controlled runtime directory:

```sh
umask 077
env -i PATH=/usr/bin:/bin TRADING_ENABLED=false \
  unshare --user --map-root-user --net /absolute/trusted/node \
  /absolute/clean/orion-fx/cli/forward-offline.js \
  paper:ops:journal:paper:status --mode appendable-v1 \
  --journal /absolute/private/runtime --run approved_run
```

This only establishes network isolation if unshare succeeds. It does NOT establish credential filesystem isolation. To declare that gate, an operator must first supply a dedicated nonlogin service identity with no read access to real credentials and a clean code deployment containing only necessary modules (not a copy of home or the repository's evidence/holdout directories). Runtime must be privately writable only by that identity; prevent writes to code and its ancestors. Inspect ACLs and mounts separately. Systemd deployment should use a reviewed unit with User, UMask=0077, NoNewPrivileges=yes, PrivateNetwork=yes, PrivateTmp=yes, ProtectSystem=strict, ProtectHome=yes, explicitly limited ReadWritePaths and inaccessible credential mounts. A minimal root/mount namespace is stronger against generic credential paths. Audit supplementary groups and inherited descriptors/environment. These settings are requirements, not settings installed or validated by C4. Do not deploy the recipe on a host where its boundaries are unavailable.

## Readiness and bounded resources

IMPLEMENTED: readiness reports named PASS/FAIL/UNKNOWN gates plus exact `failedGates` and `unknownGates`. Journal integrity, account identity, ledger/cursor reconciliation, risk eligibility, synchronization, freshness, source authenticity, completed-candle source verification, receipt binding, execution-price evidence, persistence/credential/network OS boundaries and broker-order prohibition are separate. Missing evidence returns UNKNOWN. Valid engineering fixtures return FORWARD_OBSERVATION_BLOCKED; ENGINEERING_READY is only subordinate functional reconciliation. No code path returns FORWARD_PAPER_MODEL_READY with current evidence. Local validation is never promoted to authenticated acquisition.

PARTIAL: input JSON is capped before descriptor read at 128 MiB; observations are individually capped at 262144 bytes, batches at 100, journals/reference replay at 1000 candles, CLI steps at 24. Canonical depth is bounded but raw JSON.parse allocation/depth, directory enumeration and accumulated orphan count have no smaller preallocation budget. The low-level journal events API materializes all rows; the 1000-candle replay bound does not bound arbitrary legacy journal callers. busy backpressure is bounded; retries are caller controlled, with no polling/worker daemon. Existing errors sanitize CLI output. Permission/type/symlink/collision/rollback failures are tested; exhaustive ENOSPC/quota/ACL fault injection, allocation exhaustion and all disk/permission windows remain PENDING. No automatic artifact repair or risk reset exists.

## Remaining acceptance blockers

BLOCKED: hostile same-user pathname safety and real credential isolation require the operator-maintained OS boundary or architectural redesign. PENDING: interior prefix-verification kill, separate CLI-output kill, WAL-mode recovery, exhaustive ENOSPC/permission/ACL faults, strict directory/input allocation budgets and independent retained journal-head anchors. PARTIAL: shared publisher report crashes are tested with a real account report, not every historical CLI report orchestration. BLOCKED: authenticated forward provenance, independently verified completed-candle timing and executable-price evidence. No default classification authorizes forward acquisition, orders or real money.

Final regression counts and exact inventory are in [delivery](quant-v3-4-c4-delivery.md).
