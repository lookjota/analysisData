# Orion Quant V3.3-A audit

Audited baseline: branch `feat/orion-quant-v3`, HEAD `816f168`, repository `lookjota/analysisData`. The workspace initially contained an untracked `services/freqtrade/scripts/` directory. It was left untouched. No `.env` contents were inspected. No broker operation was performed.

## Existing architecture and public interfaces

- `config/index.js`: `DEMO_URL`, `loadConfig(env, { credentials })`. Pins the Demo host, rejects trading flags and invalid timeouts, and keeps credentials non-enumerable.
- `brokers/capital-demo.js`: `BrokerError`, `CapitalDemoBroker(config, { fetchImpl })`; `authenticate()`, `accounts()`, `findEurUsd()`, `market(epic)`, `candles(epic, max)`, `close()`. Private config, fetch transport and session tokens. Sanitized errors, request timeout, redirect rejection, no automatic login retry.
- `risk/index.js`: `assertReadOnlyRequest(method, path)` and `evaluateOrder()`. Endpoint allowlist; orders always denied.
- `market-data/index.js`: `spread`, `readQuote`, `readHourlyCandles`. Recent HOUR prices already support 1–1000 observations and UTC conversion. They return display quote structures, not canonical research candles.
- `market-data/historical.js`: `timestamp`, `normalizeCandle`, `validateDataset`, `importCsv`, `exportCsv`, `writeExclusive`, `FIELDS`, `csvCell`. Existing canonical EUR/USD H1 schema, SHA-256, duplicate/order/price/gap validation and CSV support. Quote-bearing candles must use JSON; CSV export intentionally rejects quote bars.
- `market-data/prices.js`: `quoteSnapshot`, `normalizeQuoteBars`, `priceModel`, `PRICE_MODES`. Independent bid/ask OHLC validation, observed/assumed spread separation and execution quality gate.
- `market-data/manifest.js`: `datasetManifest`, `verifyManifest`, `writeManifest`. Existing v1/v2 manifests bind canonical content, license declaration, acquisition time, requested period, calendar and quality metadata.
- `calendar/forex.js`: `marketSession`, `CALENDAR_VERSION`; New York 17:00 weekly convention with DST, explicit holidays and schedule exceptions. This is a declared research convention, not a verified Capital.com holiday calendar.
- Existing backtesting, strategy, optimization/research, replay, durable SQLite journal and reporting modules consume normalized candles. Their financial logic requires no redesign.

Existing CLI: `status`, `auth`, `accounts`, `discover`, `quote`, `candles [1..1000]`; offline `data:manifest`, `data:validate`, `data:generate`, `indicators`, `backtest`, `compare`, `risk:check`, `paper:replay`, `report`; durable `paper:durable:run`, `paper:durable:status`, `paper:durable:recover`, `paper:durable:report`, `paper:durable:verify`. Use `npm start --prefix services/orion-fx -- COMMAND` or the existing `demo` script, which loads the service-local environment only when the user invokes it.

Existing tests cover Demo configuration, authentication headers/body, credential serialization, rejected login, expired sessions, endpoint allowlisting, exact and ambiguous discovery, quote conversion, timeout/error sanitation, CSV/hash/manifest integrity, DST/calendar gaps, price quality, financial regression, statistics, durable recovery and reporting. The supplied 141-case regression claim was treated as an expected baseline, not evidence of live connectivity.

## Exact integration gaps at the baseline

1. Login already implements the official plaintext custom API-key password contract. It needs additional missing-header and success-response credential-echo coverage, not a replacement authentication flow.
2. Discovery returns only epic/symbol; original selected instrument metadata is discarded and contradictory pair identity is not explicitly rejected.
3. There is no bounded historical `from`/`to` broker method, chunk orchestration, pacing, requested-edge completeness check, or selected-account assertion.
4. The display candle reader does not produce canonical research candles or validate complete independent bid/ask OHLC.
5. No broker acquisition artifact binds epic, instrument metadata, original timestamps, chunks, returned coverage, canonical manifest and whole-artifact hash.
6. Existing offline CLIs accept CSV only. CSV cannot preserve observed quote bars; using it would lose spread classification. A verified JSON loader is required alongside unchanged CSV readers.
7. Existing exclusive writes do not publish a complete broker artifact atomically or anchor every parent lookup against symlink races.
8. The offline CLI defaults to a one-pip assumed spread; quote-bearing downloads need a zero added-spread default to avoid double counting.
9. There is no explicit historical download/inspection command or manual acceptance procedure.

## Official API verification

Source: [Capital.com Public API](https://open-api.capital.com/), reviewed 2026-11-08; sections Authentication, Session details, Create new session, Markets and Historical prices.

Demo uses `https://demo-api-capital.backend-capital.com`. Login is `POST /api/v1/session`, with API key header, login identifier, custom API-key password and `encryptedPassword:false`. CST and X-SECURITY-TOKEN come from response headers. Inactive sessions expire after ten minutes. Login is limited to one request per second; general requests to ten per second. Historical prices use `GET /api/v1/prices/{epic}`, HOUR resolution, at most 1000 values and UTC-based date filters. The documented wire date format omits the zone suffix; the application requires UTC Z inputs and formats UTC values into that wire format.

The broker does not offer a read-only API-key privilege. Application request allowlisting enforces read-only market/account behavior, with session creation/logout as the only permitted mutations. No order endpoint is enabled.
