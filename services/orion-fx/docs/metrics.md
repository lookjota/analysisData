# Interpretação das métricas

`analyze(result,{periodsPerYear:6048})`: retornos simples de equity a cada candle
H1 observado; 24*252 períodos/ano é hipótese configurável, taxa livre de risco 0.
A primeira observação compara com capital inicial. Sharpe=mean(r)/sampleStd(r)
*sqrt(periodsPerYear). Sortino=mean(r)/sqrt(mean(min(0,r)^2))*sqrt(periodsPerYear).
Gaps mantêm intervalo irregular: não interpretar anualização como estimativa
precisa sem calendário e dados reais. Métricas são null se denominador/observações
não permitem definir o resultado; nunca Infinity convertido silenciosamente em 0.

Total trades inclui somente fechados. Win rate=positivos/total; breakeven entra
no denominador. Average win/loss usam PnL líquido; loss é negativo. Gross profit
é soma de trades líquidos positivos, gross loss é módulo dos negativos;
profit factor=gross profit/gross loss. Expectancy=média de PnL líquido dos trades.
`grossTradingPnl` soma PnL de preços executados antes de comissão/swap, mas já
inclui spread/slippage. Não é lucro de um mundo sem fricção.

Net profit=equity final-capital inicial (inclui PnL aberto se houver).
Return percentage=100*net/initial. Peak inicia no capital inicial;
drawdown=peak-equity; drawdown%=100*drawdown/peak. Recovery=net/maxDrawdown.
Curvas por close observado; sem estimativa de drawdown intrabar.

Exposure time=horas calendário posicionadas/horas totais calendário, incluindo
fins de semana; average duration usa timestamps dos trades. Consecutive wins/losses
conta sequências de PnL positivo/negativo; breakeven interrompe ambas.
Monthly returns compõe equity entre último close do mês anterior e atual;
primeiro mês usa initial. Meses inicial/final podem ser parciais.

Alertas básicos: <30 trades, >50% dos ganhos em um único trade, spread/slippage
zero e dados sintéticos. Walk-forward sinaliza deterioração OOS simples e poucos
trades. Não há teste de significância, bootstrap, probabilidade de overfitting,
correção de múltiplas comparações ou detector automático de regimes. Compare
risco, custos, estabilidade e amostra, não apenas lucro.

## Convenções V2

Agregados monetários (lucro/prejuízo bruto por classificação líquida, PnL total e
PnL bruto dos trades) somam unidades USD8 e convertem para Number na apresentação.
Ratios/retornos continuam Number. Alertas adicionais: histórico <6048 observações,
calendário irregular e nome legado buy-hold. São alertas descritivos; 6048 não é
limiar de significância nem validação de anualização. PF indefinido continua null.
A referência independente adicional usa equity 1000→1100→990→1089: drawdown110,
10%, net89, retornos .1,-.1,.1, média1/30 e variância amostral1/75.
