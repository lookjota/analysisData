# Risco virtual

Objetivo: negar intenções inválidas; não garantir teto de perda. Defaults:
0.5% de equity por operação, teto configurável até 1%, uma posição, 2% perda
diária, 10% drawdown, exposição USD1000, alavancagem 1. Tamanho inteiro é o mínimo
entre orçamento/(distância stop+custo estimado por unidade), limite de exposição
/e preço e caixa/(margem por unidade+custo). Margem não é custo realizado.

Configuração inválida, preço inválido, flag inválida, limite de posição, capital
insuficiente e unidades inseguras falham fechados. Drawdown bloqueia novas
entradas permanentemente no run; perda diária bloqueia até nova data UTC;
freeMargin negativo fecha na abertura. Ver `risk/simulation.js` e `backtesting`.
Equity/dayStart é observado na primeira abertura de cada data, após reprecificação
antes do swap. Gap overnight pode não aparecer como perda diária em relação a
esse novo baseline; drawdown continua aplicável. Isso é convenção, não limite
regulatório ou contratual. Sequência de perdas por si só não é breaker dedicado.

Swap/custos/gaps podem causar perdas além do planejado. Stops relativos à entrada
não garantem stop fill. Sem controles de correlação, concentração multiativo,
volatilidade extrema, stale por relógio externo ou persistência. Divergência
contábil interrompe o run por exceção, impedindo novas operações; não há retomada
automática. Benchmark passivo é comparação sem leverage, sem risco por stop,
sem breakers da estratégia; não se confunde com risk-managed-hold.

Aceitação: `tests/simulation.test.js`, `checkpoints.test.js`, `quant-v2.test.js`;
experimento 5 demonstra perdas seguidas, bloqueio e gap. Próximo ciclo: breakers
explícitos de stale/volatilidade/persistência com eventos estruturados e testes.
Capitalização/ruína não foram implementadas; exigem hipóteses de distribuição,
dependência temporal e custos, sem retornos fixos tratados como previsão.
