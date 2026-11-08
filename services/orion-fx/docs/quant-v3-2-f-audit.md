# Checkpoint F — auditoria e plano incremental

Baseline: feat/orion-quant-v3, d96ddce. Node v26.13.0. npm test 15 arquivos,
FX 14 arquivos e npm run check aprovados antes de alterações. Não rastreado
preexistente services/freqtrade/scripts/ preservado. Nenhuma credencial acessada.

| Problema / evidência / função | Severidade | Invariante / reprodução | Correção / regressão / dependência |
|---|---|---|---|
| replay.js replay chama backtest por prefixo; não abre journal | HIGH | reiniciar não pode apagar posições; replay não possui recovery | API opt-in incremental; preservar legado; depende journal |
| journal.submit grava um efeito por transação | HIGH | decisão, custo e risco precisam confirmar juntos; falha entre submits | planner dentro de BEGIN IMMEDIATE; risco de regressão D/E; testes SQLite |
| journal não guarda identidade financeira da sessão | HIGH | reopen incompatível deve rejeitar | declaração persistida; manter schema v1 compatível com eventos antigos |
| risco persistido só por comando manual | HIGH | perda após mark deve bloquear entrada e sobreviver reinício | supervisor usando riskConfig/assessIntent/assessMargin; testar thresholds |
| journal não mantém cache, portfolio reconcilia snapshot | LOW | projeção candidata nunca publica saldo sem COMMIT | reutilizar projeção; não criar ledger paralelo |
| CLI/report não expõem durabilidade | MEDIUM | relatório deve identificar modo e integridade | integração posterior; não alegar conclusão sem fluxo completo |

Mutações existentes: VirtualPortfolio.open (cash/comissão/margem/posição), close
(cash/trade/liberação de margem), chargeSwap (cash/custo), updateTrailingStop
(stop). snapshot valida ledger e trades exatos. backtest mantém pending, peak,
dayStart, blockedDay e halted em memória; replay recomputa tudo por prefixo.
Batch aceita closeAtEnd; replay usa false nos prefixos e configuração final no
resultado. Reinicialização existente só ocorre via journal.recover, sem estratégia.

Plano: contrato durável → planner atômico → identidade lógica → supervisão →
transições persistentes → fail-closed → recovery/lifecycle → CLI/report → matriz.
Cada incremento exige teste focado antes de avançar. Estratégia/pending, calendário,
trailing e custos por candle exigem integração própria; não serão presumidos.

Verificação final: gates root (16 arquivos), FX (15 arquivos), check e diff-check
aprovados. Contagem explícita FX: 117 casos, dos quais 13 novos F. A baseline de
113 fornecida no pedido não foi confirmada pelos comandos padrão, que reportaram
arquivos; esta entrega não soma a baseline informada aos novos casos para alegar
uma contagem inexistente. Escopo final PARTIAL: pipeline explícito integrado ao
journal; executor de estratégia/CLI e matriz completa ainda pendentes.
