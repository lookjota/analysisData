# Orion Quant V3.2-F — PARTIAL

Entrega incremental de replay durável por intenções explícitas. **O CHECKPOINT F
completo não foi atingido.** O replay de estratégias por prefixos e o CLI continuam
no caminho legado. A nova API processa marks e intenções reais de replay em SQLite;
os testes não são exclusivamente testes isolados do journal. Não existe ligação
automática entre createStrategy/backtest e esta API. Não utilizar como replay
integral das estratégias existentes nem como sistema de execução externa.

## Baseline e auditoria

Branch feat/orion-quant-v3, HEAD d96ddce. Node v26.13.0. Baseline aprovada:
npm test (15 arquivos), npm test --prefix services/orion-fx (14 arquivos), npm run
check (orders disabled). Detalhes e plano em quant-v3-2-f-audit.md. Único untracked
anterior: services/freqtrade/scripts/, preservado. Não foram instaladas dependências.

## Arquitetura e APIs

paper/replay.js reexporta openDurableReplay de paper/durable.js; replay(rows,...)
continua compatível. Importar não abre SQLite. Não há fallback DURABLE → memória.
O legado é volátil/não recuperável; sua saída ainda não recebeu durabilityMode.

openDurableReplay({directory, filename, configuration, create:false}) retorna:
submitMarketEvent(input), submitVirtualIntent(input), administrativeRecover(input),
getReplaySnapshot(), getReplayReport(), getRiskState(), recoverReplay(), closeReplay().
create:true exige sessão ausente; false exige sessão existente. Nunca reinicializa
sessão faltante implicitamente. O diretório deve existir, ser privado e canônico;
as verificações NOFOLLOW, hardlink, basename e exclusão Freqtrade são herdadas.
Não há CLI para aceitar caminhos; a API recebe diretório confiável do chamador.
Não é proteção contra proprietário hostil ou troca concorrente de diretórios.

configuration exige exatamente:
- sessionId: identificador alfanumérico com underscore/hífen, até 128 caracteres.
- datasetIdentity, strategyIdentity, configurationIdentity: SHA256 hex declarado.
- initialCapital: USD positivo, validado também pelo portfolio existente.
- executionModelVersion: explicit-intent-v1; riskModelVersion: simulation-v1.
- journalSchemaVersion: 1; clockPolicy: EXPLICIT_UTC.
- recoveryPolicy: VERIFY_FULL; durabilityMode: DURABLE.
- risk: opções existentes de riskConfig; {} aplica os defaults existentes.
- quotePolicy: maxAgeMs e maxSpread positivos, obrigatórios, sem limite universal.

A configuração efetiva normalizada é persistida e comparada integralmente ao
reabrir. configurationHash é hash da configuração completa. Identidades declaradas
não certificam conteúdo de dataset ou código de estratégia; validação do dataset
completo ainda depende da futura integração. Limites das fixtures são hipóteses
sintéticas de teste, não recomendações financeiras.

input exige exatamente sourceId, sequence, timestamp ISO UTC, kind e payload.
A sessão é vinculada pelo handle. Sequência de input começa em 1 e é distinta da
sequência do journal, que inclui efeitos e transições. Payloads:

| kind | payload |
|---|---|
| mark | bid, ask, quoteTimestamp |
| entry | side, stopDistance, takeDistance, commissionUsd8 |
| exit | reason, commissionUsd8 |
| swap | amountUsd8 |
| administrative | reason |

Valores USD8 são strings inteiras não negativas. Preços e limites seguem contratos
Number existentes. Payload canônico limitado a 256KiB e profundidade 30. Relógio
explícito; inicialização usa origem fixa 1970-01-01T00:00:00.000Z, logo eventos
anteriores a essa origem não são aceitos. Não usa Date.now dentro do supervisor.

## Atomicidade, idempotência e fluxo

