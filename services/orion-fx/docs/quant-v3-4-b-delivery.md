# V3.4-B delivery — PARTIAL

Append-only offline observations and a fixed-watermark four-account F2 replay bridge are implemented. Genuine FORWARD_OBSERVED publication and forward execution are blocked. No forward performance is claimed.

## Journal contract

Initialize an unused private directory. `journal.json` seals version, createdAt, NY17 calendar/version, finalization delay (default 60000 ms) and max observation age (300000 ms). Library policy bounds delay to one hour and age to one day, age >= delay; CLI uses fixed defaults. Every `observation-NNNNNN.json` contains sequence, previous digest, ingestion time, original observation, content hash, ACCEPTED or QUARANTINED_REVISION state, and canonical SHA256 digest. The original observation is retained without replacing its timestamps with ingestion time.

Offline batch JSON is an array of 1..100 objects, each with exactly:

```js
{
  candle: {instrument:'EUR/USD', timeframe:'H1', timestamp:'2026-11-02T11:00:00.000Z',
    open:1.1, high:1.102, low:1.098, close:1.101,
    source:'offline-source', synthetic:false,
    quoteBars:{bid:{open:1.09995,high:1.10195,low:1.09795,close:1.10095},
               ask:{open:1.10005,high:1.10205,low:1.09805,close:1.10105}}},
  classification:'HISTORICAL_BACKFILL',
  timestampConvention:'UTC_BAR_OPEN', complete:true,
  observedAt:'2026-11-02T12:05:00.000Z', acquiredAt:'2026-11-02T12:05:00.000Z',
  sourceRevision:'revision-1',
  evidence:{content: /* exact original candle object */, contentHash: /* hash(content) */}
}
```

Use exported `hash` from persistence/journal.js for canonical hashes, not ordinary JSON.stringify hashing. Evidence content must equal the original candle. This retains the original declared input, NOT authenticated raw broker HTTP evidence. Engineering synthetic candles require ENGINEERING_REPLAY. Historical backfill stays HISTORICAL_BACKFILL regardless of import date. Source declaration and hashes prove local integrity, not external truth.

Timestamp convention must explicitly declare UTC_BAR_OPEN. Open must align to a UTC hour. Interval is [open, open+1h); observedAt must be >= end+delay, acquiredAt >= observedAt, and all must be <= injected UTC clock. complete must be true; numeric side bars must be positive/finite/consistent. Clock injection is a library dependency for deterministic tests, not an unsafe CLI override. Historical observations may be stale but must have been acquired after completion. Forward requests additionally face observation/end and current observation-age bounds, then always fail FORWARD_RECEIPT_NOT_AUTHENTICATED. Consequently spoofed plausible timestamps cannot gain forward status. Future metadata is independently rejected against the clock; plausible past timestamp forgery cannot be detected offline.

Identical candle content at the same timestamp is a no-op, including repeated provenance declarations: it cannot upgrade classification. First evidence is preserved. Changed content appends an immutable quarantine revision; all snapshot processing then blocks. No resolution policy is provided. Novel out-of-order inputs and missing interior open hours reject; NY17 weekends/declared closures can be skipped. A rejected batch can have a committed prefix; retry is idempotent. Missing coverage before the first bar or after the last bar is not measured against a requested range. Gap reports describe interior coverage only.

## Persistence and recovery

Existing anchored atomic JSON publication writes/fsyncs a temporary file, exclusively hard-links final name, syncs parent, and cleans temporary files. Existing SQLite publication lock provides cross-process exclusive writer semantics with zero wait. Every append revalidates all bounded evidence; maximum 1000 records (including revisions), canonical payload 256 KiB, depth 30, bounded gap scans. Sequence gaps/corrupt content fail closed; no truncation or overwrite recovery exists. Reader may see a valid committed prefix during a multi-record append; batches are not transactions.

Actual SIGKILL test kills a child holding the writer lock after a committed observation, then verifies lock recovery, original commit survival, and duplicate no-op. A second publisher is rejected while the child owns the lock. This does NOT exhaustively test interruption at every file-write/link/fsync window. Existing atomic publication and F2 fault tests remain reused.

