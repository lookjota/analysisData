# Orion Quant V3.3-C4 — PARTIAL checkpoint

This is not final C4 acceptance. No strategy optimization, financial analytics changes, dataset edits, broker integration or holdout consumption was performed. No files were staged, committed or pushed.

## Delivered — IMPLEMENTED / TESTED

- Strict version gate and exact outer envelope/manifest/configuration/candidate keys for existing orion.research-session.v1. No migration or rewriting of C3 artifacts.
- Finite JSON tree checking, prototype-key rejection, SHA256 syntax, implementation source-map digest, fixed parameter resolution and canonical strategy ordering.
- Comparison/manifest dataset, readiness, configuration and execution cross references; supported scenario ordering; candidate correspondence; positive account capital contract; nonnegative integer trade counts; canonical evaluation timestamps and chronology; first-scenario window/config correspondence; insufficient evidence gates.
- Read-only selected-directory audit/recover alias. Sorted machine-readable listing distinguishes complete self-hash-checked artifacts, invalid files, incomplete orphans, unexpected entries and unsafe symlinks. Inspection does not execute strategies, repair artifacts, remove evidence or access datasets.
- Action-specific CLI option rejection. Existing create/inspect/verify/replay syntax retained.

## CLI examples — IMPLEMENTED

From repository root:

```sh
node services/orion-fx/cli/index.js research:session:audit --directory services/orion-fx/research-sessions
node services/orion-fx/cli/index.js research:session:recover --directory services/orion-fx/research-sessions
node services/orion-fx/cli/index.js research:session:verify --session services/orion-fx/research-sessions/session-3c7dca39f048e5edc8528f3d0d3e89bf77b1e2646c8a336225e83775c8f47b2d.json --input services/orion-fx/data/capital-demo/v33b-registry/sha256-7d270873ef59f50a8f3a05c6f3bfc6b644503309cfb9c4599b1f850a0de83f17.json
```

Exit 0: operation succeeded, audit contains only complete self-hash-checked sessions (or is empty). Exit 1: input/schema/IO failure. Exit 2: audit contains incomplete, invalid, unexpected or unsafe entries. Audit JSON has schemaVersion orion.session-audit.v1, readOnly true, computationalReplay NOT_PERFORMED and artifacts. A complete self-hash check is not dataset verification or computational replay. The recover alias only inspects; manual repair policy is PENDING. Trusted directory/ancestors must remain stable during inspection.

## Acceptance evidence

TESTED before runtime edits: supplied C3 session VERIFIED and computational replay IDENTICAL, exact resultHash `f30960bbe6890275774be0ebc163d9ef1c0e3f9fd7130c013ea06ecf1604b5de`.

TESTED after edits: same C3 session VERIFIED, same resultHash and strategy order trend, mean-reversion, breakout, ma-cross. Original source-bound replay correctly returns IMPLEMENTATION_IDENTITY_MISMATCH after runtime changes. The exact implementation check is preserved; cross-version replay under C4 is BLOCKED by the intentional C3 identity policy, not bypassed. Existing C3 tests create and replay current-source sessions and assert exact financial results.

Focused C4: 1 test file passes in default file-isolation mode; explicitly enumerated with --test-isolation=none: 14 cases passed, 0 failed. Includes rehashed malformed envelope/configuration, unsupported version, missing fields, invalid flag, unexpected behavior, duplicate/invalid strategies, dataset mismatch, forged evidence, bad chronology, negative trade count, repeated read-only orphan audit, symlink classification and strict CLI.

## Remaining requirements — PENDING

- Exhaustive nested result/risk/execution/provenance/partition/walk-forward schema contracts and independent forged-financial-result detection. Present validation is a partial gate; an attacker can still rehash some internally consistent false numeric outputs. Replay remains necessary and hashes do not provide authenticity.
- Publication strengthening and the 17-case fault matrix, including actual SIGKILL, ENOSPC, EROFS, metadata interruption and independent-process conflicting writers. No new crash-safety claim. Existing C3 hard-link publication unchanged.
- Durable recorded experiment governance and history command. Research-history example: unavailable; no fabricated registry/trial counts. Historical C2 and unrecorded external experiments are unknown. Reuse counts and validation warnings remain incomplete.
- Read-only SQLite holdout query. Actual persistent status was not queried: UNKNOWN. Source of truth is journal holdouts table with validated scope/body/digest, not session manifest wording or file absence. No freshness claim. Need explicitly selected registry and scope identity; avoid write-capable openJournal. Cryptographic scope binds dataset hash, hash schema, partition definition and methodology.
- Session-aware HTML report and verification/replay provenance. Report example: unavailable; no VERIFIED or REPLAY_IDENTICAL labels added.
- C4-specific network/.env tripwires and byte-level holdout/dataset immutability snapshots. Existing safeguards/regressions are useful but not substitutes for these tests. No network or credential APIs were introduced or invoked by this implementation.

Recommended next checkpoint: finish strict nested schemas with independent fixtures, then extract/test the existing publication boundary with subprocess crashes before adding cross-file governance metadata. Do not loosen identity or financial assertions to make tests pass.

## Files

Modified: optimization/durable-session.js.

New: optimization/session-schema.js; tests/quant-v3-3-c4.test.js; docs/quant-v3-3-c4-audit.md; docs/quant-v3-3-c4-delivery.md. All paths relative to services/orion-fx/. Pre-existing untracked services/freqtrade/scripts/ untouched.

## Final validation — TESTED

- `npm test`: exit 0; 24 test files passed, 0 failed (152228.426807 ms). Default Node isolation reports files, not individual cases.
- `npm test --prefix services/orion-fx`: exit 0; 23 test files passed, 0 failed (153164.225285 ms).
- `npm run check`: exit 0; OK orion-trading-engine-foundation, Node v26.13.0, orders disabled.
- `node --test services/orion-fx/tests/quant-v3-3-c4.test.js`: exit 0; 1 file passed, 0 failed.
- `node --test --test-isolation=none services/orion-fx/tests/quant-v3-3-c4.test.js`: exit 0; 14 individual cases passed, 0 failed (30092.947687 ms).
- `git diff --check`: exit 0, no whitespace errors.
- `git diff --stat`: tracked runtime change only, durable-session.js, 34 insertions and 2 deletions; four new files are untracked and excluded from that stat.
- `git ls-files --others --exclude-standard services/orion-fx/`: exactly the four new C4 files listed above.
- `git status -sb`: branch feat/orion-quant-v3; durable-session.js modified; four new C4 files; pre-existing services/freqtrade/scripts/ remains untracked.
- `git diff --exit-code -- services/orion-fx/data services/orion-fx/research-sessions`: exit 0. This tracked-file comparison does not establish byte snapshots of ignored historical files; C3 regression separately asserts input bytes unchanged during creation/replay.

Full suites include the original C2/C3 tests without weakening them. No new runtime edits followed full-suite completion. No subprocess crash tests were added; all requested crash-injection outcomes remain PENDING. No holdout registry was opened. Status remains UNKNOWN, not FRESH or UNUSED.
