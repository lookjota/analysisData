# D/E — auditoria e plano

Baseline: feat/orion-quant-v3, 3212951358d9545febd9021abf4e0f2690ca6fc6.
Somente services/freqtrade/scripts/ preexistente não rastreado; preservado.
Processos visíveis: executor Codex desta sessão, sem outro worker identificado.
Node v26.13.0: node:sqlite disponível empiricamente. engines >=22 não garante
node:sqlite em todos os minors; nova API será opt-in e falhará explicitamente.
Baseline npm test 14 arquivos; FX 13 arquivos; check orders disabled.

Contratos inspecionados: portfolio/virtual.js VirtualPortfolio open/close/
chargeSwap/snapshot/updateTrailingStop: BigInt USD8 privado, snapshots strings,
reconciliação cash-ledger e cash-trades; mutações somente em memória.
optimization/session.js createResearchSession: freeze SHA256, consumo volátil.
paper/replay.js replay: backtest por prefixo, sem retomada; backtesting/index.js
possui risco por intenção e liquidação explícita, sem máquina durável.
risk/simulation.js assessIntent: limites de drawdown/dia/exposição e sizing.
financial/decimal.js: precisão USD8, preços/quantidades Number limitados.
market-data valida calendário/hash; reporting recebe resultado sem persistência.
CLI offline não disponibiliza armazenamento. Nenhum Date.now/Math.random nos
módulos pesquisados de cálculo/replay/pesquisa; datas derivadas dos eventos.

HIGH: ausência de journal e recovery, risco não persistente, holdout volátil.
MEDIUM: replay por recomputação não é recovery; preços/sizing Number;
compatibilidade SQLite em Node22 não verificada. LOW: ausência de snapshots.
Não há achado CRITICAL demonstrado; auditoria não exaustiva.

Decisão: SQLite nativo, sem pacote nativo externo, FULL synchronous e DELETE
journal, BEGIN IMMEDIATE, busy timeout, constraints. Append-only exigiria criar
protocolo de commit, locks entre processos e reparação de frames; evitado.
Sequência: contratos/storage → journal idempotente → projeção por portfolio →
risco persistente → registry → integração pesquisa → falhas/regressão. Sem
migração automática de memória: opt-in; ausência de histórico não será inventada.
Aceitação: duplicata, conflito, rollback, resposta perdida, reabertura, posição,
HALTED/PAUSED, corrupção, lock, precisão e registry entre processos.
Paper replay integrado, snapshots e matriz adversarial completa serão avaliados
separadamente; não declarar D/E completo sem evidência.
