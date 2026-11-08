# C4 audit — PARTIAL

Baseline inspected before edits: feat/orion-quant-v3 at 822a284. Existing untracked services/freqtrade/scripts/ is outside scope.

IMPLEMENTED: verified C3 architecture. durable-session.js persists exactly one envelope (manifest and results together), not separate result files. Sorted-key JSON SHA256 retains array order and JSON numeric rendering; JSON projection drops undefined properties. Session ID hashes manifest; resultHash hashes results; bundleHash hashes the remaining envelope. Implementation identity hashes runtime JS and Node version. Replay requires the exact implementation identity. No migration or source-identity exception is authorized.

Publication uses exclusive 0600 UUID temporary file, file fsync, exclusive hard link to session-ID path, directory fsync, temporary unlink. Concurrent existing identity requires matching validated bundle hash. A crash before link leaves an incomplete orphan; after link may leave a complete final and an orphan. No metadata transaction exists. Current cleanup unlink is not followed by directory fsync; directory ancestors must be trusted against concurrent replacement. No automatic evidence deletion is appropriate. Power-loss guarantees depend on local filesystem hard-link and fsync support.

Historical reads use anchored parent descriptors and O_NOFOLLOW; history verification checks artifact and dataset hashes. Comparison verifies history, slices away final holdout before backtesting, uses existing ledger, independent accounts and fixed candidates. Financial journal uses SQLite FULL synchronous transactions, strict event schemas and holdouts keyed by scope digest. Existing openJournal is write-capable (DDL and PRAGMAs), unsuitable for a read-only status query. Holdout states are RESERVED and CONSUMED; valid empty scope can mean UNUSED only in an explicitly selected verified registry. Missing registry is UNKNOWN. Scope binds dataset hash, schema, split definition and methodology, not merely a dataset filename.

Existing HTML escapes user strings; it has no session provenance. Root ignore rules hide SQLite and credentials; service rules hide generated research sessions. No ignore rules changed. No credentials read.

TESTED before edits: supplied C3 session integrity VERIFIED and replay IDENTICAL; resultHash f30960bbe6890275774be0ebc163d9ef1c0e3f9fd7130c013ea06ecf1604b5de.

PARTIAL: C4 adds strict envelope/configuration gates and read-only directory inspection. Full nested financial result schema, durable experiment registry, session HTML, complete crash fault matrix and read-only holdout reader remain PENDING. Hash consistency alone is not authenticity or proof of valid financial computation. Correctly rehashed forged financial results still require replay to detect. No broad C4 completion claim.
