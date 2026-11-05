# Validação temporal e incerteza

Objetivo: impedir seleção com futuro, sem confundir simulação com evidência.
`researchSplit` gera intervalos [início,fim): default 60/20/20. Para 720 candles:
treino [0,432), validação [432,576), final [576,720). Frações configuráveis com
partições não vazias. Reservar final antes de escolher parâmetros.

`evaluateWalkForward` seleciona candidatos somente pelo treino passado (netProfit,
desempate por ordem declarada), avalia futuro em conta independente; rolling e
expanding existentes. Warm-up é frio no próprio teste, não separado no passado.
Não concatenar curvas dessas contas nem reportar retorno composto agregado.
Split não protege contra seleção humana após observar resultados: registrar
hipóteses/tentativas e congelar dataset final fora do ciclo de pesquisa.

Experimento 6 tem duas hipóteses predefinidas; escolhe apenas na validação e roda
final uma vez. Walk-forward usa somente os primeiros 432 candles. É demonstração
sintética, não holdout real desconhecido. Teste de perturbação futura verifica
que a seleção de treino e decisões passadas não se alteram.

Sharpe/Sortino são descritivos, anualização 6048 é hipótese, sem ajuste de gaps.
Poucos trades, concentração >50% dos ganhos, sintético e histórico curto geram
avisos. Não há IC, p-value, bootstrap, correção de múltiplas comparações, Calmar
ou probabilidade de ruína. PF com denominador zero é null; PF zero com perdas e
nenhum ganho é matematicamente definido. Três trades não sustentam inferência.

Próxima aceitação: warm-up anterior sem negociação, OOS com janelas auditáveis,
registro de todas as tentativas e block bootstrap com seed, comprimento de bloco
justificado, diagnósticos de dependência e sensibilidade. Não usar bootstrap IID
por padrão. Testes: `evaluation.test.js`, `quant-v2.test.js`. Convenções de métricas
estão em [metrics.md](metrics.md); novo teste usa retornos +10%,-10%,+10% com
Sharpe amostral calculado independentemente.
