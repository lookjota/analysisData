# Orion Quant V3.4-C2 delivery — PARTIAL acceptance

IMPLEMENTED: versioned appendable durable paper accounts. Financial effects are offline MODEL_ONLY assumptions. No authenticated forward observations, acquisition, orders, profitability optimization or trading activation.

## Identity and compatibility

`strategy-appendable-v1` binds session ID (including run ID and strategy), EUR/USD H1, journal genesis, canonical calendar policy, resolved strategy version and parameters, initial USD capital, risk rules, accounting, execution assumptions, broker execution disabled, and a semantic source digest. Source identity hashes sorted JavaScript filenames and contents across the backtest, strategies, risk, financial, portfolio, execution, calendar, market-data, persistence, paper and indicators modules. This deliberately rejects even conservative implementation changes; continuing an old run across code changes needs an explicit future migration policy. Mutable head, dataset hash and observation-time validation clock are excluded from permanent identity.

Fixed `strategy-candle-v1` accounts and fixed snapshot commands retain their original identities and watermark behavior. Appendable accounts use `<run>-append-v1-<strategy>.sqlite`, with matching stable session IDs. No fixed account is converted, rewritten or reused implicitly. SQLite `user_version=1` and existing event schemas remain intact; the new `STRATEGY_APPEND_CHECKPOINT` has its own explicit event type and the identity carries its version. Older binaries do not understand the new event type and fail closed.

## Verified commitments and cursor

Every open first verifies the entire existing observations.v1 file chain and source evidence, completion, calendar, timestamps, gapless sequences and revision quarantine. Caller-provided rows must exactly match the verified accepted candles, and the execution calendar must match the journal calendar.

A canonical SHA-256 overlay adds explicit domains without modifying existing observation bytes:

- journal identity: hash `{domain: orion.appendable.journal.v1, genesis: original journal config digest}`;
- genesis commitment: hash `{domain: orion.appendable.genesis.v1, journalIdentity, metadataDigest}`;
- candle identity: hash `{domain: orion.appendable.candle.v1, timestamp, contentHash}`;
- commitment N: hash `{domain: orion.appendable.commitment.v1, previous, sequence, candleIdentity, observationDigest}`.

Objects use sorted canonical JSON keys, explicit typed fields and domains. No string concatenation ambiguity. The observation digest binds the complete v1 evidence, sequence, prior v1 digest and ingestion metadata. The overlay is reconstructed only from a fully verified journal; it is never trusted from an external cursor file. Journal identity is content addressed: identical genesis metadata represents the same logical journal; this is not a broker-issued identifier or independent source authentication.

Each append checkpoint stores index, reference trace digest, pending intent and cursor `{journalIdentity, sequence, commitment, candleIdentity, configurationHash}`. Zero progress is anchored at the overlay genesis. Every historical cursor, pending intent, financial effect and projected USD8 state is reverified against the consumed prefix. Truncation, resealed cursor mismatch, changed configuration and prefix corruption fail closed.

`BEGIN IMMEDIATE` obtains the SQLite writer lock before rereading progress and planning effects. Every candle's effects and cursor are inserted in the same transaction, validated by portfolio projection, and committed using existing FULL synchronous DELETE journaling. Concurrent account workers therefore replan against committed progress. There is no external cursor and no multi-account transaction. SQLITE_BUSY may require an explicit retry.

## Pending intents and risk

Pending identity binds stable configuration, closed candle index and actual strategy signal. Append does not change that ID or the consumed checkpoint. No end-of-input liquidation or fill is invented. Repeated steps at the head do not advance financial state. New completed bars provide next-observed-open historical price evidence; fills remain MODEL_ONLY, with no executable quote or liquidity evidence. PAUSED/HALTED stay latched, including pending intents, and block entries. Cursor consumption can continue for valuation and reconciliation while risk status stays blocked.

Operational account states are SYNCHRONIZED, DIVERGED_RECOVERABLE, BLOCKED_RISK, BLOCKED_INTEGRITY and UNKNOWN. Verified statuses expose IDs, consumed/head progress, pending observation count, risk, equity/PnL and reconciliation. Missing accounts are UNKNOWN; corrupt accounts are independently BLOCKED_INTEGRITY on status. A step fails closed before applying financial work if account opening/verification fails. Global journal-integrity failure returns a command error. Operational status opens valid accounts through normal F2 recovery and appends recovery audit events; it is financially read only, not byte read only.

## CLI

Default commands retain fixed-watermark behavior. Opt in explicitly:

```sh
node services/orion-fx/cli/index.js paper:ops:journal:paper:init --journal /tmp/verified-journal --run demo --mode appendable-v1
node services/orion-fx/cli/index.js paper:ops:journal:paper:step --journal /tmp/verified-journal --run demo --mode appendable-v1 --limit 24
node services/orion-fx/cli/index.js paper:ops:journal:paper:status --journal /tmp/verified-journal --run demo --mode appendable-v1
```

