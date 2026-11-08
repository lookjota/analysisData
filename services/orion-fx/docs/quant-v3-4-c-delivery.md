# V3.4-C delivery — PARTIAL, forward activation BLOCKED

This checkpoint implements an offline receipt contract and fixture-to-journal bridge. It does not deliver authenticated forward acquisition or appendable financial sessions. `TRADING_ENABLED` remains false. No broker request, broker order, daemon, polling, staging, commit or push was performed. Baseline HEAD is `15f4638eb597a130e37a2d2effb0cc3f6510c355` on `feat/orion-quant-v3`.

## Feature gates

| Feature | Status | Evidence / limitation |
| --- | --- | --- |
| Versioned receipt content verification | IMPLEMENTED / TESTED | Actual Demo adapter price schema, recomputed normalization and metadata, SHA256 integrity |
| Honest source trust | IMPLEMENTED / TESTED | Fixture-only trust, no cryptographic signature or authenticated origin claim |
| Completed interval and quote integrity | IMPLEMENTED / TESTED | End + configurable delay, bid/ask OHLC, range/resolution/calendar/gaps |
| Actual broker timestamp semantics | PENDING | Existing UTC bar-open assumption is explicitly labeled |
| Independent publication-time evidence | PENDING | Configured delay only; source provides no publication timestamp here |
| Offline fixture journal append | IMPLEMENTED / TESTED | Receipt sidecar, engineering classification, duplicate no-op, correction quarantine |
| Empty closed-window receipt | PENDING | Existing history/manifest rejects empty datasets; fixture tests explicit rejection |
| Read-only transport reuse | IMPLEMENTED / TESTED offline | Existing Demo adapter plus unexpected response URL/redirect defense |
| Network receipt collector/command | PENDING | No new network activation path; offline collector requires injection |
| Append-only observation chain | IMPLEMENTED previously / TESTED | B journal v1 preserved |
| Appendable durable account identity | BLOCKED | F2 binds complete dataset and derived financial identities; no safe v2 migration implemented |
| Four-account appendable processing/cursor | BLOCKED | Existing snapshot accounts preserve history and expose pending source growth |
| Four-account fixed-snapshot recovery | TESTED | Existing B divergence/catch-up and C unchanged financial prefix assertions |
| Genuine forward executable quote | BLOCKED | H1 endpoints are historical model inputs, not current ticks |
| Crash coverage | PARTIAL / TESTED | Three real receipt SIGKILL boundaries; inherited journal/F2 tests; no exhaustive power-loss certification |

## Exact changed files

Modified:

- `services/orion-fx/brokers/capital-demo.js` — reject redirected or mismatched response URL.
- `services/orion-fx/cli/index.js` — offline receipt dispatch before credential handling.

Added:

- `services/orion-fx/market-data/acquisition-receipt.js` — fixture collector, strict local receipt verification, immutable publication, engineering journal bridge.
- `services/orion-fx/cli/receipt.js` — offline verify, coverage and append commands.
- `services/orion-fx/tests/fixtures/acquisition-offline.js` — deterministic provider transport and response variants.
- `services/orion-fx/tests/fixtures/acquisition-receipt-child.js` — real interruption fixture.
- `services/orion-fx/tests/quant-v3-4-c.test.js` — 28 focused cases.
- `services/orion-fx/docs/quant-v3-4-c-audit.md` — actual interface audit and trust boundaries.
- `services/orion-fx/docs/quant-v3-4-c-delivery.md` — delivery, activation and gate record.

Existing financial tests and accounting/strategy engines were not edited. Existing untracked `services/freqtrade/scripts/` remains untouched. `git diff --stat` excludes newly added untracked files until staging; nothing was staged.

## Receipt example

Actual deterministic two-bar fixture verification returns these fields (excerpt, not a complete receipt):

