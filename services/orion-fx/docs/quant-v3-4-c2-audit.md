# V3.4-C2 baseline audit

Recorded before implementation, HEAD 725e6131876b2bcd36c98e25b0def2a2e7a94387.
Working tree: pre-existing untracked services/freqtrade/scripts/; excluded from work.

- TESTED BY INSPECTION: F2 strategy-candle-v1 configuration binds sessionId, full normalized dataset contentHash, calendar validation hash (including asOf), declared strategy/config and caller options. STRATEGY_DECLARED stores that configuration in SQLite. Reopening requires exact canonical equality.
- TESTED BY INSPECTION: fixed datasets remain immutable. journal-operations creates a sealed snapshot manifest binding run ID, watermark, prefix head and candle-array hash. Newly appended records remain pending outside that watermark.
- TESTED BY INSPECTION: forward journal v1 genesis is the sealed journal.json digest. Each record digest hashes a canonical object including sequence, previous digest, ingestion time, candle content hash, state and complete observation evidence. Inspection verifies all record files, gapless numbering, prior digests, source-content equality, candle completion, calendar and interval continuity. Identical timestamp/content is idempotent; changed content is quarantined. These are local consistency checks, not source authentication.
- TESTED BY INSPECTION: completed candles are accepted records in sequence order; quarantined revisions prevent paper processing. F2 checkpoints index normalized candles from zero.
- TESTED BY INSPECTION: progress is the count of STRATEGY_CHECKPOINT events. Each holds index, trace-plan hash and pending intent. Pending IDs bind configuration hash, candle index and signal; pending records include next eligible time and risk identity.
- TESTED BY INSPECTION: appendPlanned uses BEGIN IMMEDIATE, validates/reprojects candidate events, inserts every effect plus checkpoint, then COMMIT with synchronous=FULL and DELETE journaling. An exception rolls back. Recovery verifies every checkpoint and financial effect against bounded prefix reconstruction and compares exact USD8, position, trades, ledger and persistent risk state.
- TESTED BY INSPECTION: four account commits are independent. The bridge advances laggards toward a bounded common target; there is no cross-account transaction.
- TESTED BY INSPECTION: append is prevented by full dataset identity and fixed watermark, not by a missing SQLite atomicity facility. No financial schema replacement is required to add an explicit new checkpoint event and identity policy.
- TESTED BY INSPECTION: execution uses close-N signal and later observed open; no implicit end-of-data liquidation. Durable PAUSED/HALTED states latch. Receipt CLI imports offline evidence and never promotes it to authenticated forward evidence. No authenticated acquisition is needed for this checkpoint.

Implementation policy: introduce explicit appendable identity and checkpoint versions. Never reinterpret or migrate fixed accounts implicitly. Bind the verified journal genesis plus semantic source-code digest, strategy/risk/execution/calendar configuration; exclude mutable head/asOf. Store per-candle source commitment and pending identity in the same SQLite checkpoint transaction as financial effects. Keep v1 journal encoding and all verification checks.

## Implemented contract review

IMPLEMENTED: appendable mode uses its own session/file identity and checkpoint event. A fully verified observations.v1 chain feeds a domain-separated appendable commitment overlay; the original immutable files remain untouched. The consumed prefix is anchored in SQLite with pending intent and effects. Source/strategy/risk/execution/calendar changes reject recovery. The validation clock may advance without changing identity.

IMPLEMENTED: source hashing covers the transitive financial execution modules and conservatively includes other JavaScript in those module directories. It excludes datasets, credentials, research artifacts and Freqtrade. Updating any included source requires a new run or a future explicit reviewed migration. A content-addressed genesis identifies a logical journal, so identical copies intentionally share identity.

TESTED acceptance evidence is recorded in the companion delivery after execution. No existing fixed account is migrated; older binaries reject the new checkpoint event. No SQLite schema identifier was repurposed. Exactly-once scope is each local account/candle financial transaction, conditional on verified journal availability and intact local storage. Recovery audit events may append on a status/reopen and are excluded only from financial-mutation comparisons, never from integrity verification.

PARTIAL: exhaustive denial instrumentation for filesystem and raw-network syscalls is outstanding. A local SHA-256 chain is not independent source authentication, a remote anchor or protection against coordinated hostile replacement of database plus journal. Neither protected-holdout state nor readiness is inferred from this checkpoint.