Filesystem assumptions: Linux /proc descriptors, local filesystem hard links, correct fsync and SQLite locking. Directory-owner trust is required; metadata is not signed, malicious full-history replacement or deletion of a terminal suffix cannot be detected without an external trusted head. Hashes detect content/chain corruption, not privileged forgery. Initial mkdir and SQLite path-opening assumptions inherit existing utilities; hostile concurrent directory replacement is outside the trusted-private-directory model. Orphan temporary files from interrupted publication can remain; no automatic deletion is performed. Scanning directory entries is not a quota or protection against malicious unlimited extraneous files. Full filesystem/WAL/power-loss certification is outstanding.

## Four-account bridge

`paper:ops:journal:paper:init` writes an immutable run snapshot binding a journal watermark, head, input hash and source classifications. Four independent F2 files bind exactly those rows. Repeating init can complete missing account initialization; existing accounts reopen without reset. New journal rows remain pending outside this fixed dataset. New run IDs start new independent simulations at USD 1000 and must never be interpreted as continuity of the old account.

`paper:step` advances toward min(current account counts)+limit, bounded by snapshot length. Laggards catch up; accounts already ahead are not rewritten. A failure may leave divergence; the next successful status exposes actual counts and subsequent steps reconcile. Four-account atomicity is NOT guaranteed. F2 ensures per-account candle financial checkpoint atomicity and no duplicate effects. State reports include full ledger/trades, realized/unrealized/equity/position, latest candle, journal sequence, latest risk event, source classifications, freshness, integrity, revision status, execution assumptions, and synchronization. Full raw account reports can be large; no daemon or dashboard added.

## Offline CLI examples

From repository root, with a batch prepared using the schema above:

```sh
node services/orion-fx/cli/index.js paper:ops:journal:init --journal /tmp/orion-input
node services/orion-fx/cli/index.js paper:ops:journal:append --journal /tmp/orion-input --input /tmp/observations.json
node services/orion-fx/cli/index.js paper:ops:journal:status --journal /tmp/orion-input
node services/orion-fx/cli/index.js paper:ops:journal:verify --journal /tmp/orion-input
node services/orion-fx/cli/index.js paper:ops:journal:paper:init --journal /tmp/orion-input --run replay1
node services/orion-fx/cli/index.js paper:ops:journal:paper:step --journal /tmp/orion-input --run replay1 --limit 6
node services/orion-fx/cli/index.js paper:ops:journal:paper:status --journal /tmp/orion-input --run replay1
```

Unknown/duplicate options, unexpected input/run/limit and noninteger bounds reject. Only paper:step accepts --limit 1..24. Paths and filenames are checked by existing safe readers/publication helpers. Only use explicitly authorized observation batches; no registry or automatic research discovery occurs. New commands import no credential loader and dispatch before the existing CLI credential path.

Manual actual CLI-dispatch acceptance used throwing fetch and a credential environment Proxy that throws on every access. All five commands (init, append, paper:init, paper:step, verify) succeeded. Evidence: `/tmp/orion-v34b-cli-evidence.jsonl`. Journal sequence 6, accepted 6, integrity VERIFIED_LOCAL_HASH_CHAIN, classification ENGINEERING_REPLAY, stale true, quarantine empty, forwardExecution BLOCKED_NO_AUTHENTICATED_RECEIPT_OR_EXECUTABLE_QUOTE, tradingEnabled false, brokerExecution DISABLED. All four strategies committed 6 candles, journal sequence 6, synchronized true. These are engineering inputs, not forward financial returns.

## Demo acquisition contract — not activated

A separately authorized adapter must receive a Demo-only read-only capability with authenticate/close, verifyContext, findEurUsd(metadata), historicalCandles(epic,bounded range), and clock/rate-limiter dependencies. It must never expose order methods to ingestion. Existing acquireHistory can supply bounded declared historical data but is insufficient to authenticate forward observations by itself.

Before activation:

