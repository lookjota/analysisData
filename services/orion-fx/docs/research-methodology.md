# Método de pesquisa

Objetivo: hipóteses rejeitáveis, registro completo e capital preservado. Não
selecionar resultados positivos nem remover perdas. Estratégias atuais são
hipóteses Trend EMA, Mean Reversion BB/RSI, Breakout de máximas/mínimas anteriores,
MA Cross SMA e controles No Trade/Hold. Todas dependem de ATR para stops e
warm-up conservador comum; períodos curtos podem passar sem trades. MA Cross
é SMA, Trend é EMA: não assumir equivalência.

Buy-hold legado = long com stop/alvo ATR e reentrada, agora alias explícito
risk-managed-hold. Benchmark `passiveHold` compra unidades inteiras sem leverage
na segunda abertura, após primeiro candle fechado; vende no último close. Sem
stop/alvo/reentrada ou seleção ATR, custos idênticos; reserva notional como margem.
É exposição passiva EUR/USD nesta convenção USD, não investimento com juros ou
produto contratual de corretora. Sem dados suficientes/capital, falha explícita.
CLI: `npm --prefix services/orion-fx start -- backtest --strategy passive-hold-benchmark`.

Para nova hipótese: registrar motivação econômica, contrato, parâmetros fixados,
warm-up, regime esperado, custo, turnover, risco e critério de rejeição antes de
avaliar holdout. Poucas operações, custo maior que edge, deterioração OOS,
instabilidade de parâmetros ou dependência de poucos ganhos devem impedir uma
conclusão favorável. Limiares precisam ser definidos antes da seleção.

Prioridade futura: filtros de regime/volatilidade nas hipóteses existentes, não
multiplicação de estratégias ou ML obrigatório. Stress sintético testa mecânica,
não probabilidade real de sobrevivência. Compare lucro, exposição e drawdown
com contexto; sem ranking definitivo. Testes de estratégia: `research.test.js`,
`quant-v2.test.js`. Experimentos são executáveis em `experiments/quant-v2.js`;
aceitação exige manifesto e nenhum acesso externo.
