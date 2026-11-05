# Orion — Architecture Decision

## ADR-001: isolated engines and explicit ownership
**Status:** Proposed, pending upstream code review.

- Freqtrade remains upstream-managed, independently deployed, initially crypto spot dry-run.
- Hummingbot is *not launched* in the initial milestone; its eventual deployment is conditional on specific market-making or connector needs.
- Forex/MetaTrader 5 is an independent demo-only adapter, to be created using documented interfaces, not copied AI-bot code.
- Orion owns dashboard composition, global risk limits, engine status, access control and audit events. Avoid routing orders through HTTP dashboard endpoints.
- One account+venue+symbol allocation has exactly one execution owner. Ownership leases and order reconciliation are future work, and required before execution.
- Failure defaults to **deny**. Milestone 1 exposes **no broker credentials, no connectable execution adapter, no live mode**.

## Ports and adapters
Planned ports: MarketDataPort, StrategyControlPort, ExecutionStatusPort, PositionReadPort, RiskPolicyPort. Only **static capability descriptions** and local validation are implemented now.

## Data flow (future)
Market feed -> assigned trading engine -> risk controls -> engine-specific executor -> account; engine status/events -> Orion ingestion -> dashboard.

## Security
Keep Freqtrade API on loopback/private Docker networking; never map it to 0.0.0.0 host. No API keys with withdrawal rights. Do not assume services imply automatic GPL license compatibility. Any distributed combined derivative requires separate legal review.