journal.appendPlanned(session,planner) executa leitura, projeção e planejamento
sob BEGIN IMMEDIATE; valida a projeção candidata inteira usando VirtualPortfolio,
insere todos os eventos e só retorna após COMMIT. FULL synchronous e DELETE journal
preservados. Snapshot é resultado confirmado; não existe portfolio mutável em cache.
Entrada, comissão e margem usam o evento de open já existente; swap/close também
reutilizam contratos existentes. Mark após entry contabiliza spread no preço de
liquidação, e sizing recebe spread como custo por unidade.

Fluxo: schema/canonical → lock → histórico validado → sequência/timestamp → risco
prévio → efeitos isolados → reconciliação USD8 → risco posterior → inserts → COMMIT
→ retorno. REPLAY_INPUT, REPLAY_OUTCOME e REPLAY_RISK_TRANSITION acompanham efeitos
na mesma transação. São extensões de tipos da versão 1, sem alterar tabelas nem
migrar eventos antigos. Leitores antigos não conhecem esses novos tipos.

sourceId é identidade de negócio do input, independente do ID de cada efeito.
IDs dos efeitos são SHA256(sourceId,index). Mesmo sourceId e input canônico retorna
idempotent:true, sem efeitos; mesmo sourceId diferente rejeita. Mesmo input sequence
com outro sourceId rejeita; saltos e regressão de tempo rejeitam. Duplicata retorna
snapshot ATUAL, não necessariamente o snapshot original do input. Reenvio com novo
sourceId E nova sequência é uma nova operação: inferência de equivalência de swaps,
fees e ordens por identidade externa ainda PENDING. Não deduz igualdade por preço
ou timestamp. Fee avulsa não é suportada; comissão só em open/close.

Resultado desconhecido de COMMIT não é compensado com transação inversa. Falha fora
do planejamento leva a DEGRADED, diagnóstico sanitizado e exige recoverReplay ou
reabertura. Após validação, reenvio do mesmo input consulta o journal e aplica uma
vez. Não há publicação posterior em cache que possa ficar parcialmente atualizada.

## Lifecycle, risco e recovery

NEW → INITIALIZING (create) ou RECOVERING (open) → READY; erros de storage durante
uso → DEGRADED; close → CLOSED, idempotente. Etapas iniciais são síncronas dentro
da abertura e não observáveis externamente. READY significa estrutura validada.
DEGRADED/CLOSED rejeitam alterações financeiras. Fechar não encerra posições.

Risco é ACTIVE/PAUSED/HALTED, separado de lifecycle. Supervisor usa riskConfig,
assessIntent e assessMargin, sem mudar evaluateOrder/TRADING_ENABLED.

| Verificação | Momento | Política |
|---|---|---|
| daily loss | pré-input e pós-efeito/mark | PAUSED / DAILY_LOSS_LIMIT |
| drawdown | pré-input e pós-efeito/mark | HALTED / DRAWDOWN_LIMIT |
| free margin / stop-out | pré-input e pós-efeito/mark | HALTED / MARGIN_LIMIT |
| exposição/leverage | pré-input e pós-efeito/mark | HALTED / EXPOSURE_LIMIT |
| quote ausente/inválida/stale/spread | mark, pré-entry, admin | PAUSED com code estável |
| sizing/config | configuração e assessIntent pré-entry | rejeita configuração ou registra outcome |
| accounting/storage | leitura/projeção | fail-closed DEGRADED; não alega HALTED durável |

Transições automáticas incluem previousRiskState, riskState, reasonCode,
riskMetrics e configurationHash; sessionId, eventId, sequence e eventTimestamp
estão no envelope. Não há downgrade automático de HALTED. PAUSED/HALTED bloqueiam
entry, permitem mark/swap e close com quote elegível. Não há auto-liquidação.
Admin é método distinto; exige posição fechada, quote elegível, motivo explícito
e ausência de trigger financeiro. Não existe autenticação administrativa local;
o contrato distingue superfícies de API, não isola código hostil no processo.
O evento administrativo legado não tem todas as métricas das transições novas.

