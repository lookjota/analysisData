# V3.2 — incremento de integração de dados

Estado global: **PARTIAL**. Checkpoint 0 concluído; incremento A implementado e
testado para backtest/replay/relatório/CLI. B–G não implementados neste incremento.
Não há prontidão para paper trading contínuo nem operações reais.

## Baseline

Branch feat/orion-quant-v3; HEAD a391199767a16e1c52670547870091ea10c23ebd.
Node v26.13.0. Baseline: npm test 11 arquivos, FX 10 arquivos, check aprovado.
80 casos individuais anteriores. Apenas services/freqtrade/scripts/ preexistente
não rastreado; preservado. Auditoria em quant-v3-2-audit.md.

## Implementação e contratos

- calendar/forex.js: abertura domingo/fechamento sexta configuráveis por hora e
  timezone IANA; sessões existentes preservadas; exceções explícitas [start,end)
  OPEN/CLOSED/REDUCED_LIQUIDITY, sem sobreposição. Feriados NY locais declarados.
- market-data/historical.js: opções calendarMode, calendar, gapPolicy; qualidade,
  contexto temporal e sessão por candle separados dos preços canônicos.
- market-data/manifest.js: schema v2 opt-in conserva configuração, política,
  qualidade e declaração de proveniência; v1 padrão preservado. Configurações
  novas de calendário exigem modo explícito para não desaparecerem do manifesto.
- backtesting/index.js: dataValidation e provenance opcionais; qualidade e
  manifesto acompanham dataset no JSON/HTML; gap desconhecido exige reconhecimento.
- paper/replay.js: mesma validação configurada do backtest.
- cli/offline.js: --calendar-mode e uso de --acquired-at em backtest/report/replay.
- tests/integration-v3-2-data.test.js: seis casos de integração/contrato.
- docs/quant-v3-2-audit.md e este arquivo: auditoria e entrega.

Default: legacy-utc22 (compatibilidade, aproximação conhecida). calendar-v1 usa
convenção NY17 declarada, não calendário universal de fornecedor. calendar:null
na API significa UNKNOWN; nunca substituído por calendário verificado. CLI
seleciona apenas convenção padrão; configurações específicas são API JS.

Timestamp canônico UTC representa abertura; fechamento = abertura + 1h; fonte
original de timezone UNKNOWN após normalização. sessionMetadata preserva estado
esperado e identificadores conhecidos. Não modifica CSV nem hash canônico v1.
Política warn registra gaps; reject rejeita ausências/UNKNOWN. Backtest exige
allowSessionGaps para continuar com esses gaps. Nunca preenche candles.

Categorias de gap: EXPECTED_MARKET_CLOSURE, DECLARED_HOLIDAY,
DECLARED_SCHEDULE_EXCEPTION, MISSING_DATA, UNKNOWN_GAP. Erros fatais preservam
mensagens anteriores e adicionam classification INVALID_TIMESTAMP,
DUPLICATE_CANDLE ou OUT_OF_ORDER. Dados inválidos não viram candles utilizáveis.

Manifesto só acompanha backtest quando provenance é informado; timestamp de
 aquisição não é inventado. licença e origem são declarações. Raw hash opcional;
não prova aquisição/autenticidade/licença. v1 continua verificável no caminho
legado. Calendários novos produzem v2 explicitamente, sem migração silenciosa.

## Integração e reprodução

Teste local: CSV exportado em diretório temporário → importCsv(calendar-v1) →
backtest(dataValidation, provenance) → datasetManifest v2 → enrich/htmlReport.
Teste chama CLI real runOffline com CSV, calendário e aquisição; fetch lança
NETWORK_FORBIDDEN. Verifica hash, adulteração de preço/metadados e manifestação
no relatório. Replay e batch com fim de semana de verão produzem mesmas curvas
 e metadados; segunda execução do batch é idêntica. Todos os preços são fixtures
sintéticas; nenhuma alegação empírica de retorno.

```sh
node --test --test-isolation=none services/orion-fx/tests/integration-v3-2-data.test.js
npm --prefix services/orion-fx start -- backtest --count 24 --strategy no-trade --calendar-mode calendar-v1 --acquired-at 2026-11-05T00:00:00Z
```

## Testes e cobertura

Node26 efetivamente executado; Node22 não executado localmente.
- Seis novos casos focados aprovados; quatro falharam antes da implementação
  nas lacunas esperadas (fixture inicialmente corrigida antes dessa evidência).
