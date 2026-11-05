# Orion Quant V3.1 — checkpoint financeiro P0

Status global: **PARTIAL**. Este incremento encerra um checkpoint financeiro
consistente e testado, não a missão integral V3.1. Fases posteriores permanecem
pendentes; não há alegação de prontidão para trading real.

## 13.1 Auditoria

Ver quant-v3-hardening-audit.md: mutabilidade externa, booking parcial reproduzido
por congelamento do ledger público, abertura sem capital suficiente e marcação
anacrônica. Quatro testes de caracterização falharam no baseline e passaram após
correção. Nenhum achado CRITICAL confirmado; isso não equivale a auditoria de
segurança completa. Calendário UTC fixo é defeito confirmado ainda não corrigido.

## 13.2 Arquitetura e contrato

Reutilizada VirtualPortfolio; sem dependências novas ou reescrita de subsistema.
Cash, posição, margem, ledger e trades são privados. Posição é retornada por cópia;
coleções por cópia rasa com registros imutáveis de campos primitivos. Snapshots
possuem posição copiada e novos objetos exactUsd8, sem referências internas.
initialCapital é getter; instância não extensível impede shadowing dos getters.

Booking síncrono em memória:
1. Validate: tipos, datas, limites, posição, capacidade financeira.
2. Prepare: USD8, níveis de proteção, registro/trade e conversões que podem lançar.
3. Apply/commit: somente atribuições privadas após preparação; ledger não exposto.
4. Reconcile: snapshot verifica cash contra ledger e trades em inteiros.

Não é transação durável nem proteção contra encerramento do processo ou OOM.
Falhas de validação/conversão não deixam booking parcial. API explícita
updateTrailingStop permite somente stop positivo e movimento favorável.

Política: BigInt USD8 interno, arredondamento half-away-from-zero existente.
margin/commission/swap aceitam Number em USD por compatibilidade ou BigInt em
**unidades USD8** explicitamente. Inteiros não são serializados diretamente;
JSON conserva números de apresentação e strings exactUsd8. Consumidores que
precisem precisão devem usar strings exatas. Comissões e swap do simulador e
benchmark usam usdProduct diretamente até booking; margem exata fica privada.
Preços executáveis, sizing, propostas de margem, stops e métricas ainda usam
Number: precisão decimal ponta a ponta permanece PARTIAL. Alteração em contrato:
mutar posição/coleções públicas não modifica mais conta; atribuir getters lança.

## 13.3 Arquivos

- portfolio/virtual.js: encapsulamento, preparação antes de commit, USD8 direto,
  margem privada, validação de níveis representáveis, capital, motivo primitivo
  e cronologia de marcação.
- backtesting/index.js: custos USD8 sem roundtrip Number; trailing pela API.
- backtesting/passive.js: produtos decimais de margem/comissão/swap.
- tests/hardening-financial.test.js: seis cenários independentes de hardening.
- tests/quant-v2.test.js: expectativa antiga de adulteração do ledger migrou para
  isolamento defensivo; nenhuma asserção de reconciliação financeira removida.
- experiments/hardening-financial.js: experimentos A/B sem rede e com hashes.
- docs/quant-v3-hardening-audit.md e este relatório: evidência e pendências.

## 13.4 Testes

Ambiente local Node v26.13.0. Baseline: 74 casos existentes (65 FX + 9 raiz),
npm test: 10 arquivos; FX test:cases: 65/65; check aprovado.