Recovery valida journal/checksums/schema/cronologia, identidade da configuração,
sequência e unicidade de inputs e reproduz ledger/trades/posição/custos/margem via
VirtualPortfolio. Snapshots e relatório são calculados de uma única leitura do
histórico, sem cache financeiro. PAUSED/HALTED persistidos não são limpos. Inputs
novos reavaliam triggers antes de entry. Ausência de quote é tratada no primeiro
input de entrada; não há validação de frescor por wall clock durante open.

## Testes e experimentos

13 casos novos em tests/durable-replay-f.test.js; SQLite temporário real:
1. Long entry, swap, recuperação aberta, close, USD8 independente e duplicata.
2. Short contínuo versus reabertura: snapshots equivalentes.
3. Daily loss → PAUSED, restart, tentativa de bypass/admin inseguro.
4. Margin → HALTED, restart, bloqueio de entry e close permitido.
5. Stale, spread e quote inválida persistem PAUSED sem aplicar mark inválido.
6. Sessão faltante/existente/config incompatível/close/reopen.
7. Lock real, DEGRADED, recovery explícito e duplicata entre conexões.
8. Plano financeiramente inválido sem efeitos; corrupção de digest bloqueia open.
9. Reset administrativo válido com estado flat e quote saudável.
10. Filho SIGKILL após open confirmado; reenvio sem custo duplicado.
11. Trigger SQLite ABORT no insert de open após insert de input: rollback total.
12. Equity negativa -799200000000 USD8 preservada após restart com política sintética.
13. Dois filhos com barreira IPC disputam mesma intenção: um efeito, um NO_OP.

Oráculo long usa inteiros independentes: 1000 + 400*(1.1-1) - 1 - 2 - 1 =
1036 USD, sem chamar funções financeiras da implementação. Short termina 1002 USD.
SIGKILL acontece após commit notificado ao controlador; consumidor pode ignorar
resultado e reenviar. Não é injeção específica entre COMMIT e retorno dentro da API.
Rollback após insert é falha SQL real, não crash durante esse insert. Corrida usa
READY/GO por IPC, sem sleeps. Testes D/E continuam caracterizando SIGKILL SQLite
pré-commit; não atribuir essa cobertura a cada etapa do novo pipeline.

Gates finais e contagens registradas após execução. Cobertura percentual não medida.

## Matriz de checkpoints

| Checkpoint | Status | Limite |
|---|---|---|
| F0 baseline/auditoria | TESTED | auditoria local, não externa |
| F1 contrato durável | IMPLEMENTED / TESTED | stream de intenções explícitas |
| F2 atomicidade | IMPLEMENTED / TESTED | matriz completa de commit ambíguo pendente |
| F3 idempotência | PARTIAL | nova identidade + nova sequência pode ser nova operação |
| F4 supervisor | PARTIAL | sem stops/trailing automáticos nem estratégia integrada |
| F5 transições | PARTIAL | automáticas completas; admin usa evento legado |
| F6 storage supervisor | PARTIAL | lock/SQL abort/corrupção testados; demais falhas pendentes |
| F7 recovery | PARTIAL | stream recupera; pending/contexto da estratégia pendentes |
| F8 lifecycle | IMPLEMENTED / TESTED | estado NEW interno; sem processamento assíncrono |
| F9 CLI/report | PARTIAL | relatório via API; CLI e HTML existentes não integrados |
| F10 matriz adversarial | PARTIAL | não alegar aprovação dos 52 cenários |

Aceitação solicitada:

| Itens | Status |
|---|---|
| 1 replay principal usa journal | PARTIAL: API nova usa SQLite; replay de estratégia legado não |
| 2 compatibilidade legada | TESTED pelas regressões |
| 3-4 atomicidade/duplicatas | TESTED no contrato explícito |
| 5-6 storage/recovery | TESTED nos casos descritos, matriz parcial |
| 7-10 supervisor/pause/halt/degraded | TESTED no stream explícito |
| 11 inconsistência rejeitada | TESTED digest e configuração; matriz parcial |
| 12 replay contínuo/recuperado | TESTED short stream; estratégia completa PENDING |
| 13 interrupção real | TESTED SIGKILL pós-commit |
| 14 concorrência sem duplicação | TESTED mesma intenção em dois processos; diferentes IDs PENDING |
| 15 relatório modo/integridade | IMPLEMENTED API; CLI/HTML PENDING |
| 16-19 isolamento/regressões/runtime | verificação local e gates finais |
| 20 documentação | IMPLEMENTED, limitações explícitas |