```json
{
  "receiptHash": "0da8abba62466f398561a473d69da761c1eae0389001060dabb5a2ec98a31761",
  "provider": "Capital.com",
  "environment": "demo",
  "instrument": "EUR/USD",
  "epic": "EURUSD",
  "resolution": "H1",
  "requestedUTC": {"start":"2026-11-02T10:00:00.000Z","end":"2026-11-02T12:00:00.000Z"},
  "returnedUTC": {"start":"2026-11-02T10:00:00.000Z","endExclusive":"2026-11-02T12:00:00.000Z"},
  "acquiredAt": "2026-11-02T12:05:00.000Z",
  "publicationDelayMs": 60000,
  "publicationTimeEvidence": "NOT_PROVIDED_BY_SOURCE_DELAY_POLICY_ONLY",
  "transportClassification": "INJECTED_OFFLINE_FIXTURE",
  "sourceAuthentication": "UNVERIFIED_OFFLINE_FIXTURE",
  "cryptographicSourceSignature": false,
  "evidenceClassification": "ENGINEERING_REPLAY",
  "executionPriceClassification": "HISTORICAL_H1_ENDPOINT_MODEL_ONLY",
  "executableQuoteAvailable": false,
  "integrity": "VERIFIED_LOCAL_CONTENT_ONLY"
}
```

The full receipt contains the original historical artifact, retained provider price objects, all recomputed metadata and a canonical body hash. `rawPayloadDigest` is the retained price-response JSON digest, not a digest of HTTP wire bytes. See the audit for every metadata field and verification step. An offline receipt is never upgraded to `FORWARD_DATA_OBSERVATION` or `FORWARD_PAPER_MODEL` by import date or a forged field. Historical backfill classification in the existing B journal also remains unchanged.

## Identity and recovery demonstration

The focused tests publish a receipt for two bars, append them, then repeat the import: source sequence remains 2 and journal head is identical. A corrected first bar produces sequence 3, quarantined revision [3], and byte-identical original observation 1. Source revision strings bind each first imported observation to `receipt:<receiptHash>`; immutable sidecar filenames include that hash.

For financial continuity, four accounts initialize on those two observations and process to `[2,2,2,2]`. Appending a third later observation leaves account dataset hashes and projected financial snapshots unchanged and reports `pendingJournalRecords:1`. This demonstrates safe refusal to extend a fixed F2 identity. It is not an appendable-account implementation. Starting another run at USD 1000 is not a migration or continuation.

Existing B coverage deliberately advances trend alone to `[2,0,0,0]`, exposes divergence, reconciles to `[6,6,6,6]`, checks no duplicate financial effects on repeat, and blocks processing after a changed consumed observation. Real C child interruptions before receipt publication, after publication, and after append each recover to two observations with no duplicate append. Account-transaction interruptions are inherited from existing F2 tests; no appendable mode exists to test.

H1 data remains historical next-open simulation: signal on closed N, modeled historical open N+1, observed aggregate bid/ask endpoints, .1 pip adverse slippage, no additional assumed spread on the observed-side journal bridge. No claim of contemporaneous tick execution or broker fill is made. Forward processing remains fail-closed.

## Offline CLI

From the repository root, for an already created local fixture receipt:

```sh
node services/orion-fx/cli/index.js receipt:verify --input /tmp/receipt.json
node services/orion-fx/cli/index.js receipt:coverage --input /tmp/receipt.json
node services/orion-fx/cli/index.js paper:ops:journal:init --journal /tmp/new-journal
node services/orion-fx/cli/index.js receipt:append --input /tmp/receipt.json --journal /tmp/new-journal
node services/orion-fx/cli/index.js paper:ops:journal:status --journal /tmp/new-journal
node services/orion-fx/cli/index.js paper:ops:journal:paper:init --journal /tmp/new-journal --run engineering
node services/orion-fx/cli/index.js paper:ops:journal:paper:step --journal /tmp/new-journal --run engineering --limit 1
node services/orion-fx/cli/index.js paper:ops:journal:paper:status --journal /tmp/new-journal --run engineering
```

These receipt commands never construct a broker or load credentials. Unknown, duplicate, missing or inapplicable flags fail. The receipt generator is a module-level engineering API, deliberately omitted from the network CLI. Fixture creation is exercised by `quant-v3-4-c.test.js` and can be reproduced entirely offline through that test.

