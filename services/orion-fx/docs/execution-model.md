# Execução mid-h1-v1

Objetivo: hipótese operacional determinística e auditável. Candle timestamp é
abertura; sinal recebe somente prefixo fechado até N; entrada/reversão ocorre
na abertura N+1. Nenhum sinal do último candle é executado. Liquidez ilimitada,
fill completo e latência de uma abertura são hipóteses, sem simulação de fila.

Entrada = mid + lado×(spread/2+slippage)×pip. Saída market = mid −
lado×(spread/2+slippage)×pip. Custos são pips por execução; comissão USD/unidade/
lado; swap USD/unidade/dia UTC corrido. Modelo configurável fixo ou `costSchedule` explícita com um objeto de
overrides por candle, versionado no resultado. Não estima spread a partir de OHLC. Não representa condições verificadas da Capital.com. Spread/slippage
estão embutidos nos preços; comissão/swap são débitos separados. Fills do backtest registram preço solicitado no lado executável antes do
slippage, preço executado, meia parcela de spread, slippage e comissão USD.
Isso é decomposição do modelo hipotético, não medição de custos reais.

Stop e alvo são níveis no lado executável da posição, relativos à entrada.
Toque usa bid para fechar long, ask para fechar short, sem slippage no gatilho.
Gap atravessando stop executa na abertura adversa menos/mais slippage; gap além
do alvo recebe alvo menos/mais slippage, sem melhoria favorável. Se ambos forem
tocados, stop primeiro, conservador. Política `intrabarPolicy` reportada: `stop-first` (default) ou
`reject-ambiguous` (interrompe o run). Não existe opção otimista take-first. Alvo é saída gatilhada com slippage, não limit com preço
garantido. Trailing só é atualizado após close, para o candle seguinte.

Suportados: entrada market N+1, reversão, saída por sinal, stop-loss, alvo
protetor, trailing e fechamento final. Sem ordens limit/stop de entrada, parciais,
liquidez limitada, spread variável dentro do candle, latência arbitrária ou leilão.
Não inferir suporte a essas ordens pelo nome do módulo.

Custos overnight usam dias UTC, incluindo fins de semana, sem triplo rollover,
feriados, créditos de swap ou regras contratuais. Drawdown por close pode ocultar
excursões intrabar. Saídas intrabar recebem timestamp de abertura: duração e
exposição podem ser subestimadas. Não há preenchimento silencioso de gaps.

Aceitação atual: testes stop/target simultâneos long/short, gap adverso, trailing,
reprodutibilidade, posição aberta/final, perturbação futura e custo negativo para
trade flat. `tests/simulation.test.js`, `tests/quant-v2.test.js` e experimentos 3–5.
Aceitação futura: bid/ask OHLC e liquidez. Agenda de custo atual usa a taxa do
candle corrente para fills, marcas e swap dos dias decorridos desde o anterior;
não há histórico intradiário de rollover. Custos futuros maiores podem exceder
a estimativa usada no sizing. Benchmark passivo suporta custos fixos; agenda
nesse benchmark é rejeitada explicitamente. `fills.csv` acompanha os relatórios.
