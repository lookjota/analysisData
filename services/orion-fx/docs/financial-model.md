# Modelo financeiro USD8 v1

Objetivo: contas virtuais EUR/USD reconciliáveis. EUR é base, USD cotação/conta;
1000 unidades = 1000 EUR, lote convencional 100000 unidades, pip 0.0001 USD/EUR.
Pip USD = unidades × 0.0001. PnL bruto = lado × unidades × (saída − entrada).
Não há conversão cruzada ou suporte a outra moeda de conta.

O caixa e cada lançamento são BigInt escalados por 100000000. A conversão usa a
representação decimal canônica `String(Number)`, inclusive expoentes; PnL usa
subtração/multiplicação decimal antes de quantizar. Arredondamento simétrico
half-away-from-zero por lançamento em 8 casas. Cada comissão/swap é arredondado
uma vez e o mesmo valor é usado no cash e trade. Isso não recupera casas perdidas
antes da entrada; preços, custos por unidade, notional/margem, indicadores e
sizing ainda usam Number. Uma migração total não foi realizada.

Limite absoluto de inteiro escalado: 9007199254740991, cerca de USD90 milhões.
Capital, lançamentos, resultados, saldo e notional de abertura fora do limite
falham antes de mutar o ledger. Não se admite NaN/Infinity. Quantidades são
inteiros seguros positivos. JSON usa números para compatibilidade e strings
`amountUsd8`, `cashUsd8`, `netPnlUsd8` como valores contábeis exatos. Perto do limite,
números JSON podem perder a última casa; consumidores devem usar as strings.
Tolerâncias em cálculos Number são apenas comparações diagnósticas, nunca crédito
no ledger. Arredondamento por lançamento pode diferir de arredondamento agregado
em até 0.5×10^-8 USD por lançamento; não tratar diferenças como alpha.

Invariantes: cash = initial + soma dos lançamentos; sem posição, cash = initial +
soma dos trades líquidos; equity = cash + PnL aberto quantizado. Snapshot verifica
as duas reconciliações aplicáveis em inteiros. Trade líquido = bruto − comissão
entrada − comissão saída − swap. Notional não é receita: abrir reserva margem,
fechar apenas credita PnL menos comissão. Registros são congelados; coleções são
públicas para compatibilidade, corrupção detectável causa falha, não reparo.
Posição permanece mutável para trailing; encapsulamento completo é pendente.

Exemplo independente: 1000 EUR comprados a 1.1000 e vendidos a 1.1010 rendem
USD1 bruto; taxas .01+.02 e swap .03 deixam USD.94. Short perde USD1.06 com os
mesmos preços/taxas. Margem reservada é unidades×entrada/alavancagem, constante
na posição; reavaliação contratual de margem não é simulada.

Aceitação: fixtures independentes long/short, 400 roundtrips, nenhuma duplicação
de fechamento, rejeição de números inválidos/overflow, corrupção detectada.
Evidência: `tests/quant-v2.test.js`, `tests/simulation.test.js`. Persistência do
ledger não é banco transacional; recuperação e diário resistente a falhas pendem.