Append remains `paper:ops:journal:append --journal DIRECTORY --input BATCH.json`. Commands are bounded and offline, emit JSON, reject unknown flags and do not poll. No receipt or observation is promoted into FORWARD_DATA_OBSERVATION or FORWARD_PAPER_MODEL; synthetic fixtures stay ENGINEERING_REPLAY and historical imports retain HISTORICAL_BACKFILL classification.

## Evidence and acceptance

TESTED: focused C2 acceptance (`node --test --test-isolation=none services/orion-fx/tests/quant-v3-4-c2.test.js`) exited 0: 26 cases passed, 0 failed, 0 skipped; 155603.674491 ms. This includes three actual SIGKILL boundaries, concurrent same-account workers, pending long/short/exit/no-intent, risk latches, corruption, configuration rejection, four-account byte preservation and fresh-process financial equality. Final full-suite outcomes are recorded below.

## Limits and next milestone

PARTIAL: the full requested security acceptance matrix does not yet have dedicated filesystem/network syscall tripwires for every forbidden path or transport. Existing regressions and the external-fetch guard supplement source inspection. No claim of exhaustive hostile-host protection or power-loss durability beyond the configured SQLite guarantees. Protected holdout freshness remains UNKNOWN; no protected registry is inspected or changed.

The run is bounded to the established 1000-observation journal/F2 limit and reconstructs prefixes rather than streaming strategy state. The complete journal must remain locally available. Hashes detect divergence relative to stored account anchors but do not authenticate broker origin or protect against coordinated replacement of both database and journal. Existing fixed accounts require an explicit future reviewed migration if continuation under appendable semantics is desired.

Recommended next milestone: dedicated filesystem/network denial tripwires and tested operator recovery/export policy; then bounded incremental strategy-state persistence. Authenticated forward acquisition and executable-quote modeling need separate authorization and evidence.

## Exact implementation files

Modified:

- `cli/forward.js`: explicit appendable CLI mode, strict option validation and machine-readable blocked/unknown command states.
- `paper/strategy-durable.js`: appendable configuration identity, verified source binding, transactional cursor, stable pending intent, fault boundaries; fixed-mode behavior retained.
- `persistence/journal.js`: new checkpoint event and inert projection case; optional before-COMMIT test boundary after inserts.

Added:

- `paper/appendable-commitments.js`: domain-separated verified commitment overlay.
- `paper/appendable-operations.js`: four independent accounts, bounded convergence and status.
- `paper/semantic-identity.js`: conservative execution-source identity.
- `tests/quant-v3-4-c2.test.js`: append, integrity, pending/risk, concurrency, byte preservation and subprocess crash tests.
- `tests/fixtures/appendable-c2.js`: controlled twelve-observation synthetic evidence and account arguments.
- `tests/fixtures/appendable-c2-child.js`: offline subprocess boundaries and fresh-process status.
- `docs/quant-v3-4-c2-audit.md` and this delivery document.

The optional injected fault callback is available only through the programmatic API; CLI inputs cannot supply code. The before-COMMIT callback runs after effect and checkpoint insertion, while the writer transaction is still open. The after-COMMIT callback runs before the caller receives acknowledgment. Child processes die by actual SIGKILL, not thrown-error simulation.

## Completed offline demonstration

TESTED: the standalone first C2 case exited 0 after creating six verified synthetic observations, initializing four accounts, consuming six, appending six, resuming the same accounts, retrying, reopening, and comparing financial state in a fresh IPC subprocess. All four consumed twelve. Original stored event bodies/digests were preserved across append for every account; all retry financial event bytes remained identical. Every account reconciled by F2 trace projection plus independent cash=sum(initial capital, signed ledger USD8) and equity=cash+unrealized USD8 checks.

Actual fixture directory: `/tmp/orion-c2-Rxc0uD/journal`. These are temporary local engineering artifacts, not a historical dataset or forward evidence.

Journal identity: `b25c5a8995d0c61b3a658eab2d9e3acff6047d1290d435eec3d818763a181f04`.

Six-observation prefix: `33464c39638c66b69985a5bd85f1be41dad88eba4b66c300a10e549e8decd938`.

Twelve-observation head: `2b9056b2f7bd9134ce6f1e16b7d15b90f5230a97d485c15355dba5312871b120`. Every account consumed exactly that head.

| Stable account ID | Consumed | Equity USD8 | Realized USD8 | Unrealized USD8 | Risk/status |
|---|---:|---:|---:|---:|---|
| demo-append-v1-trend | 12 | 99970944000 | -29056000 | 0 | HALTED / BLOCKED_RISK |
| demo-append-v1-mean-reversion | 12 | 100000000000 | 0 | 0 | ACTIVE / SYNCHRONIZED |
| demo-append-v1-breakout | 12 | 100070824000 | 0 | 70824000 | HALTED / BLOCKED_RISK |
| demo-append-v1-ma-cross | 12 | 99970944000 | -29056000 | 0 | HALTED / BLOCKED_RISK |

