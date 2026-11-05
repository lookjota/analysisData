# Entrega Quant V2 — auditoria e incremento financeiro

## Estado do projeto

Auditoria A entregue no escopo inspecionado. B parcial e fortalecido: USD8,
reconciliação, ledger validado, benchmark passivo, custos por candle, política
intrabar e decomposição de fills. C–G parciais/pendentes. Plataforma não declarada
pronta para trading real, pesquisa conclusiva ou produção. Não houve dashboard,
CI/deploy, novas corretoras, ML ou dependências. Correções locais preservam a
fundação e seus testes. Severidades/aceitação: [quant-v2-audit.md](quant-v2-audit.md).

Achados HIGH tratados neste incremento: API do ledger sem validação, aritmética
monetária acumulativa IEEE-754 e semântica enganosa de buy-hold. Migração numérica
é parcial: indicadores/preços/sizing/exposição/margem continuam Number. HALF-AWAY
em USD8 é convenção de pesquisa, não regra de corretora. Custos contratuais e
histórico real não foram verificados. Nenhum CRITICAL confirmado; diversos HIGH
continuam abertos no modelo de dados/execução/estatística.

## Arquivos adicionados (+) e alterados (~)

Todos sob `services/orion-fx/`; a pasta inteira já era não rastreada no início.
A árvore distingue alterações desta tarefa, sem atribuir a ela os demais arquivos.

```text
analytics/index.js                     ~ agregados USD8 e avisos
backtesting/index.js                   ~ accounting/model metadata, agenda e fills
backtesting/passive.js                 + benchmark sem stops/reentradas
cli/offline.js                        ~ seleção do benchmark
execution/prices.js                   ~ política intrabar conservadora
financial/decimal.js                  + conversão decimal, PnL e USD8
portfolio/virtual.js                  ~ ledger, validação e invariantes
risk/simulation.js                    ~ limites numéricos do sizing
strategies/research.js                ~ alias risk-managed-hold
optimization/temporal.js              ~ split treino/validação/final
reporting/index.js                    ~ identificação HTML e fills.csv
experiments/quant-v2.js                + seis grupos experimentais reproduzíveis
tests/quant-v2.test.js                 + 12 casos independentes/adversariais
docs/
  architecture.md                     ~ fluxo V2 e fronteiras
  metrics.md                          ~ referências e agregados monetários
  strategies.md                       ~ semântica Hold
  roadmap.md                          ~ reavaliação explícita de pendências
  quant-v2-audit.md                    + auditoria/severidades/aceitação
  financial-model.md                   + precisão/contabilidade
  execution-model.md                   + temporalidade/custos/políticas
  risk-model.md                        + controles e limites
  data-provenance.md                   + pesquisa de fontes/pipeline planejado
  statistical-validation.md            + convenções temporais e limitações
  research-methodology.md              + hipóteses e critérios de rejeição
  testing.md                           + comandos e limites de cobertura
  quant-v2-delivery.md                  + este relatório
reports/quant-v2-audit-20261105-01..08/  + artefatos locais exclusivos
```

## Testes e verificações

Node v26.13.0. Antes: 43 FX + 9 raiz existentes. Depois: **64 casos aprovados,
55 FX + 9 raiz, zero falhas/skips**. Comandos finais:

```sh
npm test
npm --prefix services/orion-fx test
node --test --test-isolation=none services/orion-fx/tests/*.test.js tests/*.test.js
npm run check
node services/orion-fx/experiments/quant-v2.js quant-v2-audit-20261105-07
node services/orion-fx/experiments/quant-v2.js quant-v2-audit-20261105-08
```

Os dois primeiros comandos resumem 8 arquivos raiz / 7 FX no Node26. O terceiro
conta casos. `git diff --check` passou para arquivos rastreados; FX não rastreado
não é coberto por esse comando. Sem lint configurado, cobertura percentual ou
Node22 disponível. Nenhuma dependência instalada; auditoria de dependências/CI
não executadas. Check da raiz confirma versão e bloqueio declarado, não prova
sozinho segurança. Os testes de bloqueio usam mocks, sem acesso à corretora.

Comparação independente dos runs 07/08 por deep equality: 14 relatórios completos
idênticos, exceto metadados de identificação/hora; hashes de código, trades,
ledger, fills, curvas, métricas, seleção temporal e walk-forward iguais. Runner
rejeita nomes de diretórios existentes. Repetir exige NOME_NOVO. Cada resultado
contém CSV canônico, JSON, HTML, trades/equity/metrics/fills CSV; manifest registra
commit, hashes do código não commitado, dados, configuração, seed=null (sem RNG),
modelos e avisos. Não é assinatura digital ou persistência transacional.

## Experimentos sintéticos

Artefato principal: `reports/quant-v2-audit-20261105-08/manifest.json`;
replicação independente: diretório 07. Execuções 01–06 foram preservadas como
iterações, sem sobrescrita. Nas iterações 05/06 o choque de spread sobre Trend
não encontrou exposição no intervalo escolhido; a versão final usa uma posição
sintética controlada para testar o choque, sem ajustar estratégia a lucro.

