# Testes e reprodução Quant V2

Objetivo: preservar regressão e validar referências independentes offline.
Node test runner, sem dependências instaladas ou chamadas reais a corretoras.
Comandos executados:

```sh
npm test
npm --prefix services/orion-fx test
node --test --test-isolation=none services/orion-fx/tests/*.test.js tests/*.test.js
npm run check
node services/orion-fx/experiments/quant-v2.js NOME_NOVO
```

Resultado no Node26.13.0: 64 casos aprovados, 55 FX e 9 raiz; 0 falhas,
0 skipped. Padrão isolado resume 8 arquivos raiz / 7 FX. Doze casos novos cobrem
USD8, PnL decimal, half-away, overflow, 400 roundtrips, validação e corrupção,
benchmark passivo, rompimento N+1/futuro, referência Sharpe/DD, split triplo,
custos que revertem lucro, gap short e CLI passiva/avisos, agenda de custos e ambiguidade intrabar parametrizada.

Os testes de broker usam chaves fictícias hardcoded e transporte injetado;
nenhuma autenticação real é executada. O runner de experimentos importa apenas
módulos offline, não lê process.env ou credenciais, não chama fetch. Diretório
novo obrigatório, CSV canônico e relatórios não são sobrescritos; falha pode
deixar artefatos parciais inspecionáveis. Escolher outro nome para repetir.

Aceitação: regressão completa aprovada, referência de cada fórmula independente,
mesmo código/dataset/config produz mesmos trades/ledger/curvas/métricas. Run ID,
hora da execução e identificadores de experimento naturalmente diferem.
SHA256 do código é necessário porque FX já era não rastreado; commit sozinho
não identifica esse código. Não há cobertura percentual, fuzzing extensivo,
teste massivo, matriz Node22 executada, IC ou certificação de bibliotecas.
Node22 não estava disponível; requisito package engines não prova compatibilidade.
Ver [entrega](quant-v2-delivery.md) para artefatos e resultados finais.
