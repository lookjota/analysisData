# Orion Quant V3.4-C3 delivery — PARTIAL checkpoint

IMPLEMENTED: lexical evidence-path protection before normalization/open, reuse of anchored exclusive JSON I/O, a dedicated network-denied forward CLI, structured conservative readiness, and 18 focused security cases. TESTED guarantees and unresolved acceptance gates are detailed in [the audit](quant-v3-4-c3-audit.md).

No orders, broker connections, credential-file reads, dataset edits, protected final holdout operations, strategy/financial changes, staging, commits or pushes were performed. Trading remains disabled. Existing untracked services/freqtrade/scripts/ was left untouched.

## Exact changed files

Modified:

- `cli/forward.js`: readiness dispatch, strict receipt option, pre-normalization path checks and readiness help.
- `market-data/capital-history.js`: shared lexical policy before anchored reads/publications and preflight checks.
- `market-data/forward-journal.js`: lexical directory policy before normalization.
- `package.json`: `forward:offline` and `paper:ops:readiness` scripts.

Added:

- `cli/forward-offline.js`: install network guard before importing runtime.
- `security/path-policy.js`: traversal and sensitive-component rejection.
- `security/offline-guard.js`: process-lifetime fetch/HTTP/HTTPS/TCP/TLS tripwires.
- `paper/ops-readiness.js`: evidence-driven blocked/unknown assessment.
- `tests/fixtures/c3-network-child.js`: isolated six-transport rejection probe.
- `tests/quant-v3-4-c3.test.js`: 18 individual security/readiness cases.
- `docs/quant-v3-4-c3-audit.md` and this delivery document.

The conservative existing semantic digest includes changed market-data and new paper code: prior appendable runs fail configuration identity checks under this source revision. There is no silent migration or identity override. Fixed dataset account semantics and SQLite schema are unchanged.

## Readiness usage and actual missing-evidence example

```sh
TRADING_ENABLED=false npm run paper:ops:readiness --prefix services/orion-fx -- \
  --journal /tmp/orion-c3-evidence-missing --run demo
```

```json
{"schemaVersion":"orion.ops-readiness.v1","tradingEnabled":false,"brokerExecution":"DISABLED","executableQuoteAvailable":false,"classification":"UNKNOWN","engineeringAssessment":"UNKNOWN","blockers":["EVIDENCE_MISSING_OR_INVALID"]}
```

An optional `--receipt /absolute/receipt.json` validates local receipt consistency only. Receipt-to-journal binding remains UNVERIFIED. A synchronized active four-account engineering fixture returns FORWARD_OBSERVATION_BLOCKED with subordinate ENGINEERING_READY; the tests assert this. Missing evidence never yields forward readiness. Exit 0 means the assessment ran, not that acquisition/trading is approved; automation must inspect classification. Status/readiness can append normal recovery audit events, with no financial effects.

## Security evidence

TESTED: traversal and named sensitive paths rejected before file open; file/parent/dangling symlinks rejected; directory rejected; readonly filesystem failure visible; publication cannot overwrite an existing target; new artifact mode 0600. Journal payload, predecessor, sequence, calendar and locally resealed interior payload mutations reject. Existing C2 adds missing sequence, genesis, resealed cursor, configuration and pending-intent checks.

TESTED: six network API attempts fail in a fresh guarded subprocess. All 18 focused C3 cases also pass under an actual unprivileged Linux network namespace. This does not establish process-wide credential isolation or make monkey-patching a security sandbox.

Process-crash and concurrency evidence is inherited and rerun from B/C/C2, not newly claimed from timing-only tests. The audit lists all nine requested windows separately. C2 compares stored financial event bodies/digests, original committed prefixes, reconstructed cursors and USD8 financial state across retry/restart. SQLite transactions remain unchanged. Persistent risk states are never reset.

## Acceptance blockers

PARTIAL: pathname-based SQLite reopen and directory enumeration/initialization still require trusted private directories; same-user directory replacement attacks are not fully prevented. Credential path denial covers shared JSON entry points, not arbitrary filesystem APIs or secret aliases. Legacy broker-capable CLI dispatch is not globally guarded.

PENDING: kills inside journal/receipt/report publication and recovery verification; complete different-strategy/receipt/conflicting-appender race matrix; comprehensive permission and nonregular-file matrix; independent head retention and migration/recovery policy. These prevent full C3 acceptance regardless of regression success.

BLOCKED: genuine forward readiness, independent provider authenticity and executable-price evidence. Local digests do not prove broker signatures. Recommended next step: finish the offline filesystem, crash and concurrency gates, then review separately authorized bounded read-only Demo acquisition with independent receipt capture and operator-controlled credentials. Do not activate acquisition automatically.

## Validation record

Final results are recorded below after completed runs. Logs live under `/tmp/orion-c3-*.log`; they are local test artifacts, not immutable historical evidence. Default Node isolation reports files; no-isolation runs report individual cases. Do not sum repeated runs as unique cases.

TESTED on Node v26.13.0. Full regression commands used `NODE_OPTIONS=--import=/home/look/Downloads/orion-trading-engine/services/orion-fx/tests/fixtures/offline-network-guard.js`. The individual-case service run also sets `--max-old-space-size=128`. No command loads an env file.

| Completed command | Unit counted | Passed | Failed / skipped | Duration ms |
|---|---|---:|---|---:|
| `npm test` | test files | 29 | 0 / 0 | 270027.911423 |
| `npm test --prefix services/orion-fx` | test files | 28 | 0 / 0 | 268254.250106 |
| `node --test --test-isolation=none services/orion-fx/tests/quant-v3-4-c3.test.js` | individual cases in 1 file | 18 | 0 / 0 | 3291.228224 |
| Focused B + C3, no isolation | individual cases in 2 files | 37 | 0 / 0 | 18296.975189 |
| C3 inside `unshare --user --map-root-user --net` | individual cases in 1 file | 18 | 0 / 0 | 12008.504358 |
| Foundation, no isolation | individual cases in 1 file | 9 | 0 / 0 | 188.135722 |

`npm run check` exited 0: Node version and orders-disabled check successful; this is not a test suite. Full root regression passed historical V3.3-C3 (249770.364718 ms), C4 (35428.206043 ms), V3.4-A/B/C/C2 and F2. Financial historical reference assertions remain unchanged and passed. No strategy/risk/accounting source was modified.

One initial service invocation failed before discovery because a relative NODE_OPTIONS preload was resolved from npm's initial working directory. The absolute-path invocation above completed successfully. No test failure was suppressed. The original isolated focused run passed 1 test file; individual-case results above come from explicit no-isolation runs.

TESTED: `npm run test:cases --prefix services/orion-fx` exited 0: **323 individual cases across 28 files**, 323 passed, 0 failed, 0 skipped, 331798.209639 ms. Together with the separately completed foundation run (9 cases in 1 file), the regression inventory is **332 individual cases across 29 files**. This is an inventory across those two completed no-isolation runs, not the file count printed by npm test. The 18 new C3 cases are included in the 323 service cases.

Final repository checks: `git diff --check` passed; `git status -sb`, `git diff --stat` and `git ls-files --others --exclude-standard services/orion-fx/` inspected. The tracked diff stat covers four modified files; eight added files remain untracked and are listed above. No files were staged, committed or pushed. The preexisting untracked freqtrade directory remains untouched.
