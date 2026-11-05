# Orion — Contract proposal v0

Milestone 1 implements basic validation in `src/contracts.js`; this is **not yet** a complete runtime schema or production-grade decimal library.

## Proposed records
- `MarketData`: venue, instrument, observedAt, lastPrice (decimal string), source
- `Candle`: venue, instrument, openTime/closeTime UTC, OHLCV decimal strings, closed boolean
- `Instrument`: assetClass, venue, nativeSymbol, canonicalSymbol, base/quote, tickSize, lotSize
- `TradingSignal`: id, strategyId, venue, symbol, side, timestamp, confidence optional
- `OrderIntent`: clientOrderId, signalId, symbol, side, quantity, limitPrice; decimal strings
- `OrderExecution`: venueOrderId, clientOrderId, state, fillQuantity, avgPrice, fees
- `Position`: ownerId, instrument, netQuantity, costBasis, realizedPnl, unrealizedPnl
- `AccountBalance`: accountId, asset, available, locked, timestamp
- `RiskDecision`: allowed, reasonCode, policyVersion, timestamp
- `Strategy`: id, version, configHash, assignedEngine
- `StrategyExecution`: strategyId, runId, mode, startedAt, endedAt
- `BacktestResult`: dataHash, strategyHash, feeModel, slippageModel, stats
- `TradingEvent`: id, source, eventType, occurredAt, sequence, correlationId

## Domain rules
All timestamps UTC; prices/quantities decimal strings. Idempotency with clientOrderId and account/instrument ownership required. Partial fills and venue-specific precision required before execution. Avoid floating-point arithmetic for accounting. Explicit environment labels `paper`, `demo`, `live` only in future approved deployments. Milestone 1 never permits `live`.