Matriz adversarial completa: 1-5,7-10,14-16,18,21,23-25,27-30,31,33,35,37-39,
41-43 e 47 têm evidência integral ou parcial nos casos acima; não são 37 testes
independentes. Cenários 6,11-13,17,19-20,22,26,32,34,36,40,44-46,48-52 exigem
integração/injeção ou caracterização específica adicional para aprovação F, mesmo
quando regressões D/E/B/C já exercitam componentes relacionados.

## Limitações e riscos

HIGH: estratégia/candles/pending/calendar/DST não conectados ao replay durável;
sem execução automática de stop-loss/take-profit/trailing. Não descrever como
paper replay principal completo. Custos declarados por intenção, sem swap/calendário
automáticos ou escalonamento de custos por candle.
HIGH: ENOSPC/EACCES/IOERR/COMMIT ambíguo/interrupção durante transição/publicação
não têm injeção específica. Fail-closed após indisponibilidade é bloqueio local,
não HALTED persistido. Não houve defeito CRITICAL demonstrado; revisão não externa.
MEDIUM: context() reproduz prefixos (O(n²) por input no pior caso), histórico sem
limite global/snapshot/backup; não adequado a streams grandes.
MEDIUM: configuração/dataset declarados por chamador; low-level journal continua
API administrativa confiável. Alteração por proprietário e remoção de sufixo válido
não têm âncora independente. Não há sandbox de estratégia maliciosa.
LOW: FULL depende de filesystem/hardware. Sem teste Node22, sem cobertura medida.

Não há novos adapters, chamadas de rede ou autenticação. Nenhuma execução Docker,
acesso a .env/credenciais, alteração Freqtrade/Crypto ou bancos Freqtrade. Regras
TRADING_ENABLED=false preservadas. Runtime *.sqlite e sidecars já ignorados.

## Arquivos e próximos passos

Criados: paper/durable.js; tests/durable-replay-f.test.js;
tests/fixtures/durable-replay-child.js; tests/fixtures/durable-replay-race.js;
docs/quant-v3-2-f-audit.md; docs/quant-v3-2-f-delivery.md.
Modificados: persistence/journal.js; paper/replay.js. Sem commit/push/merge/rebase.

Próximo incremento: conectar o executor de estratégia existente ao planner com
contexto transacional e política de stops/calendário; depois CLI/HTML, identidade
lógica de custos, fault injection completa e paridade contínua versus dois processos
para o mesmo dataset. Requer nova evidência antes de promover F a completo.

## Resultados finais medidos

- npm test: PASS, 16/16 arquivos, zero falhas.
- npm test --prefix services/orion-fx: PASS, 15/15 arquivos, zero falhas.
- npm run test:cases --prefix services/orion-fx: PASS, **117/117 casos**,
  incluindo os 13 novos casos F; zero skips/cancelamentos.
- npm run check: PASS, Node v26.13.0, orders disabled.
- git diff --check: PASS.
- git diff --name-only -- services/freqtrade: vazio.
- git ls-files dos padrões SQLite e sidecars: vazio.
- git check-ignore services/orion-fx/runtime/checkpoint-f.sqlite: ignorado.

A baseline informada pelo pedido era 113 casos; os comandos baseline padrão
reportaram arquivos, não casos. A contagem final efetivamente medida foi 117;
não inferir 126 nem afirmar que a baseline de 113 foi confirmada por contagem.

Estado Git: branch/HEAD preservados, dois arquivos rastreados modificados e seis
arquivos novos Orion FX. services/freqtrade/scripts/ continua untracked anterior.
Nenhum staging, commit, push, merge ou remoção de arquivo preexistente.