Base comum: EUR/USD H1, 720 candles inventados `orion-synthetic-v1`, USD1000,
spread1 pip, slippage0.1 pip/lado, comissão/swap0, exposição1000, leverage1.
Último close 2024-02-19T00:00:00Z. Gaps semanais são da fixture, não dados reais.
Hashes exatos e todos os parâmetros estão nos JSON/manifestos.

| Experimento / variante | Trades | PnL líquido USD | PF |
|---|---:|---:|---:|
| 1 Trend | 13 | 3.51733778 | 1.35139 |
| Controle Mean Reversion | 30 | -15.29544973 | 0.05047 |
| Controle MA Cross | 3 | 3.03959782 | 8.73137 |
| Controle No Trade | 0 | 0 | null |
| 2 buy-hold legado / risk-managed-hold | 17 cada | -1.58907943 | 0.86188 |
| 2 passive-hold-benchmark | 1 | 1.72474335 | null |
| 3 Breakout original | 0 | 0 | null |
| 3 Breakout com ruptura determinística | 1 | -0.10704 | 0 |
| 4 Trend com custos maiores | 19 | -7.96034397 | 0.61842 |
| 4 choque de spread em posição controlada | 1 | -1.26958 | 0 |
| 5 perdas consecutivas | 10 | -44.18144 | 0 |
| 5 gap de preço adverso | 1 | -18.26896 | 0 |
| 6 final holdout sintético | 8 | 0.95057408 | 1.54858 |

Experimento1 reproduz a referência publicada em centavos; a documentação anterior
registrava Trend3.5173377770, agora3.51733778 (diferença ~3×10^-9 USD). Não existiam
relatórios antigos disponíveis; comparação não é diff de artefatos originais.
MA Cross continua insuficiente, apesar do PF alto. PF null é preservado quando
não há perdas; PF0 em fixtures só perdedoras é definido, não preenchimento.

Experimento2 compra 909 EUR na segunda abertura até último close sem ATR/stop;
comparação deve considerar exposição distinta. Experimento3 tem 240 candles flat,
ruptura no índice210 e execução no211, sem incluir high atual na janela anterior.
Experimento4: spread5/slippage1 e swap hipotético0.00001 USD/unidade/dia. Choque
separado: 4 candles flat, uma entrada, spread50 nos dois últimos candles.
Experimento5: 40 candles com lows adversos, leverage10/exposição10000 para exercitar
bloqueios; gap separado em 5 candles leva stop a fill pior que o nível planejado.
Experimento6: [0,432) treino, [432,576) validação, [576,720) final; candidatos
Trend/Mean Reversion fast5/slow20 fixados. Seleção só pela validação, final não
utilizado para seleção. Walk-forward rolling216/108 usa apenas treino inicial.
Warm-up frio e contas separadas são limitações explícitas.

Todos os resultados são testes mecânicos sobre preços inventados. Nenhuma
vantagem, significância ou expectativa de retorno real foi estabelecida.

## Segurança e preservação

Nenhum arquivo Freqtrade, estratégia Crypto, script local, Compose, volume ou
SQLite foi alterado; nenhum contêiner foi consultado/manipulado. `.gitignore`
preexistente preservado. Nenhum .env ou credencial real foi lido, impresso ou
alterado. Nenhuma autenticação Capital.com real ou chamada Live/Demo foi feita;
a integração existente não foi modificada. Os testes usam valores fictícios.
`evaluateOrder` continua negando ordens externas; módulos adicionados não possuem
transporte de corretora. Nenhum serviço foi exposto, commit/push/merge executado
ou relatório anterior sobrescrito. Não se afirma o conteúdo atual do .env,
pois esse arquivo não foi inspecionado.

## Próximas prioridades e limitações de aceitação

1. Completar auditoria numérica da margem/exposição e encapsular posição/coleções;
   validar múltiplas regras independentes de rollover e persistência sem corrupção.
2. Bid/ask OHLC e liquidez/parciais; tempo intrabar permanece desconhecido. Agenda
   de spread por candle não reconstrói spread histórico dentro do candle.
3. Fonte licenciada com bruto/hash/licença, timezone/lado de preço e calendário
   DST/feriados. Pesquisa documental de fontes não autorizou aquisição/redistribuição.
4. Warm-up separado, OOS contínuo, registro de tentativas, bootstrap temporal e
   múltiplas comparações. Final sintético não é evidência fora da amostra real.
5. Breakers dedicados a stale/volatilidade/persistência, capitalização/ruína com
   pressupostos e laboratório de todos os 12 cenários. Parte dos cenários já possui
   fixtures/testes, mas laboratório completo ainda não foi implementado.
6. CI Node22/26, lint/segredos sem ler .env, falhas de filesystem, observabilidade
   estruturada geral e dashboard somente depois dos checkpoints críticos.

Relatórios ainda não têm distribuição de retornos, painel comparativo HTML/OOS
completo ou indicador estatístico de confiabilidade calibrado. Eventos existentes
são arrays estruturados, sem pipeline geral de logs correlacionados. A entrega
não satisfaz integralmente os critérios V2; pendências são parte do estado entregue.
