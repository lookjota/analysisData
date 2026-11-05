# Orion — repository audit (preliminary, 2026-11-05)

## Evidence and limitations
This is an **initial documentation-based audit, not a source-code security audit**. The build environment was unable to resolve github.com during `git ls-remote`; therefore no repositories were cloned, no commit SHAs or actual latest dependencies verified, and no upstream tests were executed. Do not interpret README claims as implementation verification. Perform the offline verification checklist below on an internet-connected development machine before adoption.

## Repositories
| Repository | Repository evidence | Licensing | Proposed use | Outstanding validation |
|---|---|---|---|---|
| https://github.com/freqtrade/freqtrade | Python bot with dry-run, backtesting, FreqAI, SQLite, REST API | GPL-3.0 (repository listing) | Primary crypto directional strategy engine via official API | Pin commit, inspect execution flow, dependency audit, integration smoke tests |
| https://github.com/hummingbot/hummingbot | Python strategy/exchange connector engine, REST/WebSocket connectors, optional API repo | Apache-2.0 | Optional specialist execution engine when Freqtrade cannot meet requirements | Verify API deployment model and connector capabilities; test paper usage |
| https://github.com/flegardev/AI-bot | README *claims* MT5, Binance, paper, risk gates | All rights reserved (README) | Read-only architectural inspiration; no copied implementation | Confirm separate license permission if intended to reuse code; otherwise implement MT5 from official docs |

## Reuse matrix (claims / decisions only)
| Component | Freqtrade | Hummingbot | AI-bot | Orion decision |
|---|---|---|---|---|
| Market data | Exchange integration | CEX/DEX connectors | Declared | Freqtrade initially |
| Strategies | Yes | Yes | Declared | Freqtrade initially |
| Backtesting | Yes | Research tooling available | Declared | Freqtrade first |
| Order execution | Yes | Yes | Declared | Single engine owns an account/instrument |
| Risk | Native money management | Native order/execution controls | Declared | Per-engine defenses plus Orion global policy |
| Forex/MT5 | Not native | Not native | Declared | Own adapter via official MT5 API, demo only |
| Dashboard | FreqUI | Hummingbot Dashboard | Declared | Existing UIs initially, React later |
| Persistence | SQLite | Component-specific | Declared | Do not force consolidation early |

## Local repository inspection (run on an internet-connected machine)
```bash
mkdir -p external && cd external
git clone --depth 1 https://github.com/freqtrade/freqtrade.git
git clone --depth 1 https://github.com/hummingbot/hummingbot.git
git clone --depth 1 https://github.com/flegardev/AI-bot.git
for repo in freqtrade hummingbot AI-bot; do
  (cd "$repo" && printf '\n== %s ==\n' "$repo" && git rev-parse HEAD && git branch --show-current && git log -1 --date=iso --format='%cd %s' && find . -maxdepth 1 -iname '*licen*' -print)
done
```
Inspect LICENSE, dependency lock files, execution entrypoints and tests separately. Do not install/run AI-bot until permission and trust assessment. Never import its code into Orion without authorization.

## Source links
- https://github.com/freqtrade/freqtrade
- https://github.com/freqtrade/freqtrade/blob/develop/docs/configuration.md
- https://github.com/freqtrade/freqtrade/blob/develop/docs/rest-api.md
- https://github.com/hummingbot/hummingbot
- https://hummingbot.org/connectors/
- https://github.com/flegardev/AI-bot
