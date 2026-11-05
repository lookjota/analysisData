# Orion Quant V3 — checkpoint incremental

## Auditoria inicial

Branch `feat/orion-fx-v1`, HEAD inicial `17b83c4`. Working tree inicialmente limpo
para arquivos rastreados; `services/freqtrade/scripts/` já não rastreado e intocado.
Não foram abertos credenciais, `.env`, arquivos Crypto ou dados privados.
Leitura de README, arquitetura raiz/FX, contratos, testes e módulos financeiros,
execução, risco, histórico, pesquisa, relatórios e CLI precedeu alterações.

Base: ESM JavaScript, sem dependências; ledger BigInt USD8, PnL decimal;
preços, indicadores, seleção e sizing Number; uma posição EUR/USD H1; sinais no
fechamento e entrada na próxima abertura. Dados canônicos v1 apenas mid.
Invariantes existentes eram úteis e foram preservados. Baseline executada:
55 casos FX, `npm test` (8 arquivos no Node26), `npm run check` aprovados.

Riscos de regressão: contratos JSON usados por replay/relatórios, hash canônico,
booking das taxas, arredondamento, semântica de stops e ordem temporal.
Plano por dependências: finanças → dados/calendário → OOS/holdout → breakers →
registro/recuperação/CI. Este checkpoint entrega reforços financeiros e parte
de dados/calendário. Não representa conclusão integral da V3.

## Alterações e invariantes

- `financial/decimal.js`: produto decimal antes de quantizar USD8.
- `portfolio/virtual.js`: exposição e free margin calculados em inteiros;
  snapshots aditivos `exactUsd8`, gross/net exposure; margem de entrada
  quantizada; rejeição de swap/close/reabertura cronologicamente anteriores.
- `financial/margin.js`: contrato `fixed-entry-margin-v1`, thresholds explícitos,
  margin call/stop-out, equity negativa e margem zero definidos.
- `backtesting/index.js`: modelo opt-in `marginModel`, liquidação virtual total,
  eventos auditáveis e taxas/swap com produto decimal. Modelo null mantém regra
  V2 de free margin negativa. Versão do simulador `3.0.0-phase1`.
- `calendar/forex.js`: convenção NY17 com IANA America/New_York, Europe/London,
  Asia/Tokyo; sessões e overlaps; feriados/exceções somente por datas declaradas.
- `market-data/manifest.js`: manifesto profundamente congelado, conteúdo/hash
  preservados, hash do manifesto, licença declarada, qualidade, cobertura,
  calendário, período solicitado [início,fim), gravação exclusiva e verificação.
  Rejeita mais de 100000 horas ausentes para limitar custo de calendário.
- `cli/offline.js`: comando `data:manifest`; aquisição deve ser informada.
- `tests/quant-v3-*.test.js`: referências independentes e 1200 roundtrips seeded.

Cash = capital inicial + lançamentos; equity = cash + PnL aberto; free margin =
equity − margem; net exposure = lado × gross exposure. Taxas são lançadas uma
vez. Stop-out não injeta crédito nem limita artificialmente perdas a zero.

Margem é fixa na entrada, não regra Capital.com. `marginModel` está disponível
na API JS; a CLI não configura thresholds. A avaliação ocorre na abertura,
após swap e stops de gap e antes das intenções; intrabar ainda usa stops OHLC.
Margin call é aviso; stop-out fecha a posição e bloqueia entradas naquele candle.
Pode haver reentrada em candles posteriores se outros limites permitirem.
Sem liquidação parcial, livro, margem contínua, proteção contra saldo negativo
ou garantias de preço. Thresholds têm até oito casas decimais.

JSON Number continua por compatibilidade; `exactUsd8` é a fonte contábil exata
nos snapshots. Produtos retornam a Number na fronteira de taxas do ledger:
próximo ao limite USD8, essa conversão ainda pode perder uma última casa.
Sizing, stops, cotação executável, margem proposta e métricas ainda são Number.
Não se afirma precisão decimal integral ponta a ponta.

## Reprodução offline

```sh
npm run test:cases --prefix services/orion-fx
node --test --test-isolation=none tests/*.test.js services/orion-fx/tests/*.test.js
npm run check
npm --prefix services/orion-fx start -- data:manifest --count 24 --acquired-at 2026-11-05T00:00:00Z
```

`--out v3-fixture-001` no último comando grava manifesto em diretório novo de
reports. Nomes existentes falham; resultados não são sobrescritos. Aquisição é
metadado declarado pelo chamador, não uma prova. Raw hash é opcional e não é
calculado pela CLI; `verifyManifest(rows, manifest)` verifica manifesto local
confiável, conteúdo, versão e metadados, não reproduz um experimento completo.

Experimento de consistência: seed LCG 20261105, 1200 trades alternando long/short,
preços em ticks inteiros, gaps de até 1000 ticks, comissões positivas/zero, swap,
reentradas e fechamento total; oráculo independente em inteiros. Não é estudo de
lucratividade nem dataset histórico. Teste de stop-out usa threshold hipotético
200%, exclusivamente para exercitar a transição determinística.

## Riscos remanescentes

