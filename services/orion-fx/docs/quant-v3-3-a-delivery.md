# Orion Quant V3.3-A delivery

Implementation status: implemented, with offline verification recorded below. Real Demo session authentication and real historical acquisition remain **UNVERIFIED** until the user runs the manual acceptance commands. The previously confirmed encryption-key response does not establish either result.

## Changes and interfaces

Existing authentication, discovery, validators, canonical hashing, manifests, strategies and financial engine are reused.

- Broker adds `verifyContext(expectedAccountId)` using allowlisted GET session details and `historicalCandles(epic, { from, to, max })`. Existing `findEurUsd({ metadata:true })` optionally retains original selected market metadata, while its default result remains compatible. Conflicting pair fields are rejected. Successful broker payloads containing configured credentials, active tokens or authentication field names fail closed before export/output.
- `market-data/capital-history.js` exports `historyRange`, `parseHistoricalPrice`, `acquireHistory`, `verifyHistory`, `saveHistory`, `importDataset` and `safePath`.
- `history:download` explicitly authenticates, verifies the expected account, discovers EUR/USD, downloads, validates and stores. It never evaluates a strategy. `history:inspect` verifies and summarizes a local artifact without credentials or network.
- Offline and durable CLIs accept verified `.json` acquisitions in addition to existing CSV. Backtest/report and durable replay inherit the stored calendar, acquisition/license metadata and requested period. Quote bars select the existing observed bid/ask model. Offline assumed spread defaults to zero only when quote bars are present; explicitly adding spread still reaches the existing rejection gate.
- Local `data/capital-demo/` acquisitions are ignored by Git. No datasets were downloaded during implementation.

## Authentication and security

The unchanged login contract uses `CAPITAL_API_KEY`, `CAPITAL_IDENTIFIER` (the account login identifier/email) and `CAPITAL_API_PASSWORD` (the API-key custom password, not the normal account password). Login sends `encryptedPassword:false`; HTTPS is mandatory through the pinned Demo origin. Session headers stay in private in-memory fields. No session persistence, token output, arbitrary HTTP interface, automatic reauthentication or retry is provided. A rejected login produces a fixed error code; a subsequent 401 discards the session. Logout clears local tokens even on failure.

`CAPITAL_ENV=demo`, the exact Demo URL and `TRADING_ENABLED=false` remain mandatory. Live/order execution flags are rejected if enabled. The allowlist permits POST/DELETE session, GET session/accounts/markets and validated market/price epic paths only. Redirects and arbitrary hosts are forbidden. Download requires `CAPITAL_EXPECTED_ACCOUNT_ID` and rejects a different current account before discovery. Account identifiers are not included in the acquisition artifact. Environment identity is established by the pinned HTTPS origin; the session API does not supply an independent demo-mode attestation.

Errors never print upstream bodies, headers, exception stacks, URLs or credentials. The service-local `.env` was neither read nor changed. No orders, Live requests, Docker changes, Freqtrade changes, commits or pushes occurred.

## Market data and provenance

Inputs are explicit UTC ISO strings ending in Z, aligned to H1, with an exclusive end boundary. The range is 1–100000 hours, ending no later than the acquisition operation's captured clock. Wire requests use inclusive first/last bar-open dates, in disjoint windows of at most 1000 hours, `resolution=HOUR`, and `max` equal to the window's hours. Reads are paced at 200 ms by default, with a 100 ms minimum. No retry is attempted, including on 429 or expired session.

Every price becomes an existing canonical candle: EUR/USD, H1, UTC bar-open timestamp, positive finite midpoint OHLC, optional nonnegative source volume, `source=Capital.com Demo historical API`, `synthetic=false`, and original independent bid/ask `quoteBars`. Midpoint extrema are derived averages of side extrema, not independently observed mid-tick extrema. Source UTC and broker-local timestamp strings are preserved separately without interpreting local timestamps. The strict UTC field controls normalization.

The existing price validator checks each side's OHLC and contemporaneous open/close spread. Acquisition additionally rejects crossed high/low aggregate bounds; differences of side extrema are not reported as contemporaneous spreads. No universal maximum positive spread is invented. The existing research quality controls govern executability. Observed spread is classified `CONTEMPORANEOUS_OPEN_CLOSE_ONLY`; H1 aggregates make no tick freshness claim.