Stable configuration identities, asserted identical before and after append:

- `demo-append-v1-trend`: `b42d8281f94fb1612bc6f06fc4ad2c5a504ec1497100d68fc3ba035921b94992`
- `demo-append-v1-mean-reversion`: `7db2098f81b2a025ca2fb47195c98794a3dcdb5fca6e3627809df09672549535`
- `demo-append-v1-breakout`: `913cec78e90453bcb7ea457c7fd481d80da213e323459c4b402acbf9c966c20c`
- `demo-append-v1-ma-cross`: `d863aaa80ad4863bd3357703eccab5b86d9c47eb8eb8245656dd9c155719fe63`

All four cursors caught up; aggregate operational `synchronized` remains false because three accounts are HALTED. No HALTED account was reset or represented as synchronized. The unchanged conservative engine can retain a marked position in a blocked account; the demonstration reports that exposure without inventing liquidation. Mean-reversion is ACTIVE/SYNCHRONIZED.

## Final regression record

TESTED on Node v26.13.0, `TRADING_ENABLED=false`, with `NODE_OPTIONS='--max-old-space-size=128 --import=/home/look/Downloads/orion-trading-engine/services/orion-fx/tests/fixtures/offline-network-guard.js'`. The preload rejects non-loopback global fetch; all acquisition fixtures inject offline transports. It is not an exhaustive syscall monitor. Default Node isolation reports test files; the focused no-isolation command reports individual cases.

- `npm test`: exit 0, 28 test files passed, 0 failed, 0 skipped; 231554.687359 ms.
- Focused C2: exit 0, 26 individual cases passed, 0 failed, 0 skipped; 155603.674491 ms.
- `npm run check`: exit 0; Node version and orders-disabled check successful (not a test-case suite).
- Root regression includes C3 (208695.365261 ms) and C4 (23339.396377 ms), both successful, plus previous V3.4-A/B/C and F2 tests unchanged.

C3 regression explicitly recomputes/replays current-source results and asserts these historical references (training trades/PnL, validation trades/PnL): trend `24 / 21.43500101 / 22 / -14.26597187`; mean-reversion `12 / -3.73568 / 6 / 6.98565`; breakout `20 / -8.71596092 / 10 / -13.27511901`; ma-cross `1 / 3.13616005 / 1 / -0.5772`. C4 preserves inspection of the historical C3 envelope and rejects rehashed malformed schemas. Original source-bound historical sessions are not silently reinterpreted under new implementation identities.

Superseded development failures are not passing acceptance evidence: early 16-case exploration had 11 passes/5 failures (incorrect synchronized assertions for latched risk and an invalid test period); a 23-case intermediate run had 22 passes/1 failure while sources were changing; a 9-case expansion had 8 passes/1 failure from trying to mutate a frozen fixture (fixed by cloning). Two 26-case runs each had 25 passes/1 failure in stdout parsing of fresh-process status. Switching that child to IPC corrected the harness; the final complete 26-case run passed. Earlier root/service runs reported respectively 27/28 and 26/27 passing files for this harness failure. One initial service invocation failed before test discovery due to an incorrect relative preload path; the final commands use the absolute path. Default-isolation exploratory failures without individual diagnostics were superseded by enumerated runs. No integrity check was disabled to obtain compatibility.

- `npm test --prefix services/orion-fx`: exit 0, 27 test files passed, 0 failed, 0 skipped; 202996.205814 ms.

TESTED final repository checks: `git status -sb`, `git diff --check`, `git diff --stat`, and `git ls-files --others --exclude-standard services/orion-fx/` inspected. Three tracked files modified (46 insertions, 15 deletions in standard tracked diff stat); eight new files under Orion FX, including these two documents. Standard diff stat excludes untracked files. No staged differences. HEAD remains `725e613` on `feat/orion-quant-v3`. The sole pre-existing unrelated untracked entry `services/freqtrade/scripts/` remains untouched. Tracked data/research-session diff is empty; C3 separately verifies historical input bytes unchanged.

IMPLEMENTED and TESTED: appendable identity, verified commitments, atomic per-account cursor/effects, independent-account recovery, required six-to-twelve demonstration, financial reconciliation and three real SIGKILL boundaries. BLOCKED: no core runtime blocker. PARTIAL overall acceptance: exhaustive path/transport tripwires and the entire adversarial security matrix remain outstanding; fixed-account conversion is intentionally unsupported rather than performed implicitly. PENDING next milestone: dedicated denial instrumentation and reviewed operator recovery/migration policy. No broker orders, authenticated acquisition, Live endpoints, credentials or protected final holdout were used by this implementation workflow; no Git staging, commit or push occurred.
