# Auditoria P0 V3.1

Baseline: branch feat/orion-quant-v3; HEAD c785bba34ed4db81fc4d3de337d5ff8ca43775d3.
Somente services/freqtrade/scripts/ não rastreado preexistente. Nenhuma leitura
.env, autenticação, Docker, staging, commit ou push. Arquivos solicitados existem.
Inspecionados finanças, testes contábeis, calendário, manifestos, importador,
backtest, risco, pesquisa, replay e CI antes das alterações.
Baseline npm test: 10 arquivos aprovados. Testes FX individuais também executados.

## Achados comprovados

| Severidade | Arquivo/função | Problema, evidência e reprodução | Consequência | Teste e correção | Risco de regressão |
|---|---|---|---|---|---|
| HIGH | portfolio/virtual.js / APIs públicas | position, ledger, trades e initialCapital são propriedades graváveis; após open, atribuir position.units altera exposição e PnL | resultados financeiros adulterados | testar mutação externa; campos privados, cópias defensivas e API explícita de trailing | consumidor que dependia de mutação pública deve migrar |
| HIGH | portfolio/virtual.js / #record, open, close | cash é alterado antes de ledger.push; congelar ledger externamente e abrir posição lança após debitar comissão | booking parcial | reproduzir freeze e overflow, preparar todos os valores antes do commit interno | ordem e formato JSON devem permanecer |
| HIGH | portfolio/virtual.js / open | margem e comissão superiores ao cash são aceitas diretamente | API pública pode criar posição sem capital suficiente | testar rejeição atômica; comparar USD8 antes de booking | contas negativas continuam permitidas após perdas, novas entradas são rejeitadas |
| HIGH | market-data/historical.js / closedHour | fechamento semanal usa UTC22 constante, manifesto usa NY17 com DST | classificação inconsistente de gaps no verão | cenário sexta21Z/domingo21Z; integrar calendário explicitamente | hashes v1 e warnings existentes |
| MEDIUM | portfolio/virtual.js / snapshot | permite marca anterior ao último evento | fotografia anacrônica com estado futuro | testar timestamp anterior; rejeitar | consumidores de snapshots históricos devem usar replay |
| MEDIUM | financial/decimal.js / usdNumber | USD8 próximo ao limite pode perder unidade na conversão para Number | valores JSON aproximados e rebooking impreciso | teste de fronteira; preservar inteiros internamente e documentar fronteira Number | contrato numérico existente |

## Limitações de modelagem, não defeitos comprovados

- Margem fixa na entrada, uma posição e stop-out por abertura: modelo simulado,
  não regra de corretora; intrabar e liquidação parcial não suportados.
- Dados mid H1; bid/ask OHLC rejeitados explicitamente. Falta schema apropriado.
- Walk-forward usa contas independentes e warm-up frio explicitamente documentado.
  Holdout possui somente intervalos, sem controle de consumo/acesso.
- Replay recomputa prefixos; não há journal, snapshots persistentes ou recovery.
- Risco usa flags locais, sem estados administrativos persistentes.
- Manifestos são opcionais e não acompanham automaticamente relatórios/importação.
- CI existente Node22 executa raiz/check; matriz e gates adicionais pendentes.

Essas limitações impedem declarar V3.1 completa. Ordem de continuidade:
concluir integridade financeira, margem, dados/calendário, OOS/holdout,
breakers, persistência, CI/experimentos. Nenhuma alegação de trading real.