Duplicate, unordered, out-of-range, future/incomplete and malformed bars fail. Missing open-market hours fail across the entire requested range, including its edges and empty/partial chunks. Declared weekly closures may be absent and are counted without fabricating candles. No sorting, deduplication, interpolation or filling occurs. Empty datasets fail.

The JSON artifact `orion.capital-history.v1` contains `candles`, the existing verifiable `orion.dataset-manifest.v2`, and `acquisition`: source, Demo environment, discovered epic, original selected instrument metadata, resolution, acquisition clock, requested/returned bounds, original timestamp strings, chunk requests/counts, calendar identity, warnings, closure count and spread classification. Existing canonical SHA-256 includes quote bars. A separate SHA-256 `artifactHash` covers the complete serialized body, including acquisition metadata. Hashes detect alteration; they are not proof of broker authenticity. License remains `unverified`, redistribution false. Real/synthetic labels are checked on offline reuse.

CSV readers/schema and legacy manifest/hash algorithms remain unchanged. JSON preserves information CSV cannot represent; no lossy CSV is created automatically. In-memory normalized candles work with existing backtesting, strategies, calendar, price quality, statistical research, replay and reporting APIs. Durable replay keeps its existing maximum of 1000 candles. The acquisition artifact retains the full source metadata; research reports retain the canonical dataset manifest, not the complete acquisition envelope.

## Storage

Output must name a new `.json` file in an existing directory. File mode is 0600. A same-directory exclusive temporary file is written and fsynced, then published by atomic hard link without overwriting any existing name. The directory is fsynced; temporary files are removed on normal failure. Every parent directory is opened using O_DIRECTORY/O_NOFOLLOW and anchored through Linux `/proc/self/fd`; the final input file is opened O_NOFOLLOW and regular-file/size checked. Thus changed parent symlinks cannot redirect the operation. This secure storage implementation requires Linux with procfs and same-filesystem hard-link support; it fails closed elsewhere. Hard crashes can leave a private temporary file, but never expose a partially written final artifact. JSON input is capped at 128 MiB and canonical validation at 100000 records.

## Exact CLI and manual acceptance

Run these yourself from `~/Downloads/orion-trading-engine`. Configure the service-local environment in your own editor: correct Demo API key, login identifier, API-key custom password, and false trading flags. Never paste credentials into command arguments or shared logs. For download, also set `CAPITAL_EXPECTED_ACCOUNT_ID` to the intended Demo account ID. The existing `accounts` command can help you identify the intended account locally; account listings should not be shared.

First explicit Demo session login (logs out afterwards, prints no tokens):

```sh
npm run demo --prefix services/orion-fx -- auth
```

Expected success: authenticated true, environment demo, tradingEnabled false, exit zero. On failure, inspect the configuration locally; no login retry occurs automatically.

Optional explicit read-only account listing and exact discovery:

```sh
npm run demo --prefix services/orion-fx -- accounts
npm run demo --prefix services/orion-fx -- discover
```

First explicit EUR/USD H1 download, three completed weekday bars, end exclusive:

```sh
mkdir -p -m 700 services/orion-fx/data/capital-demo
npm run demo --prefix services/orion-fx -- history:download --from 2026-11-02T00:00:00Z --to 2026-11-02T03:00:00Z --out data/capital-demo/eurusd-h1-20261102.json
```

The download command creates its own session, verifies the configured account and discovered epic, then closes the session. Expected success: saved true, count 3, canonical hash and quality metadata. A repeated destination fails before login. Change dates/output name for later acquisitions. If the broker lacks any required hour, no artifact is published. Remote logout failure yields nonzero even if a complete artifact was already saved; inspect it locally instead of retrying blindly.

Offline validation and inspection (these scripts do not load `.env`):

```sh
npm start --prefix services/orion-fx -- history:inspect --input data/capital-demo/eurusd-h1-20261102.json
npm start --prefix services/orion-fx -- data:validate --input data/capital-demo/eurusd-h1-20261102.json
npm start --prefix services/orion-fx -- data:manifest --input data/capital-demo/eurusd-h1-20261102.json
```

Separate optional strategy/research operations; use a suitably long independently acquired dataset for meaningful research:

```sh
npm start --prefix services/orion-fx -- backtest --input data/capital-demo/eurusd-h1-20261102.json --strategy no-trade
npm start --prefix services/orion-fx -- paper:replay --input data/capital-demo/eurusd-h1-20261102.json --strategy no-trade
npm start --prefix services/orion-fx -- paper:durable:run --input data/capital-demo/eurusd-h1-20261102.json --session capital-demo-example --strategy no-trade
```

`history:download --help`, `history:inspect --help` and the existing offline command help describe supported arguments. All previous CLI commands remain available. Real acceptance requires you to confirm successful login, account/discovery identity, successful H1 retrieval and offline manifest/hash checks; it remains UNVERIFIED here.

## Automated validation

All broker interactions in tests are mocked. Tests cover authentication body/header contracts, rejected password/key, both missing-token headers, expired sessions, error and successful-response sanitation, endpoint/order blocking, exact/ambiguous/conflicting discovery, expected account mismatch, H1 parsing, UTC/calendar overflow/alignment, DST closure, missing/duplicate/unordered/out-of-range/partial responses, chunk limits/pacing, bid/ask OHLC/spreads, canonical/provenance hashes, offline research/report and durable recovery, exclusive/private writes and ancestor/final symlink rejection. Existing regression tests cover statistics, calendars, journal integrity and financial behavior.

Results are recorded after final execution below. No real network operation belongs to a test or check script.

## Remaining limitations

Real login, actual account context, instrument metadata, API date-boundary behavior, historical availability and acquisition remain UNVERIFIED. The official contract is implemented conservatively; unexpected/truncated responses fail closed. The research calendar is a declared NY17 convention, with no broker holiday entitlement/schedule fetch. Additional holidays/maintenance may cause strict download rejection and require future explicit source-calendar configuration. There is no auto-resume, retry, keepalive, session refresh, holiday interpolation, tick freshness or redistribution authorization. The example dataset is a transport acceptance sample, not statistical evidence. Broker keys themselves are trading-capable; safety is enforced in this client. Nothing in this delivery enables external execution.

## Changed files

| File under `services/orion-fx/` | Purpose |
| --- | --- |
| `brokers/capital-demo.js` | Context assertion, bounded history method, optional instrument metadata, identity and credential-echo checks |
| `risk/index.js` | Allow read-only GET session details |
| `market-data/capital-history.js` | Acquisition, canonical conversion, provenance envelope, verified loader and secure storage |
| `cli/history.js` | Explicit download and offline inspection |
| `cli/index.js` | Dispatch new explicit commands |
| `cli/offline.js` | Verified JSON input, inherited manifest/calendar and observed-spread default |
| `cli/durable.js` | Verified JSON input/provenance, existing CSV journal identity preserved |
| `data/.gitignore` | Keep local broker acquisitions out of Git |
| `tests/capital-history.test.js` | Mocked acquisition/security/storage/offline/legacy-recovery coverage |
| `tests/orion-fx.test.js` | Existing allowlist test recognizes read-only GET session details |
| `docs/quant-v3-3-a-audit.md` | Baseline audit and exact gaps |
| `docs/quant-v3-3-a-delivery.md` | Delivery, commands, verification and limitations |

## Final recorded results — 2026-11-08

- `npm test`: PASS, 18/18 test files, exit 0.
- `npm test --prefix services/orion-fx`: PASS, 17/17 test files, exit 0.
- `npm run check`: PASS, Node v26.13.0, orders disabled, exit 0.
- `node --test --test-isolation=none`: PASS, 169/169 individual cases, zero failures/skips/cancellations. This comprises the 141-case repository baseline plus 28 new acquisition/integration cases. Node 26's default isolated reporter counts files; the additional run makes individual-case totals explicit.
- `git diff --check`: PASS. Tracked changes are confined to Orion FX; no staged changes, no Freqtrade or Docker modifications. The original untracked Freqtrade scripts directory remains present and untouched.
- Branch remains `feat/orion-quant-v3`; HEAD remains `816f168`. No commit or push.

Implementation acceptance: **COMPLETE** for the requested offline-tested Demo/read-only integration. Real broker session authentication and real H1 acquisition: **UNVERIFIED**, pending the user's explicit manual acceptance.