| Severidade | Evidência e próxima ação |
|---|---|
| HIGH | Walk-forward V2 tem warm-up frio no teste; holdout é split, não cofre de seleção. Não interpretar resultado como validação independente completa. Implementar warm-up prefixado sem trades, protocolo de seleção e ledger de tentativas. |
| HIGH | Posição e coleções públicas mutáveis; reconciliação detecta parte da corrupção. Encapsular campos financeiros mantendo API de trailing explícita. |
| HIGH | Pipeline v1 não aceita bid/ask OHLC; não afirmar precisão histórica de execução. Implementar schema v2 sem alterar hash v1. |
| HIGH | Calendário V3 ainda não substitui `closedHour` UTC aproximado no validador/backtest V2. Manifesto usa IANA; consumidores antigos continuam regra V2. Integração explícita é próximo passo. |
| HIGH | Escrita exclusiva protege arquivo final, mas diretórios ancestrais controlados por terceiros/symlinks não são sandbox robusto. Usar diretório local confiável; endurecer persistência antes de operação contínua. |
| HIGH | Sem diário persistente transacional/crash recovery; replay não é execução contínua recuperável. |
| MEDIUM | Margem por abertura e Number residual; ampliar testes de limites e produtos exatos até booking. |
| MEDIUM | Feriados declarados; sem calendário oficial de corretora, agregação M1/H4/D1, ou adaptação nativa de fontes. |
| MEDIUM | Sem bootstrap temporal, múltiplas comparações, gates V3 e estimativa de trades independentes. |
| LOW | CI existente Node22; Node26 e auditoria automática de segredos/dependências não ampliados neste checkpoint. |

Nenhum risco CRITICAL novo confirmado; a auditoria de segurança integral está
pendente. Não existe evidência de prontidão operacional ou vantagem estatística.

## Matriz e continuidade

| Checkpoint | Estado deste incremento |
|---|---|
| A Market data | PARTIAL — manifesto/qualidade testados, CSV V2 preservado; fontes nativas e bid/ask pendentes |
| B Calendar | PARTIAL — sessões/DST/feriados declarados TESTED; integração e agregação PENDING |
| C Financial | PARTIAL — reconciliação/exposição/stop-out/1200 operações TESTED; Number residual |
| D Execution | PARTIAL — V2 preservada; margem opt-in testada; lifecycle/latência/stale PENDING |
| E Statistical | PENDING — auditoria identifica limites V2; nenhuma alegação OOS nova |
| F Strategy research | PENDING — estratégias existentes preservadas |
| G Risk | PARTIAL — stop-out integrado TESTED; breakers administrativos e stress lab PENDING |
| H Experiment registry | PENDING — manifesto de dataset não equivale a registry/replay de experimento |
| I CI/security | PARTIAL — CI V2 preservado; check local executado; auditoria completa PENDING |
| J Reports | PENDING — relatórios existentes preservados |
| K Readiness | PENDING — sem persistência ou recuperação nova |
| Historical acquisition | BLOCKED nesta entrega — nenhum dataset com direitos de uso confirmados |

Último checkpoint: finanças reforçadas + contratos de calendário/manifesto local.
Continuar primeiro eliminando Number em booking e protegendo estado da posição;
depois integrar calendário selecionável ao pipeline e manifests nos resultados,
implementar schema bid/ask separado e agregação testada. Somente então avançar
para warm-up OOS, holdout, bootstrap temporal e gates. Não escolher parâmetros
em holdout. Não avançar para dashboards/ML ou execução externa.

Sem dependências novas, commit, push, merge, deploy, autenticação ou ordens.
TRADING_ENABLED=false. Freqtrade e Docker permanecem intocados.

## Validação final efetivamente executada

- `node --test --test-isolation=none tests/*.test.js services/orion-fx/tests/*.test.js`:
  **74 casos, 74 aprovados, 0 falhas** (65 FX + 9 raiz).
- `npm test`: **10 arquivos aprovados**, 0 falhas (isolamento padrão Node26).
- `npm test --prefix services/orion-fx`: **9 arquivos aprovados**, 0 falhas.
- `npm run check`: aprovado, saída `orders disabled`.
- `git diff --check`: aprovado.
- `data:manifest --count 24 --acquired-at 2026-11-05T00:00:00Z`: execução CLI
  offline aprovada, stdout capturado em `/tmp/orion-v3-manifest.log`.
- Testes de CLI substituem fetch por função que falha; nenhum acesso de broker
  é necessário. Testes antigos do adaptador utilizam transporte simulado.
- `git diff --exit-code -- services/freqtrade compose.yaml Dockerfile`: sem diff.

Cobertura de linhas não medida; contagens não equivalem a prova formal nem
cobertura completa. Node22 não foi executado localmente.

Estado final: branch `feat/orion-fx-v1`, HEAD
`17b83c4cecc27d2e37852a8abbd0bc424d768546`, alterações não commitadas.
Cinco arquivos rastreados modificados e sete novos arquivos no serviço FX.
`services/freqtrade/scripts/` continua não rastreado preexistente.
`services/orion-fx/reports/` e `services/orion-fx/data/samples/` são ignorados;
seu conteúdo não foi inspecionado. Nenhum arquivo ignorado foi adicionado ao Git.

Revisão sugerida (sem executar commit automaticamente):

```sh
git diff --check
git diff -- services/orion-fx
git ls-files --others --exclude-standard services/orion-fx
# Revisar também o conteúdo dos sete arquivos novos antes de staging.
git add -- services/orion-fx
git diff --cached --stat
git diff --cached --check
git diff --cached
# Somente após revisão local:
git commit -m "feat(orion-fx): add V3 financial and dataset audit checkpoint"
```
