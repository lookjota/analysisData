# V3.2 B/C — auditoria prévia e dependências

Baseline: feat/orion-quant-v3, HEAD 85d96315389bdb675d61ab10a3967808c4644cef.
Node v26.13.0. npm test: 12 arquivos; FX: 11 arquivos; check: orders disabled.
Único trabalho local anterior: services/freqtrade/scripts/ não rastreado, preservado.
Lidos relatórios hardening V3.1 e V3.2 audit/delivery, contratos e testes.
Sem leitura de credenciais, .env ou conteúdo Freqtrade.

Arquitetura: normalização → validação/calendário/hash → backtest/prefixo fechado
→ intenção de risco → preço → portfolio privado USD8 → métricas/relatório.
Benchmark separado reutiliza portfolio. Pesquisa recebe array completo e fatia
train/test. Não há guard de holdout. Indicadores são funções causais sobre arrays.

| Tipo / risco | Arquivo / função | Contrato atual e evidência | Impacto quantitativo | Correção / teste | Regressão |
|---|---|---|---|---|---|
| MISSING_FEATURE HIGH | market-data/historical.js normalizeCandle | bid/ask sempre lança BID_ASK_OHLC_NOT_SUPPORTED | spread real indisponível; estimativa pode dominar PnL | schema OHLC separado, hash com quotes; validar extremos sem cruzar high/low | CSV/hash v1 |
| MISSING_FEATURE HIGH | execution/prices.js executionPrice/protectiveFill | somente mid com spread fixo | cotação não executável pode parecer real | modos explícitos e OHLC do lado de liquidação; oráculos long/short | stops/gaps |
| BUG MEDIUM | backtesting/index.js fillCosts | produtos Number antes USD8 | arredondamento informativo inconsistente | usdProduct; reconciliação independente | campos informativos |
| MISSING_FEATURE HIGH | backtesting/passive.js passiveHold | validateDataset(rows) sem opções; sem manifesto | divergência temporal com estratégia | mesmos contratos de validação/proveniência/preços | uma entrada/saída |
| LIMITATION HIGH | optimization/research.js evaluateWalkForward | slice(test) com warm-up frio documentado | OOS omite decisões nas fronteiras | contexto anterior, capital reset, sem sinais contextuais pendentes | resultados OOS mudam explicitamente |
| MISSING_FEATURE HIGH | optimization/temporal.js researchSplit | apenas índices sem capacidade restrita | otimização pode consumir holdout | sessão encapsulada, freeze/hash e autorização explícita | APIs legadas continuam exploratórias |
| LIMITATION HIGH | backtesting/index.js signal | prefixo fechado congelado; callback pode capturar referências externas | código arbitrário pode vazar futuro | pesquisa aceita apenas IDs de fábrica; documentar limite local | callbacks legados |
| MISSING_FEATURE MEDIUM | reporting/index.js enrich / analytics | sem origem estatística e hipóteses bid/ask | comparações silenciosas e independência exagerada | rótulos por conjunto e alertas de reutilização/warm-up/custos | HTML/CSV |
| LIMITATION MEDIUM | financial/decimal.js / risco | ledger USD8; preços e sizing Number | fronteira de representação permanece | preservar contabilidade e rodar oráculos existentes | não reescrever ledger |

Plano dependente: B1 contrato e validação → B2 execução/custos → B3 benchmark
→ B4 adversariais/regressão → C1/C2 contexto e limites → C3 sessão restrita
→ C4 walk-forward → C5 perturbação futura → C6 relatórios e revisão.
Cada caminho deve permanecer utilizável; recursos não concluídos serão PARTIAL.
Não se promete isolamento de código hostil nem proteção contra acesso direto a arquivos.

## Revisão após implementação

- BUG informativo adicional: spread intrabar observado não é recuperável dos
  extremos OHLC independentes. Fills protetivos agora registram spreadCostUsd=null
  e UNKNOWN_AT_PROTECTIVE_LEVEL; nunca atribuem spread observado de abertura
  ao instante desconhecido de stop/target. PnL usa o lado executável, sem débito
  separado de spread. Teste dedicado reproduz stop intrabar observado.
- LIMITATION HIGH remanescente: guard e registro de consumo são locais à instância,
  em memória. Reinício/nova instância não identifica consumo anterior. Uma identidade
  congelada não substitui armazenamento durável nem registro independente.
- LIMITATION MEDIUM: snapshots de tick têm freshness validável; candles H1 não
  comprovam freshness de ticks. Não se tenta deduzir spread intrabar completo.
- LIMITATION MEDIUM: callbacks livres do backtest podem capturar referências do
  chamador. A pesquisa protegida e walk-forward aceitam somente IDs/parâmetros de
  estratégias da fábrica; não recebem callbacks de otimização do chamador.
- LIMITATION MEDIUM: custos/preços executáveis e sizing ainda usam Number;
  booking permanece USD8 com produtos decimais e reconciliação independente.
  Não há liquidez/capacidade histórica modelada nem execução real.

Caracterização: regressão existente executada antes de editar; novos cenários de
preço exercitados durante B; suíte C inicialmente falhou por módulo de sessão
inexistente. Falhas de fixtures/índices corrigidas explicitamente, sem remover
invariantes financeiras preexistentes. Não se afirma ciclo red/green prévio para
cada cenário individual. Revisão de código realizada pelo mesmo agente, sem
alegação de auditoria humana ou independente externa.
