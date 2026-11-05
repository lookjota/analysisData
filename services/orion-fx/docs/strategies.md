# Estratégias de pesquisa

`createStrategy(id,parameters)` declara ID, nome, versão, H1, EUR/USD,
requisitos, parâmetros e warm-up. `signal(closedPrefix)` é síncrono e sem IO.
`hold` mantém posição; `target` pede direção, stopDistance e takeDistance.
Direção oposta fecha a posição e solicita reversão no próximo open, sujeita ao
risco. `exitLong`/`exitShort` fecham no próximo open. Uma intenção nunca é ordem
externa e não tem referência ao HTTP.

- `trend`: EMA50 acima/abaixo de EMA200, filtro opcional ADX; stop 2 ATR,
  alvo 2 vezes distância do stop.
- `mean-reversion`: close abaixo da banda inferior e RSI<30 compra; acima da
  superior e RSI>70 vende; cruza média da banda na direção da reversão para sair.
  Filtro opcional exige alinhamento de EMA50/200 para entrada.
- `breakout`: fechamento além de high/low dos p candles **anteriores**, confirmado
  pelo fechamento; stop ATR e alvo por razão risco/retorno.
- `ma-cross`: cruzamento SMA fast/slow; stops e alvos iguais aos demais modelos.
- `no-trade`: referência de caixa constante.
- `buy-hold`: referência comprada **com proteções e reentrada**, não buy-and-hold
  financeiro puro. Forex é modelado como exposição de margem; não se compra um
  ativo spot e não se debita o notional do cash.

Parâmetros padrão: fast50, slow200, period20, rsiPeriod14, atrPeriod14,
stopAtr2, rewardRisk2, adxMinimum0, trendFilter=false. Todos editáveis via API JS;
CLI expõe escolha de estratégia, não todos os parâmetros. Warm-up conservador
comum inclui slow e é declarado no objeto; as baselines também respeitam isso.
Estas regras são hipóteses, sem alegação de vantagem estatística ou lucratividade.

## Semântica Hold V2

`buy-hold` é legado gerido por risco, com alerta de nome ambíguo.
`risk-managed-hold` explicita a mesma lógica ATR com reentradas.
`passive-hold-benchmark` usa API separada/CLI backtest: compra na segunda abertura,
fecha no último close, sem stops, alvos ou reentradas. Ver
[research-methodology.md](research-methodology.md). Não comparar exposição passiva
e sizing por risco como produtos equivalentes. Replay passivo não é suportado.
