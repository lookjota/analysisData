# Orion FX — observação Demo e pesquisa offline

Infraestrutura independente para EUR/USD H1, pesquisa offline e observação
Capital.com Demo. Execução externa permanece desativada. Módulos offline não
recebem credenciais e não dependem da autenticação.

## Pesquisa offline (novo)

```bash
npm --prefix services/orion-fx start -- backtest --strategy trend --out minha-pesquisa
npm --prefix services/orion-fx start -- backtest --strategy mean-reversion
npm --prefix services/orion-fx start -- compare
npm --prefix services/orion-fx start -- paper:replay --count 250
npm --prefix services/orion-fx start -- data:validate --help
```

Sem `--input`, todos os preços são **sintéticos**. Os resultados não evidenciam
desempenho no mercado real. Relatórios ficam em `reports/<nome>/`, ignorados pelo
Git, com JSON, CSV de trades/equity/métricas e HTML autocontido. Nomes existentes
não são sobrescritos. Nenhuma dependência adicional foi instalada.

Guias: [arquitetura e auditoria](docs/architecture.md), [dados](docs/data.md),
[indicadores](docs/indicators.md), [estratégias](docs/strategies.md),
[backtesting](docs/backtesting.md), [risco](docs/risk.md), [paper](docs/paper.md),
[métricas](docs/metrics.md), [CLI](docs/cli.md), [dashboard](docs/dashboard.md),
[roadmap e limitações](docs/roadmap.md), [validação executada](docs/validation.md).

A seção V1 abaixo documenta o adaptador de leitura existente; a árvore histórica
e a observação-onlyStrategy referem-se à fundação anterior. A árvore atual e os
contratos de pesquisa estão no guia de arquitetura.

## Auditoria e decisões

Auditoria anterior às alterações: raiz com `type: module`, Node >=22, JavaScript
sem dependências e testes `node:test`. Ambiente auditado: Node 26.13.0. Não há
configuração TypeScript; esta versão mantém JavaScript ESM e JSDoc para evitar
introduzir compilação e dependências. CI existente utiliza Node 22.

`src/contracts.js` valida sinais e intenções com venues limitadas a Freqtrade,
Hummingbot e MT5; não representa Capital.com. `src/risk.js` bloqueia execução;
`src/server.js` fornece status local. Esses arquivos foram preservados. O novo
serviço tem seu próprio bloqueio permanente e não produz intenções executáveis.

Freqtrade ocupa `services/freqtrade/`, com Compose, estratégias, configurações e
dados próprios. Nenhum conteúdo privado, configuração, log ou banco dessa pasta
foi lido. Nenhum arquivo Crypto ou Compose foi alterado. A CLI FX não abre portas,
não usa SQLite, não lê `.env` da raiz nem depende de processos Crypto. A pasta
`services/freqtrade/scripts/` já estava não rastreada antes desta implementação.

Fluxo: CLI → configuração → broker Demo → normalização de dados. Estratégias
recebem somente dados e retornam observações; não há conexão com um executor.

## Arquivos

```text
services/orion-fx/
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── brokers/capital-demo.js
├── cli/index.js
├── config/index.js
├── market-data/index.js
├── risk/index.js
├── strategies/index.js
└── tests/orion-fx.test.js
```

- `config`: exige Demo, host exato, execução desativada, timeout válido e
  credenciais locais; segredos não aparecem em serialização comum.
- `brokers`: autenticação, contas, descoberta exata de EUR/USD, snapshot,
  candles HOUR e logout. Tokens privados apenas em memória. Transporte aceita
  somente os endpoints previstos e rejeita redirecionamentos.
- `market-data`: bid/ask (`offer` no snapshot), spread absoluto e em pips
  (EUR/USD: 0,0001), OHLC com ambos os lados e timestamps UTC.
- `risk`: decisões sempre negadas e lista restrita de métodos/caminhos HTTP.
- `strategies`: interface JSDoc para pesquisa futura e estratégia sem observações.
- `cli`: consultas pontuais e logout em `finally`, inclusive após falhas de dados.
  Exceções, cabeçalhos e corpos de erro externos não são impressos.

## Executar no Arch Linux

```bash
sudo pacman -S --needed nodejs npm
cd /home/look/Downloads/orion-trading-engine
npm test --prefix services/orion-fx
npm --prefix services/orion-fx start -- status

cd services/orion-fx
(umask 077; cp -n .env.example .env)
chmod 600 .env
# Edite .env localmente com seu editor; não cole credenciais no terminal/chat.
npm run demo -- auth
npm run demo -- accounts
npm run demo -- discover
npm run demo -- quote
npm run demo -- candles 24
```

