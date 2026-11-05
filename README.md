# Orion Trading Engine — Milestone 1 Foundation

Safe research-only scaffold for integrating Freqtrade (primary crypto), optional Hummingbot and later an independent MetaTrader 5 demo connector. **No exchange integration, keys, live trading, paper fill simulation or dashboard UI is implemented here.** No real orders can be submitted.

## Prerequisites (Arch Linux)
- Node.js 22+ and npm (`sudo pacman -S --needed nodejs npm`)
- Optional Docker / Docker Compose (`sudo pacman -S --needed docker docker-compose`)

## Local run
```bash
npm test
npm run check
npm start
# In a different terminal:
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/capabilities
```

## Optional Docker run
```bash
docker compose up --build
```
This only starts the placeholder foundation status API; it does **not** start Freqtrade, Hummingbot or MT5. Docker runs as non-root with a read-only root filesystem and host-loopback-only port mapping. Tag `node:22-alpine` should be digest-pinned before production usage.

## Project files
- `docs/01-repository-audit.md`: preliminary audit, reusable capability matrix and inspection checklist.
- `docs/02-system-architecture.md`: ADR and service boundaries.
- `docs/03-domain-contracts.md`: proposed normalized contracts.
- `src/contracts.js`: zero-dependency prototypes for Signal and OrderIntent.
- `src/risk.js`: fail-closed guard; hard-blocks all orders.
- `src/server.js`: health/capabilities read-only API; orders endpoint always forbidden.
- `.github/workflows/ci.yml`: GitHub Actions unit-test workflow.
- `compose.yaml`: safe skeleton for running local status API.

## Milestone status
Foundation scaffold: implemented. Upstream source audit: **pending repository cloning and code-level inspection**. Deployment to an external machine: not tested. Next step is upstream verification and Freqtrade dry-run integration after inspection. Production use forbidden.