- Regressão individual final: 86/86 casos aprovados, zero falhas.
- npm test: 12/12 arquivos aprovados; FX: 11/11 arquivos aprovados.
- npm run check: orders disabled; git diff --check aprovado.
- Sem diff em services/freqtrade, compose.yaml e Dockerfile.
- Cobertura medida antes do último sexto caso: 85/85; linhas 97,79%, branches
  89,39% dos arquivos carregados. Manifest branches 72,22%, research 66,67%,
  passive 69,23%: contratos/falhas adicionais continuam necessários.
  Cobertura não comprova funcionalidades inexistentes nem segurança operacional.

## Matriz de cenários

| Cenário | Status | Evidência ou impedimento |
|---|---|---|
| A CSV/calendário/manifesto | TESTED | teste ponta a ponta novo |
| B gap inesperado | TESTED | qualidade e gate backtest |
| C DST EUA | TESTED | regressão V3 + verão integrado |
| D DST britânico | TESTED | sessões março/abril |
| E divergência EUA/Reino Unido | TESTED | março e regressão outubro |
| F bid/ask inválido | PARTIAL | rejeição existente; contrato B pendente |
| G futuro alterado | PARTIAL | testes existentes de prefixo, faltam fronteiras C |
| H warm-up insuficiente | PARTIAL | estratégias existentes, OOS prefixado pendente |
| I otimização acessa holdout | PENDING | sem guard |
| J walk-forward sobreposto | PARTIAL | gerador sem overlap; fluxo C pendente |
| K pausa spread | PENDING | sem máquina de estados |
| L halt contábil | PENDING | reconciliação existe, halt persistente não |
| M restart HALTED | PENDING | sem persistência |
| N duplicate fill | PENDING | sem journal |
| O evento fora de ordem | PARTIAL | ledger rejeita tempo invertido; sequência durável ausente |
| P persistência interrompida | PENDING | sem journal |
| Q snapshot corrompido | PENDING | sem snapshot persistente |
| R recovery posição aberta | PENDING | replay não é recovery |
| S gap adverso recovery | PENDING | gaps financeiros testados; recovery ausente |
| T USD8 | TESTED | regressão hardening e oráculos V3 |
| U ordens externas | TESTED | guards existentes/check; transportes simulados |
| V Freqtrade intocado | TESTED | nenhum diff rastreado; scripts não manipulados |
| W offline sem .env | TESTED | CLI offline, fetch bloqueado, sem leitura .env |
| X replay após restart | PENDING | batch/replay em memória testado, sem restart durável |

## Resiliência, riscos e próximos passos

CRITICAL: nenhum novo defeito dessa severidade comprovado; não equivale a auditoria
integral. HIGH: holdout sem isolamento técnico, risco sem estado persistente,
journal/recovery inexistentes. MEDIUM: legacy UTC22 padrão, manifesto opcional,
configuração de fornecedor não exposta na CLI, preços/sizing Number, cobertura
de falhas incompleta. LOW: Node22 local não testado.

Checkpoint A permanece PARTIAL no escopo global: benchmark passivo não migrou
para calendário/manifesto; CLI rejeita explicitamente novas opções nesse caminho.
Padrão antigo do benchmark preservado. Qualidade não atesta fonte autorizada;
recordsDuringClosure informa divergência, não acusa fornecedor automaticamente.
Nenhuma correção automática de preços, timezone de origem ou proveniência.

Antes de históricos reais: confirmar direitos/fonte e calendário do fornecedor,
completar benchmark e B. Antes de paper contínuo: C, D, E e F com fault injection,
reconciliação e armazenamento local seguro. Depois G (lockfiles/CI/offline gates)
e registry científico completo. Dashboard e integração operacional não iniciados.

SQLite versus journal ainda não avaliado em profundidade: checkpoint E PENDING;
nenhuma decisão de atomicidade ou recuperação é apresentada como implementada.
Registry, seeds e identidade de experimento completa PENDING; fixtures determinísticas
sem aleatoriedade neste incremento, hashes existentes preservados. Sem Date.now
ou Math.random novos nos cálculos.

## Git e revisão

Seis arquivos de implementação modificados; três arquivos novos (dois documentos,
um teste). Sem commit, push, merge, staging, dependências novas ou mudança de main.
Sem acesso a credenciais/.env, autenticação real, Docker ou ordens externas.
TRADING_ENABLED=false preservado. Scripts Freqtrade não incluídos.

```sh
git status -sb
git diff --check
git diff -- services/orion-fx
git ls-files --others --exclude-standard services/orion-fx
node --test --test-isolation=none tests/*.test.js services/orion-fx/tests/*.test.js
npm run check
```
