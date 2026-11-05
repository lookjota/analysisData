# Backtesting e contabilidade

`backtest(candles, options)` não consulta rede nem horário atual. Sinal após o
close N executa no open N+1. Último sinal não executa. Dataset canônico e prefixos
são congelados. Estratégias customizadas devem ser código confiável: não há
sandbox de JavaScript nem controle sobre closures fornecidas pelo chamador.

Ordem por candle: reset do dia UTC; swap pelos dias UTC transcorridos; proteção
em gaps da posição existente; limites de risco/margem no open; saída por sinal;
avaliação e eventual entrada; stop/alvo intrabar; marcação no close; atualização
de trailing para o candle seguinte; cálculo do próximo sinal.

Entrada long=mid+spread/2+slippage; short=mid-spread/2-slippage. Saídas invertem.
Spread/slippage em pips, pip EUR/USD=.0001, lote=100000 unidades EUR, valor do pip
USD=unidades*.0001. Stops/alvos são definidos a partir do preço de entrada e
testados contra bid para long, ask para short. Em candle que toca ambos, stop
vence. Stop em gap usa open adverso; alvo em gap não recebe melhoria de preço.
Slippage é adverso inclusive em alvo; não se promete execução ao preço limite.

Custos explícitos: comissão USD/unidade por lado e swap USD/unidade/dia UTC
transcorrido. Sem custo contratual atribuído à Capital.com, sem calendários de
rollover/triplo swap; spread constante e liquidez ilimitada. Stops em gaps podem
perder mais que o orçamento. Sem latência, preenchimentos parciais ou tick data.

Conta exclusivamente USD e EUR/USD neste release. Notional=units*entry;
margem=notional/leverage, fixa na abertura. Cash inicial menos comissões/swap,
mais PnL realizado; equity=cash+PnL não realizado a preço de liquidação com
spread/slippage. Comissão futura de saída só entra no saldo ao fechar. Margem
livre=equity-margem usada. Sem débito de notional no cash. Final padrão fecha
posição no último close; `closeAtEnd:false` mantém posição e PnL aberto no estado.
Ledger soma exatamente as mudanças de cash (com tolerância IEEE754).

Marcações e drawdown são por fechamento observado, não máximos intrabar. Limites
de risco são avaliados nos opens/closes, sem garantia de deter perda intrabar.
Stops e alvos usam high/low intrabar sob a política conservadora descrita.
Dataset.timestamp é open; equity.timestamp é close. Trades de proteção intrabar
recebem timestamp do open do candle: duração intrabar exata é desconhecida.
Não há interpolação ou falsa precisão de horário de preenchimento.
