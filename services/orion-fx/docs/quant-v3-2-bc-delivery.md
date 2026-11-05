# Orion Quant V3.2 — entrega B/C

Status: **B IMPLEMENTED/TESTED no modelo offline H1; C PARTIAL**.
C possui isolamento técnico na sessão autorizada; consumo durável entre sessões
não foi implementado. Nenhuma alegação de proteção absoluta ou rentabilidade.

## Baseline e escopo

Branch feat/orion-quant-v3, HEAD 85d96315389bdb675d61ab10a3967808c4644cef.
Node v26.13.0. Baseline npm test: 12 arquivos; FX: 11 arquivos; check aprovado,
orders disabled. Baseline informada 86 casos, preservados na regressão final.
Único untracked anterior: services/freqtrade/scripts/, não manipulado.
Auditoria e evidências: quant-v3-2-bc-audit.md.

Sem dependências novas, estratégias novas, ajuste de parâmetros de produção,
TypeScript, dashboard, Docker, rede de corretora, credenciais, .env ou ordens.
TRADING_ENABLED=false permanece; nenhum commit/push/staging foi executado.

## B — contratos e integração

market-data/prices.js:
- quoteSnapshot: EUR/USD, timestamp normalizado, bid/ask positivos e finitos,
  mid calculado, spread observado, assumedSpread=null, source, priceBasis,
  dataQuality e quoteFreshness. Política estrita por padrão, instrumento e idade
  configurados pelo consumidor. Timestamp futuro/stale/crossed rejeitado.
- quoteBars: bid e ask OHLC separados; open/close declarados contemporâneos,
  extremos intrabar independentes. Sem comparação bid.high versus ask.low.
  Não se presume sincronização de amostras de máximas/mínimas.
- Top-level OHLC continua referência analítica fornecida pelo dataset, utilizada
  pelos indicadores. Não se fabricam bid/ask a partir dela. Nos quotes endpoints,
  mid aritmético está disponível no contrato de snapshot; OHLC mid agregado não
  é dedutível dos extremos bid/ask e não é reconstruído.
- ASSUMED_SPREAD: dataset sem quotes, execução hipotética declarada por pips.
  OBSERVED_BID_ASK: exige quotes em todas as barras e rejeita spread hipotético
  não zero. MID_ONLY_REFERENCE é reconhecido e rejeitado para execução.
- Dataset misto/mode incompatível rejeitado. Candles H1 declaram freshness
  AGGREGATED_H1_NOT_TICK_FRESHNESS; não se afirma freshness de tick.

historical.js/manifest.js: quoteBars normalizado e profundamente congelado; hash
quotes.v2 inclui lados, esquema quotes.v2 e transformação própria. Mid-only
mantém CSV e hash canônico v1. Exportar quotes para CSV legado lança
QUOTE_BARS_REQUIRE_JSON em vez de perdê-los silenciosamente. API JS aceita JSON;
CLI CSV não ganha importador de quotes nesta etapa. Manifestos novos preservam
calendário/proveniência e não emitem aviso mid-only quando há quotes completos.

execution/prices.js e backtesting/index.js:
- Compra long / recompra short em ask; venda short / encerramento long em bid.
- Preço de entrada/saída inclui spread uma vez e slippage adverso uma vez.
  slippagePips não negativo significa custo adverso por lado; melhoria favorável
  de execução não é modelada. Marcas representam liquidação hipotética com custo.
- Stops/targets usam OHLC do lado de liquidação. Gap de stop executa abertura
  adversa; gap favorável recebe target, sem melhoria. Ambiguidade stop-first ou
  reject-ambiguous explícita. Tempo intrabar exato não é recuperável de H1;
  timestamps de fills protetivos seguem convenção de barra, não relógio de tick.
- Fills registram lado BUY/SELL, preço pedido/executável/final, custos e hipótese.
  Entradas ligam sinal, disponibilidade no fechamento e elegibilidade no próximo
  open observado. signalTimestamp legado continua sendo abertura da barra do
  sinal; signalAvailableAt informa disponibilidade efetiva após fechamento.
- Componentes spread/slippage são informativos: não são debitados novamente no
  ledger. Spread observado no instante intrabar protetivo é UNKNOWN/null, pois
  não é possível inferi-lo honestamente de OHLC. Não afeta PnL contabilizado.
- Comissões por unidade/lado, fixas por ordem e mínimo por lado suportados:
  max(minimumCommission, commissionPerOrder + units*commissionPerUnit).
  USD8 soma/multiplica antes do booking; taxas fixas entram no limite de sizing.
  Reserva de sizing é conservadora quando há comissão mínima e variável juntas.
- Swap é a hipótese existente de noites UTC, com tarifa por unidade/dia; não é
  calendário real de rollover/triple-swap de corretora.
- VirtualPortfolio/decimal não foram alterados. Strings USD8 continuam referência
  exata; preços e sizing Number mantêm a limitação de representação declarada.

