# Indicadores

Funções em `indicators/index.js` recebem arrays cronológicos e retornam arrays
alinhados. Períodos inteiros positivos, preços finitos. Warm-up produz `null`;
nenhum preenchimento retroativo. Não há arredondamento intermediário.

- SMA: média aritmética da janela.
- EMA: seed SMA(p), alfa 2/(p+1); Wilder usa alfa 1/p.
- RSI: ganhos/perdas suavizados por Wilder a partir das primeiras p mudanças;
  primeiras p posições null; série flat retorna 50, somente ganhos retorna 100.
- ATR: TR=max(high-low,abs(high-prevClose),abs(low-prevClose)); primeiro TR=range;
  seed média dos primeiros p TR, depois Wilder. Essa convenção pode diferir de
  bibliotecas que descartam o primeiro candle.
- MACD: EMA(fast)-EMA(slow), signal EMA dos valores disponíveis; histograma só
  existe após warm-up do sinal.
- ADX: movimentos direcionais exclusivos, DX=100*abs(+DM--DM)/(+DM+-DM), Wilder;
  primeiro ADX no índice 2p-1. Direção inexistente produz DX=0.
- Stochastic: %K=100*(close-lowestLow)/(highestHigh-lowestLow); %D=SMA(K).
  Janela sem amplitude retorna null, sem valor inventado.
- Bollinger: SMA ± k desvios; desvio **populacional**.
- Rolling high/low, desvio, amplitude high-low, retorno close/prevClose-1 e
  retorno log ln(close/prevClose).

Testes numéricos conhecidos e invariância por prefixo são locais. Não foi feita
comparação com biblioteca externa neste checkpoint. Valores em double IEEE 754;
comparações contábeis de teste usam tolerância, não igualdade decimal absoluta.
