# V3.2 D/E — entrega incremental PARTIAL

D: PARTIAL. E: PARTIAL. Não usar como paper contínuo nem produção pronta.
Baseline feat/orion-quant-v3, HEAD 3212951358d9545febd9021abf4e0f2690ca6fc6.
Baseline passou: npm test 14 arquivos, FX 13 arquivos, check orders disabled.
Único untracked anterior services/freqtrade/scripts/ preservado.

## Arquitetura e uso

persistence/journal.js: openJournal(directory, filename), submit(event),
recover(sessionId), close(), reserveHoldout(), consumeHoldout(), holdoutStatus().
Diretório deve existir, ser privado/confiável e ter caminho absoluto canônico.
Não cria diretórios implicitamente. SQLite node:sqlite verificado no Node26.13.0;
Node22 não disponível/verificado. Minors antigos de Node22 podem não fornecer
esta API: falha explícita ao abrir, sem fallback para armazenamento em memória.
Nenhuma dependência instalada. APIs anteriores não importam SQLite implicitamente.

SQLite escolhido por atomicidade, locking e rollback já implementados. FULL
synchronous, DELETE journal, busy timeout 1000ms, BEGIN IMMEDIATE por mutação.
Append-only exigiria protocolo próprio de framing, commit, locks e recuperação;
não foi escolhido. Constraints UNIQUE(session,id) e PRIMARY KEY(session,sequence).
Transações serializadas entre conexões; lock ocupado lança erro ao chamador.
Não há retry automático. Resultado submit só retorna depois de COMMIT.
Sem estado financeiro mutável em cache: projeção candidata ocorre antes do insert;
recover sempre lê journal. Commit ambíguo pode ser consultado/repetido pelo mesmo
ID. Duplicata retorna snapshot atual e idempotent:true; mesmo ID com qualquer
campo diferente rejeita. Sequência fora de ordem rejeita sem insert.

## Contratos e reconstrução

Envelope v1 estrito: eventId, sessionId, sequence, eventType, eventTimestamp,
schemaVersion, payload. Timestamp ISO UTC canônico fornecido pelo chamador;
sequência lógica independente do relógio. Tempo de registro não capturado.
Causation/correlation não implementados nesta versão (não aceitos como extras).
SHA256 da serialização canônica de TODO envelope armazenado separadamente.
Objetos simples, chaves ordenadas, números finitos; BigInt não serializado.
Custos/margem em strings inteiras USD8 não negativas; preços Number conservam
limites existentes. Payload limitado a 256KiB e profundidade 30; schemas exatos,
chaves perigosas e tipos desconhecidos rejeitados. Não serializar segredos:
schemas financeiros os excluem, mas reason/trigger são texto do chamador.

Eventos: inicialização, marca, abertura, encerramento, swap, pause, halt e reset
administrativo. Comissão faz parte de open/close atômico, sem débito redundante.
Replay valida versão, IDs, sequência, timestamp, hash, representação e contratos;
usa VirtualPortfolio existente, reconciliando ledger/trades em USD8. Recupera
cash/equity/PnL/posição/margem/exposição, ledger/trades, última marca e sequência.
Corrupção ou impossibilidade financeira lança erro; nunca recria saldo inicial.
Sem snapshots: replay completo é referência; desempenho O(n) por submit, e
histórico total em memória. Backup consistente/migrations além de v1 PENDING.
Não há reparação destrutiva nem truncamento automático.

## Risco e holdout

ACTIVE permite open; PAUSED/HALTED bloqueiam open e permitem close/swap/mark.
HALTED não é rebaixado por pause. Somente evento ADMINISTRATIVE_RESET com
LOCAL_ADMINISTRATIVE_RECOVERY e motivo explícito retoma ACTIVE. Isso é uma API
local administrativa, não autenticação nem sandbox contra chamador hostil.
Estado é reconstruído e persiste entre processos. Histórico contém transições,
mas métricas/config identity e classificação automática de triggers PENDING.
Erro de storage/recovery lança erro sem snapshot utilizável; não há supervisor
persistente que marque automaticamente HALTED após qualquer falha de disco.

createResearchSession(rows,{registry:journal}) integra reserva ANTES de execução
e consumo com identidade do resultado APÓS backtest/enrich. Sem registry mantém
API volátil anterior; status identifica VOLATILE versus DURABLE explicitamente.
Escopo conservador: hash canônico de dataset + schema + split completo + método;
independente de sessão, nome de arquivo, estratégia e parâmetros. Frozen completo
inclui estratégia/versão/parâmetros/configuração/metodologia. Mudanças de estratégia
ou parâmetros não ganham holdout limpo nesse escopo. Outro split é outro escopo;
não detecta sobreposição parcial entre splits distintos.
UNUSED = nenhuma linha; RESERVED = tentativa iniciada; CONSUMED = resultado
registrado. Falha/crash permanece RESERVED, exige allowReuse explícito e sinaliza
reuso não independente. Nenhum reset para UNUSED. Corrupção gera erro; estado
UNKNOWN_OR_INCONSISTENT não é retornado como enum. Não registra autorizações,
timestamps de reserva ou evaluationEventId na tabela: identidade é scope/attempt.
Status expõe tentativas duráveis. Consumo idempotente exige mesmo hash de resultado.
Operador que apaga banco/histórico pode contornar; não é proteção administrativa.