passive.js usa calendário, classificação de gaps, manifesto, modelo executável,
custos por barra, comissões/slippage/swap e mesmos avisos dos relatórios. Uma
entrada no segundo open após primeiro close e uma saída no último close; sem
stops/reentradas/risk sizing. Continua separado de risk-managed-hold/buy-hold.
CLI aceita calendário e aquisição para benchmark. Liquidez passa a ser descrita
como não modelada, sem evidência de capacidade; não se inventa livro histórico.

## C — contratos e limites

backtest evaluation={start,end,set} usa índices [start,end), com contexto em
[0,start). Capital reiniciado e conta flat; contexto não gera fills, PnL, swap,
curva ou sinais pendentes. Primeiro sinal elegível nasce no close da primeira
barra avaliada pronta; primeira execução possível é próximo open. Último sinal
não executa fora da janela. Posições são fechadas ao fim nos caminhos de pesquisa.

config.evaluation registra contextStart/evaluationStart/evaluationEnd,
warmupBars, indicatorReady e políticas. decisions registra prontidão,
tradingEligible e elegibilidade temporal por decisão. Histórico insuficiente
produz hold até readiness e alerta INSUFFICIENT_WARMUP. O prefixo vem da origem
fornecida: SMA/EMA/RSI/MACD/ATR preservam exatamente a mesma inicialização.
Recursivos com contexto truncado finito não prometem equivalência ao histórico
iniciado antes dessa origem. Warm-up conta barras observadas, sem preencher gaps.

createResearchSession(rows,{split,config}):
1. Copia/normaliza/congela dados e define TRAIN/VALIDATION/FINAL_HOLDOUT contíguos,
   com índices, contagens, timestamps e limites exclusivos; registra identidade.
2. optimize aceita apenas candidatos id/parameters e useValidation. O helper de
   seleção recebe só TRAIN e prefixo de VALIDATION autorizado. Não recebe o array
   completo com holdout, callbacks ou serviços externos. Injeção de rows/config
   de estratégia/evaluation é rejeitada.
3. Seleção por netProfit de TRAIN ou VALIDATION conforme política explícita;
   empates pela ordem declarada. Validação utilizada para seleção deixa de ser
   avaliação independente. Histórico das grades e metodologia acompanha freeze.
4. freeze fixa parâmetros efetivos, versão da estratégia/motor, dataset hash,
   split, hipóteses e identidade SHA256. Reajuste posterior na sessão é rejeitado.
5. evaluateFinal({authorization}) é obrigatório e explícito após freeze. Registro
   de tentativa precede execução; falhas também consomem acesso. Repetição exige
   allowReuse:true e recebe aviso FINAL_HOLDOUT_REUSED_NOT_INDEPENDENT.
6. status fornece consumo/autorização/identidades sem disponibilizar preços.

**Limitação HIGH:** registro é em memória, por instância. Recriar sessão/reiniciar
processo pode ocultar consumo prévio. Registro durável e identificação de reuso
entre configurações/sessões são PENDING. As APIs legadas backtest/sensitivity e
walk-forward com arrays livres são pesquisa EXPLORATORY, não um cofre de dados.
Operador com acesso aos arquivos pode contornar o guard; callbacks livres do
backtest podem capturar dados externos. A interface protegida não os admite.

walk-forward permite rolling/expanding e validationSize opcional. Treino e
validação precedem OOS, parâmetros congelados por janela; OOS usa contexto desde
a origem sem operar nele. Capital/conta independentes, fechamento obrigatório,
sem trades duplicados ou soma de equity curves. Metadados incluem períodos,
parâmetros, identidade congelada, dataset, custos/modelo, warm-up, quantidade,
retorno/drawdown e warnings. aggregateWalkForward produz média aritmética de
retornos de contas independentes, pior drawdown por janela e total de trades;
rejeita sobreposição e custos/dataset incompatíveis. Não é carteira contínua.

Relatórios JSON/HTML identificam TRAIN, VALIDATION, OOS, FINAL_HOLDOUT,
PASSIVE_BENCHMARK ou EXPLORATORY. Avisos cobrem poucas operações, janela curta,
sintéticos, custos hipotéticos, falta de bid/ask, readiness insuficiente,
reutilização e múltiplos candidatos. Não há intervalo de confiança, correção de
múltiplas hipóteses, evidência de vantagem por profit factor ou prontidão real.

## Experimentos e oráculos executados

Todos os preços são fixtures determinísticas declaradas sintéticas; nenhuma
fixture é apresentada como histórico real ou evidência de rentabilidade.

