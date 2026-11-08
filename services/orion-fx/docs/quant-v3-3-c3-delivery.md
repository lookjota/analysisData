# V3.3-C3 delivery — PARTIAL

IMPLEMENTED: durable single-file session manifest/results; semantic experiment identity; strict runtime/source identity including working-tree bytes; atomic exclusive publication; idempotence/conflict checks; inspect/verify/replay offline commands; descriptive statistical diagnostics and governance warnings; original accounting/comparison reuse.

PARTIAL: broader security/fault-injection matrix, complete typed schema validation, explicit active-period statistics and durable registry status integration. PENDING: session-aware HTML/text reporting, cross-session recorded reuse index, replay event history, crash recovery tooling and dependence-aware intervals. No statistical significance or readiness promotion is implemented or claimed. No external dependency or telemetry added. BLOCKED: none; remaining features are documented engineering work.

## Commands from repository root

```sh
INPUT=services/orion-fx/data/capital-demo/v33b-registry/sha256-7d270873ef59f50a8f3a05c6f3bfc6b644503309cfb9c4599b1f850a0de83f17.json
node services/orion-fx/cli/index.js research:session:create --input "$INPUT" --out services/orion-fx/research-sessions
SESSION=services/orion-fx/research-sessions/session-3c7dca39f048e5edc8528f3d0d3e89bf77b1e2646c8a336225e83775c8f47b2d.json
node services/orion-fx/cli/index.js research:session:inspect --session "$SESSION"
node services/orion-fx/cli/index.js research:session:verify --session "$SESSION" --input "$INPUT"
node services/orion-fx/cli/index.js research:session:replay --session "$SESSION" --input "$INPUT"
```

Create supports `--cost-stress true`, `--walk-forward rolling|expanding`, `--smoke true`. Defaults: all four built-ins, baseline costs, no walk-forward, no smoke override. Effective strategy parameters and all fixed accounting/risk settings are stored; the CLI does not expose arbitrary capital/risk/parameter overrides. Exported API accepts the same bounded options as compareStrategies. The output directory's parent must exist; directory must be private and contain no symlink components.

Session identity changes after runtime source changes. The example SESSION refers to the actual acceptance artifact, not a universal constant. Each bundle includes complete manifest and results; generated files are ignored. Verify and replay require explicit input path and compare the recorded exact historical identity; input location itself is informational and not hashed.

## Real-data acceptance — IMPLEMENTED

Local 1,053-candle EUR/USD H1 artifact, dataset ID sha256-7d270873ef59f50a8f3a05c6f3bfc6b644503309cfb9c4599b1f850a0de83f17.

Actual session: session-3c7dca39f048e5edc8528f3d0d3e89bf77b1e2646c8a336225e83775c8f47b2d.

Result hash: f30960bbe6890275774be0ebc163d9ef1c0e3f9fd7130c013ea06ecf1604b5de.

Bundle hash: 4e6ad8a96e8b537a997c745d5fd0cdabef62c52366ab20f5281ad0f727c21b4e.

Create exit 0; verify exit 0, VERIFIED / NOT_PERFORMED; replay exit 0, VERIFIED / IDENTICAL with the same result hash. All four strategies recorded. All evidence INSUFFICIENT_EVIDENCE. No holdout evaluation or registry mutation; prior consumption status explicitly UNKNOWN.

## Validation

Completed test execution results are recorded below. Initial overlapping heavyweight test runs are not acceptance evidence; one superseded focused run failed at file level without an assertion diagnostic. The final focused test workload separates full baseline comparison from single-strategy cost/walk-forward replay to bound resource use.

## Files

- optimization/durable-session.js: envelope, identities, persistence, diagnostics, command implementation.
- cli/research.js: backward-compatible dispatch additions.
- tests/quant-v3-3-c3.test.js: real artifact regression, deterministic replay, publication, tampering, safe path and source-manifest checks.
- .gitignore: generated session directory exclusion (existing rules preserved).
- docs/quant-v3-3-c3-audit.md and this delivery: contracts, limitations and actual validation.

No staging, commit or push. Existing untracked Freqtrade files were left untouched.

Final focused command: `node --test --test-isolation=none services/orion-fx/tests/quant-v3-3-c3.test.js`: exit 0; 6 individual cases passed, 0 failed, 0 skipped, 59,546.407226 ms.

Final `npm test`: exit 0; 23 test files passed, 0 failed, 0 skipped, 93,411.081664 ms. Default Node isolation reports files, not the total number of assertions or individual nested cases.

Earlier, superseded attempts: two focused default-isolation runs each reported 0 passed / 1 failed file without inner assertion diagnostics; initial root suite reported 22 passed / 1 failed file; initial service suite reported 21 passed / 1 failed file. A subsequent focused no-isolation run exposed 5 passed / 1 failed individual case (REPLAY_MISMATCH in walk-forward metadata), corrected as documented in the audit. These are not counted as passing acceptance runs.

`npm run check`: exit 0, one script check successful (Node v26.13.0; orders disabled), not a test-case suite.

Final `npm test --prefix services/orion-fx`: exit 0; 22 test files passed, 0 failed, 0 skipped, 93,370.503095 ms. Final create/verify/replay processes all exited 0; replay IDENTICAL. The baseline numbers for all four strategies matched the supplied regression references exactly.

Final `git diff --check`: exit 0, no whitespace errors. `git status -sb` and `git diff --stat` inspected: two tracked files modified (.gitignore and cli/research.js), four new implementation/test/documentation files under Orion FX. Standard diff stat excludes untracked files. Pre-existing untracked services/freqtrade/scripts/ remains untouched. Generated session bundles ignored; no files staged.

Configuration digest: 7afe0a9b1d164c56e6befbe6ca5d6c4ad95b0709b68b1c93cc7f259477622dfd. Historical artifact hash: d78066cf5aabfba7b59e776a2c846353fdad96cf35a56a516ae1168f4090f2c2. Runtime implementation content digests are included in the manifest, independently of Git HEAD.