## Verificação e experimentos

Oito novos casos em tests/persistence-de.test.js, temporários isolados removidos:
- USD8 independente long, comissão/swap únicos, rollback de close inválido;
- PAUSED e HALTED preservados, redução de risco permitida;
- schema/BigInt/path traversal/symlink rejeitados;
- lock real de segunda conexão e alteração de envelope detectada;
- filho SIGKILL após commits com posição aberta e HALTED, resposta perdida;
- filho SIGKILL após reserva holdout, reuso entre processos;
- contínuo versus reaberto short: snapshots iguais, cash -90300000000 USD8;
- filho SIGKILL em transação SQLite não commitada: histórico intacto;
- fluxo real SYNTHETIC DATA → pesquisa/backtest → registry → nova sessão/reuso.
Alguns cenários estão agrupados no mesmo caso; não contar asserts como testes.
Teste pré-commit usa SQL direto para caracterizar rollback SQLite, não hook do
submit. Não é crash instrumentado em cada etapa da API. Sem sleeps arbitrários.

Regressão: 113/113 casos (105 anteriores + 8 novos), zero falhas.
npm test: 15/15 arquivos; npm test --prefix services/orion-fx: 14/14 arquivos.
npm run check: orders disabled; git diff --check: aprovado. Após ajuste de status
durável, 16/16 casos focados persistence/isolation passaram; gates repetidos na
entrega. Sem cobertura medida, sem porcentagens inventadas, Node22 não testado.

## Matriz de conclusão e riscos

| Item | Status | Limitação |
|---|---|---|
| D1 storage | IMPLEMENTED/TESTED | trusted local directory, Node26 |
| D2 contratos | PARTIAL | eventos financeiros mínimos; metadata pendente |
| D3 journal | IMPLEMENTED/TESTED | sem hash encadeado ou âncora externa |
| D4 recovery | IMPLEMENTED/TESTED | API nova; não restaura estratégia/pending signals |
| D5 snapshots | PENDING | deliberadamente sem snapshots |
| D6 risco | PARTIAL | transições persistentes; triggers/supervisor pendentes |
| D7 registry | PARTIAL | pesquisa integrada; metadados e matriz completa pendentes |
| E1 paper replay | PENDING | caminho antigo continua em memória |
| E2 concorrência | PARTIAL | lock segunda conexão testado; corrida multiprocesso pendente |
| E3 falhas | PARTIAL | SIGKILL real; matriz de hooks/disco cheia pendente |
| E4 segurança | PARTIAL | schemas/paths; filesystem hostil fora do contrato |
| E5 experimentos | PARTIAL | eventos contínuos/reabertos; paper end-to-end pendente |

CRITICAL: nenhum defeito confirmado classificado; não constitui auditoria externa.
HIGH: não integrar com paper sem checkpoints de estratégia/risco transacionais;
triggers automáticos, falha persistente de storage e concorrência adversarial
completa ausentes. Registro de holdout verifica checksum da linha incluindo status/resultado e
sequência das tentativas; não detecta remoção de sufixo válido por administrador.
MEDIUM: leitura O(n), memória não limitada globalmente, sem backup/schema migration,
sem detecção de remoção de sufixo válido do journal ou alterações por administrador;
sem defense contra troca concorrente de arquivos/sidecars em diretório hostil.
LOW: sem aceleração por snapshot. Hardware/filesystem pode violar fsync; FULL não
promete durabilidade absoluta diante de corrupção física ou falha do dispositivo.

## Arquivos, Git e revisão

Novos: persistence/journal.js, tests/persistence-de.test.js, este documento e
quant-v3-2-de-audit.md. Alterados: optimization/session.js, .gitignore Orion.
HEAD/branch preservados. Sem commit/push/staging/merge/rebase. Sem alteração
Freqtrade/Compose/Docker, leitura .env/credenciais, rede ou telemetria externa.
TRADING_ENABLED=false preservado; nenhuma API de transmissão adicionada.
V3.1 e B/C preservados pela regressão; registry é opt-in.

```sh
git status -sb
git diff --check
git diff -- services/orion-fx
node --test --test-isolation=none services/orion-fx/tests/persistence-de.test.js
npm test
npm test --prefix services/orion-fx
npm run check
```

Próximo incremento: expandir contratos e integridade registry; persistir contexto
da estratégia/temporalidade e triggers; então conectar paper replay antes de
alegar D/E completo. Executar matriz multiprocesso, ENOSPC/EACCES, hooks de falha,
Node22 escolhido e auditoria independente. Não habilitar trading real.