| Experimento | Evidência | Status |
|---|---|---|
| A mid-only / spread hipotético | price-integrity-bc: avisos/modelo e roundtrip sem movimento | TESTED |
| B quotes variáveis / long-short | entrada ask/bid, saída oposta, oráculo -70000*units USD8 | TESTED |
| C passivo calendário/proveniência | fim de semana com DST, manifesto v2, uma entrada/saída, CLI sem fetch | TESTED |
| D warm-up TRAIN/VALIDATION | contexto de 20 barras, primeiro fill barra21, primeira equity=1000 | TESTED |
| E futuros alterados | SMA/EMA/RSI/MACD/ATR, trend/mean-reversion/breakout, ordens/fills anteriores invariantes | TESTED |
| F tentativa de injetar holdout | rows/callbacks/config indevidos rejeitados; preços finais alterados não mudam seleção | TESTED na sessão |
| G rolling/expanding | treino/validation/OOS adjacentes, seleção congelada, contas reset, agregação sem overlap | TESTED |
| H fim de semana/DST | benchmark e warm-up calendar-v1, zero missingHours, sem preencher barras | TESTED |
| I reconciliação custos | -42000*units USD8 nos roundtrips, taxas por lado/mínimas, swap; ledger financeiro legado | TESTED |
| J regressão | todos os 86 casos anteriores preservados mais 19 novos | TESTED |

B4 cobre zero/positivo/alto spread, crossed/missing/stale quotes, gaps nos dois
sentidos, stops/targets long e short, simultaneidade, slippage adverso positivo,
comissões fixas/por lado/mínimas, swap e precisão. Melhorias de slippage não são
suportadas; valores negativos são rejeitados. Testes anteriores V3.1 cobrem
precisão extrema, limites Number/BigInt, centenas de roundtrips e perda superior
ao capital para ambos os lados. Não se usa a função testada como oráculo novo.

## Validação final

- node --test --test-isolation=none tests/*.test.js services/orion-fx/tests/*.test.js:
  **105/105 casos**, zero falhas (86 anteriores + 19 novos).
- npm test: 14/14 arquivos aprovados, zero falhas.
- npm test --prefix services/orion-fx: 13/13 arquivos aprovados, zero falhas.
- npm run check: aprovado, orders disabled.
- git diff --check: aprovado; git diff --exit-code -- services/freqtrade: sem diff.
- git status -sb: branch obrigatória/HEAD preservados; 11 arquivos rastreados
  modificados e seis novos Orion. Único untracked anterior Freqtrade preservado.
  Com Node26, comandos npm resumem por arquivo; a contagem de 105 casos vem da
  execução explícita com --test-isolation=none, não da soma dos arquivos.
- Cobertura de linhas/branches, Node22, dados reais e auditor externo: não executados.

## Matriz e riscos

| Item | Estado | Limite/próximo passo |
|---|---|---|
| B1 contratos | IMPLEMENTED/TESTED | H1 quotes e snapshots; sem importador tick |
| B2 execução/custos | IMPLEMENTED/TESTED | modelo OHLC, preços/sizing Number |
| B3 benchmark | IMPLEMENTED/TESTED | uma entrada/saída; política UTC swap declarada |
| B4 adversariais | IMPLEMENTED/TESTED | oráculos novos + regressão contábil anterior |
| C1 split | IMPLEMENTED/TESTED | ranges locais e contíguos |
| C2 warm-up | IMPLEMENTED/TESTED | contexto desde origem; sem persistir estado recursivo |
| C3 holdout | PARTIAL | guard testado; registro durável entre sessões PENDING |
| C4 walk-forward | IMPLEMENTED/TESTED | contas independentes, sem curva agregada fictícia |
| C5 leakage | IMPLEMENTED/TESTED | fábrica e sessão; código hostil externo fora do contrato |
| C6 reporting | IMPLEMENTED/TESTED | alertas descritivos, sem inferência estatística |
| Aceitação global B/C | PARTIAL | completar consumo durável antes de alegar C integral |

CRITICAL: nenhum defeito novo comprovado dessa classe; não é auditoria exaustiva.
HIGH: reutilização do holdout entre sessões não detectada; APIs exploratórias não
impõem o guard globalmente; inexistência de journal/recovery operacional anterior.
MEDIUM: preços/sizing Number, quotes agregados sem timing/liquidez intrabar,
spread em proteção UNKNOWN, calendário de fornecedor/rollover não comprovado,
calendário legacy-utc22 ainda default por compatibilidade, manifesto opcional.
LOW: Node22 e cobertura adicional não executados nesta sessão.

Próxima entrega: registry durável com identidade de dataset/split, journal de
acessos/reuso entre pesquisas e integração obrigatória do fluxo protegido nos
entrypoints de pesquisa. Não há bloqueio externo de ambiente nesta entrega;
persistência foi deixada PENDING, não marcada BLOCKED.

## Arquivos e revisão Git

Implementação: analytics/index.js; backtesting/{index,passive}.js;
cli/offline.js; execution/prices.js; market-data/{historical,manifest,prices}.js;
optimization/{temporal,research,session}.js; reporting/index.js; risk/simulation.js.
Testes novos: tests/price-integrity-bc.test.js e tests/isolation-bc.test.js.
Documentos novos: docs/quant-v3-2-bc-audit.md e este relatório.

Sugestão de revisão: contratos de quotes e hashes → execução/fees e oráculos →
benchmark/calendário → sessão e dados autorizados → warm-up/walk-forward →
reporting. Antes de commit manual, conferir git diff e somente os arquivos Orion;
preservar services/freqtrade/scripts/. Nenhum commit sugerido foi executado.