Após alterações:
- node --test --test-isolation=none tests/*.test.js services/orion-fx/tests/*.test.js:
  **80/80 casos aprovados**, zero falhas.
- npm test: 11/11 arquivos aprovados.
- npm test --prefix services/orion-fx: 10/10 arquivos aprovados.
- npm run check: aprovado, orders disabled.
- git diff --check: aprovado.
- git diff --exit-code -- services/freqtrade compose.yaml Dockerfile: sem diff.

Regressão inclui oráculos existentes de 400 e 1200 roundtrips, long/short,
arredondamento, margem, stop-out, trailing, replay e invariância de prefixos.
Não executados: Node22 local, cobertura de linhas, crash recovery, breakers
administrativos, holdout protegido, bid/ask v2. Não se apresenta teste existente
como validação de funcionalidade nova não implementada.

## 13.5 Experimentos

Reprodução: node services/orion-fx/experiments/hardening-financial.js
Saída JSON contém configurações, hashes, resultados, invariantes e limitações.
Nenhum dataset gerado foi adicionado ao repositório.

A: TESTED. Seed LCG 20261105; 1200 roundtrips alternados, capital 100000,
entrada 1.1, 1000 unidades, margem 110, comissão .02 por lado, swap .03.
Ticks de saída entre -1000 e +1000, oráculo inteiro independente. Hash SHA256
0988737735ab1d15a8691fb4f0de9585481b074dfa5944770563fa8449ae52b4.
Cash final exato 9992190000000 USD8; cada operação reconciliada.

B: TESTED no contrato assessMargin + fechamento explícito do portfolio.
Capital 1000, entrada 1.1, 10000 unidades, margem 900, taxas 1+2;
long com saída .9 e short com saída 1.3. Margin call 100%, stop-out 50%.
Hash SHA256 2beecd58a83e2b3273ce991ef4da745b2109983a90e5457bdc16b860ebfe5680.
Saldo final de cada cenário -100300000000 USD8; sem crédito fictício.
Limite: esse experimento não valida lifecycle intrabar nem preços de corretora;
o teste V3 preexistente valida stop-out integrado no backtest.

C/D/E/F/G: PENDING como experimentos V3.1 dedicados. Testes anteriores de
DST/rejeição bid-ask/invariância/replay não substituem os controles pedidos.
Todos os resultados são sintéticos e não evidenciam rentabilidade.

## 13.6 Invariantes verificados

Cash = capital + ledger; equity = cash + PnL aberto; free margin = equity − margem;
realizado aplicado uma vez; comissão e swap uma vez; margem/exposição bruta não
negativas; exposição líquida assinada; posição ausente após close; perdas podem
gerar saldo negativo; nova entrada sem capital é rejeitada. Quantidade externa,
coleções e capital público não adulteram conta. Operações inválidas/overflow não
alteram cash/posição/ledger. Marca não antecede último booking. Stops trailing
não retrocedem. Datas de booking não retrocedem. Ordens externas permanecem
bloqueadas pelos testes existentes e check; nenhuma configuração externa mudou.

## 13.7 Riscos remanescentes

HIGH: calendário validador UTC fixo; manifestos não integrados automaticamente;
sem holdout protegido; sem breakers persistentes e recovery; sizing/execução em
Number; execução exclusivamente simulada, sem segurança operacional completa.
MEDIUM: custos informativos spread/slippage ainda usam produtos Number; margem
fixa avaliada na abertura; sem bid/ask OHLC; sem warm-up prefixado OOS; sem matriz
CI adicional, scanner de segredos ou cobertura medida. Limitações de arquitetura
não são apresentadas como defeitos matemáticos comprovados.

## 13.8 Status por fase

| Fase | Status |
|---|---|
| 0 auditoria/baseline | TESTED — auditoria focada registrada; não exaustiva |
| 1 financial integrity | PARTIAL — correções acima IMPLEMENTED/TESTED; preços/sizing Number restantes |
| 2 margin & exposure | PARTIAL — modelo existente e cenários negativos testados; sem ampliação intrabar |
| 3 calendar/data | PENDING |
| 4 OOS/holdout | PENDING |
| 5 circuit breakers | PENDING |
| 6 persistence/recovery | PENDING — decisão de armazenamento ainda não tomada |
| 7 CI/experimentos | PARTIAL — CI existente preservada; A/B executados |

Não avançar a uso contínuo antes de persistência/reconciliação fail-closed.
Próximo checkpoint: concluir fronteiras Number de risco/execução e margem antes
 de calendário, dados, isolamento estatístico e recuperação. Esta entrega não
cumpre os vinte critérios de aceitação globais.

## 13.9 Git e segurança

Branch feat/orion-quant-v3; HEAD c785bba34ed4db81fc4d3de337d5ff8ca43775d3.
Quatro arquivos rastreados modificados, quatro novos arquivos Orion (dois docs,
um teste, um experimento); services/freqtrade/scripts/ não rastreado preexistente.
Sem staging, commit, push, merge ou alteração de histórico. Freqtrade e Compose
intocados. Nenhuma leitura de .env/credenciais, autenticação, Docker ou envio de
ordens. TRADING_ENABLED=false preservado. Nenhuma dependência adicionada.