## Separately authorized Demo acquisition: exact next steps

1. Accept this as a partial engineering checkpoint, with forward financial execution blocked.
2. Before implementing an authenticated receipt mode, confirm the broker's H1 timestamp semantics, actual Demo calendar and source latency; define trusted local collector identity, clock policy, transport evidence and immutable external head/cursor anchoring. Distinguish unsigned HTTPS origin trust from broker signatures.
3. Implement a new explicit receipt-producing Demo read command, with no arbitrary HTTP path, no retries of unsafe actions, and no default polling. Keep all fixtures marked offline and prevent imported receipts from upgrading trust. Complete empty-window, publication-time and receipt-to-journal cursor verification policies.
4. Independently implement/version and audit F2 appendable input commitments with source-prefix and financial checkpoint atomicity, legacy compatibility and account crash tests. Add a conservative executable-quote gate before any forward paper fill. Preserve C3 financial reference results.
5. After those gates pass and the user separately authorizes one actual Demo read, provide a bounded H1 interval and new output filename plus Demo expected account context through the existing secure configuration mechanism. Never print or read `.env` into logs. Manually invoke only that reviewed command. Do not start strategies or orders from acquisition.

For a separately authorized **historical artifact only**, the existing command already has the syntax `node services/orion-fx/cli/index.js history:download --from UTC_ISO_Z --to UTC_ISO_Z --out NEW.json`, with `CAPITAL_EXPECTED_ACCOUNT_ID` and Demo credentials provided externally. It does not produce a C authenticated receipt or unlock appendable accounts. It was not invoked against the broker during this delivery. There is no instruction here to run it automatically.

## Validation

All automated acquisition uses injected offline transport. Regression runs preload `services/orion-fx/tests/fixtures/offline-network-guard.js` through `NODE_OPTIONS`; this forbids external global fetch while permitting loopback foundation HTTP tests. No broker order method or execution endpoint was added. No real credentials, protected datasets or final holdout were used by the new tests.

| Completed command | Test files | Individual cases | Result |
| --- | --- | --- | --- |
| `npm test` with guard | 27 | Default runner reports file units; case total not measured | 27 passed, 0 failed; exit 0; 182014.400758 ms |
| `npm test --prefix services/orion-fx` with guard | 26 | Default runner reports file units; case total not measured | 26 passed, 0 failed; exit 0; 180236.784054 ms |
| Focused C with `--test-isolation=none` | 1 | 28 | 28 passed, 0 failed, 0 skipped/cancelled/todo; exit 0; 20019.475155 ms |
| `npm run check` | n/a | n/a | Exit 0, Node v26.13.0, orders disabled |
| `git diff --check` | n/a | n/a | Exit 0 |

Exact regression invocation used `NODE_OPTIONS='--import=/home/look/Downloads/orion-trading-engine/services/orion-fx/tests/fixtures/offline-network-guard.js'` before each npm test command. Focused command:

```sh
node --import ./services/orion-fx/tests/fixtures/offline-network-guard.js --test --test-isolation=none services/orion-fx/tests/quant-v3-4-c.test.js
```

The root run includes foundation, C2, C3, C4, A, B, C, financial ledger and durable risk files. Full runs completed successfully; their file-unit totals must not be presented as individual-case counts. The initial focused development run passed 25 cases; final focused run passed 28 after adding calendar/empty-window checks. These reruns are not additional unique cases.

Logs: `/tmp/orion-c-root-tests.log`, `/tmp/orion-c-service-tests.log`, `/tmp/orion-c-focused-final.log`. `git status -sb`, `git diff --check`, `git diff --stat`, and `git ls-files --others --exclude-standard services/orion-fx/` were inspected after completion. Two tracked files changed (6 insertions); seven new files are untracked. No tracked financial reference test was changed. The pre-existing untracked Freqtrade directory remains present. No files were staged, committed or pushed.

Acceptance remains **PARTIAL** despite passing regression: authenticated transport receipts, appendable F2 identity/cursors, actual publication-time evidence and genuine forward executable quotes remain unfinished. Passing engineering tests does not satisfy those gates.
