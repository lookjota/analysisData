# Motor de risco virtual

`risk/simulation.js` é independente das estratégias e do transporte.
Configuração default: risco .5% de equity, teto máximo 1%, perda diária 2%,
drawdown 10%, uma posição, exposição USD1000, leverage1. Valores de pesquisa,
sem recomendação para dinheiro real. Não há suporte a múltiplos instrumentos,
conversão cambial de conta ou risco correlacionado neste checkpoint.

Unidades inteiras = floor(min(orçamento/(distânciaStop+reservaCustos),
exposiçãoMáxima/entry, cash/(entry/leverage+reservaCustos))). Reserva de custos
inclui spread, slippage ida/volta e comissões ida/volta. É conservadora também
para risco do stop. Margem não pode contornar saldo; rejeita tamanho <1.

Valida direção, preços, distâncias, capital, exposição, risco, posições e margem.
Dataset inválido aborta a simulação antes de criar ledger: falha fechada. Flag
killSwitch ou dados inválidos rejeitam intenções. Drawdown ativa bloqueio para o
restante do teste; perda diária bloqueia até próximo dia UTC. Posições são
encerradas no open seguinte à observação do limite. Eventos e rejeições têm
códigos registrados; gaps podem atravessar limites.

`assessIntent` exporta cálculo para inspeção; somente o orquestrador virtual
consome uma aceitação. O bloqueio de ordens reais `risk/index.js` permanece
incondicional. Desativar limites para estratégias específicas não é suportado.