Não há dependências para instalar. O comando `start` usa somente variáveis do
processo; `demo` carrega explicitamente `.env` relativo ao diretório do serviço.
`status` funciona offline e sem credenciais. Cada comando de consulta autentica,
realiza as leituras e encerra a sessão. Contas retornadas pertencem ao host Demo;
`accountType=CFD` não é um marcador de ambiente Live/Demo. A CLI omite nome e saldo.

Testes usam exclusivamente credenciais inventadas e `fetch` simulado; nenhum
teste acessa uma corretora. A descoberta padrão de `npm test` na raiz também
inclui os testes FX. Para relatório individual neste Node:

```bash
node --test --test-isolation=none services/orion-fx/tests/orion-fx.test.js
```

## Segurança e comportamento de falhas

Host único: `https://demo-api-capital.backend-capital.com`, prefixo `/api/v1`.
Não existe fallback. `TRADING_ENABLED` aceita somente `false`; flags herdadas
`LIVE_TRADING_ENABLED` e `ORDER_EXECUTION_ENABLED` também não podem habilitar
execução. Não há endpoints de criação, alteração ou cancelamento de ordens.
As únicas requisições que alteram estado são POST/DELETE da sessão.

Timeout aborta a requisição, inclusive leitura JSON. HTTP 401 no login inicial
retorna `AUTHENTICATION_FAILED`; em uma requisição com tokens, descarta os tokens
e retorna `SESSION_EXPIRED` (sessão expirada ou recusada pelo servidor).
O 401 inicial indica autenticação recusada: pode envolver login, senha personalizada
incorretos ou chave desabilitada; o status isolado não comprova qual causa ocorreu.
A validade da chave API é independente dos 10 minutos de inatividade da sessão.
`CAPITAL_API_PASSWORD` fornece exclusivamente a senha personalizada definida ao
criar a chave API; não há fallback para senha da conta. Corpos de erro externos
não são propagados, mesmo quando contêm um código de erro.
HTTP 429 informa `RATE_LIMITED`; 5xx informa `BROKER_UNAVAILABLE`. Não há repetição
automática: corrija autenticação para 401, aguarde antes de uma nova consulta em
429/5xx. Isso evita tempestades de requisições e repetições de autenticação.
Logout é tentado em conclusão normal e erros capturados; tokens locais são
descartados mesmo se o logout remoto falhar. Encerramento forçado do processo
pode deixar a sessão remota até sua expiração. Não há persistência de tokens,
logs em arquivo, renovação automática, streaming ou acompanhamento contínuo.

`.env`, variantes, diretórios de tokens e logs são ignorados pelo Git. Apenas
`.env.example` contém placeholders. Nunca force a inclusão de arquivos privados.

## Contrato e limites da API

Fonte oficial consultada: https://open-api.capital.com/

- POST `/session`: chave no `X-CAP-API-KEY`, login e **senha personalizada da
  chave API** no corpo; `encryptedPassword=false`, transportado por HTTPS.
  Tokens `CST` e `X-SECURITY-TOKEN` autorizam as consultas seguintes.
- Sessão REST expira após 10 minutos de inatividade; limite geral de 10
  requisições/s por usuário e autenticação limitada a 1/s por chave.
- GET `/prices/{epic}` aceita resolução `HOUR` e no máximo 1000 candles por
  consulta. Esta versão não implementa paginação nem intervalos from/to.
- A API não oferece chaves somente leitura. A restrição é imposta pelo serviço.
- Mercado fechado, disponibilidade regional e permissões da conta podem afetar
  dados. Zero ou múltiplas correspondências exatas de EUR/USD abortam a consulta.
- Snapshot exibe horário bruto do broker e horário local de recebimento; não
  pressupõe que `updateTime` seja UTC ou que a cotação esteja atualizada.
  Candles usam `snapshotTimeUTC`; a última vela pode ainda estar em formação.
  Spreads são métricas de observação em ponto flutuante, sem uso financeiro executável.

## Próxima conexão Demo

Autenticação atualmente indisponível com HTTP 401 / error.invalid.api.key;
suporte já acionado. Aguardar resposta sem gerar chaves, alterar `.env` ou enviar
credenciais. Esta implementação não tentou autenticar. Depois da resolução pelo
suporte, a validação de leitura Demo deve ser uma tarefa separada e autorizada.

## Continuidade Orion Quant Engine

A [auditoria dos checkpoints](docs/quant-checkpoints-audit.md) registra a base
reutilizada, os reforços de histórico/indicadores/backtesting/risco, a validação
atual (43 casos FX aprovados) e as pendências. Resultados permanecem offline.

Checkpoint incremental V3: [auditoria, alterações, limites e continuidade](docs/quant-v3-checkpoint.md).
[Triagem pública das fontes](docs/quant-v3-sources.md). Manifesto offline:

```sh
npm --prefix services/orion-fx start -- data:manifest --count 24 --acquired-at 2026-11-05T00:00:00Z
```

O comando usa dados sintéticos por padrão; não coleta históricos nem autentica.