1. Explicitly authorize Demo data access separately; no credentials needed now.
2. Enforce exact Demo origin/context, order-denying endpoint allowlist, exact EUR/USD metadata/epic and HOUR resolution.
3. Verify broker timestamp convention and completed-bar/publication behavior with documented evidence; assume no latency or availability guarantee.
4. Preserve sanitized original price response, request range, request start/receipt UTC timestamps, revision identity and source bid/ask fields. Never retain authentication headers or secrets in evidence.
5. Establish an independently verifiable receipt/attestation boundary; do not accept caller timestamps as proof. Extend the validator with an audited authenticated receipt policy before allowing FORWARD_OBSERVED.
6. Bound requests, responses, retries and pacing; validate requested coverage/calendar exceptions; no automatic live fallback.
7. Implement/test appendable F2 input identity without invalidating committed prefixes, plus genuine subsequent quote timing/freshness. Current fixed-watermark replay is insufficient.
8. Keep execution disabled. Define conservative forward price assumptions or block when no contemporaneous executable quote exists. Offline historical next-open prices must not be passed off as real-time fills.
9. Complete fault-window, spoofing, continuous-feed, account subprocess and security tests before claiming forward readiness.

## Validation

Focused V3.4-B: one file, 19 named test cases. Combined V3.4-A/B: two files, 21 cases, 21 passed, 0 failed. New coverage includes completion/delay/future gates; bid/ask integrity; evidence and synthetic provenance; forward refusal and age bounds; duplicates/revisions; calendar gaps/weekend/DST; corruption/symlinks; actual child SIGKILL and competing writer; strict CLI; four accounts, deliberate one-account advance `[2,0,0,0]`, divergence detection, catch-up to `[6,6,6,6]`, unchanged repeat financial snapshots, and revision processing block. Existing A assertions additionally prove original trend HALTED reason and PnL. Existing F2 suites cover PAUSED/HALTED recovery, stop/target semantics, real account subprocess recovery and ledger invariants. This is not 30 new dedicated acceptance cases; unimplemented forward behavior remains blocked.

Final suite outcomes and exact counts are recorded below after completion. All regression commands preload the existing external-fetch guard (loopback allowed for root service tests); mocks remain usable. No real broker transport or order endpoint is invoked. No final holdout was requested or evaluated by the new code; existing C3 regression retains its original TRAIN/VALIDATION behavior.

Validation note: the first default-isolation full runs failed only the new B file (root 25/26 files, service 24/25); C3 and A passed. The child lock fixture awaited an unresolved promise without a referenced event-loop handle, so Node could exit before the parent killed it. It now explicitly stays alive until SIGKILL, and its fork clears inherited test runner flags. The corrected isolated B run passed 1/1 file; repeated focused A/B passed 21/21 cases. These initial failures are not counted as successful acceptance runs.

Separate expanded service run completed 251/251 individual cases across 25 files, 0 failed (266615.412982 ms); foundation expanded run completed 9/9 cases in one file. This count run preceded the child-fixture stabilization; final focused and isolated runs exercise the stabilized fixture. Total named cases represented across root/service files: 260, without double-counting the focused reruns. Existing C3 comprises six named cases and passed its exact numerical and computational replay assertions in that expanded run.

Final required acceptance, completed with exit 0:

| Command | Test files | Individual cases | Outcome |
| --- | ---: | ---: | --- |
| `npm test` | 26 | runner reports file units | 26 passed, 0 failed; 178313.472174 ms |
| `npm test --prefix services/orion-fx` | 25 | runner reports file units | 25 passed, 0 failed; 181355.955501 ms |
| focused A/B with `--test-isolation=none` | 2 | 21 | 21 passed, 0 failed; 41931.967761 ms |
| separate expanded service case run | 25 | 251 | 251 passed, 0 failed |
| separate expanded foundation case run | 1 | 9 | 9 passed, 0 failed |
| `npm run check` | n/a | n/a | orders disabled, exit 0 |

Final default-isolation root and service runs include passing V3.4-B, V3.4-A, F2 and C3 files. Logs: `/tmp/orion-v34b-root-final.log`, `/tmp/orion-v34b-service-final.log`, `/tmp/orion-v34b-focused-final.log`, `/tmp/orion-v34b-cases.log`, `/tmp/orion-v34b-foundation-cases.log`, `/tmp/orion-v34b-check-final.log`. Source was not changed during the final C3 identity checks; the final paper-path prevalidation change is outside C3's enumerated source directories.

Final worktree checks: `git diff --check` passed; `git status -sb`, `git diff --stat`, and `git ls-files --others --exclude-standard services/orion-fx/` were inspected. Three tracked files modified plus seven newly authored files, all under services/orion-fx. Git diff --stat reports only tracked edits (8 insertions, 1 deletion); it does not include untracked additions. Pre-existing untracked Freqtrade scripts remain present and untouched. Nothing staged, committed or pushed.
