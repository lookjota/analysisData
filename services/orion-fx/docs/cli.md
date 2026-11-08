# CLI offline reproduzível

Para consultar contas Demo com as credenciais do `.env` local do serviço, na raiz:

```bash
npm --prefix services/orion-fx run demo -- accounts:list
```

Exige `CAPITAL_ENV=demo` e `TRADING_ENABLED=false` (valores padrão).
Reutiliza a sessão existente para `GET /api/v1/accounts` e encerra a sessão ao
final. Exibe somente `accountId`, `accountName`, `accountType`, `currency` e
`preferred`, sem credenciais ou tokens. Não envia ordens.

Na raiz, Node >=22 e npm, sem instalar dependências:

```bash
npm --prefix services/orion-fx start -- data:validate --help
npm --prefix services/orion-fx start -- data:generate --out eurusd-synthetic-v1
npm --prefix services/orion-fx start -- data:validate --input services/orion-fx/data/samples/eurusd-synthetic-v1.csv
npm --prefix services/orion-fx start -- indicators --count 250
npm --prefix services/orion-fx start -- backtest --strategy trend --out synthetic-trend-v2
npm --prefix services/orion-fx start -- backtest --strategy mean-reversion --out synthetic-mean-v1
npm --prefix services/orion-fx start -- compare
npm --prefix services/orion-fx start -- risk:check
npm --prefix services/orion-fx start -- paper:replay --count 250 --out replay-v1
npm --prefix services/orion-fx start -- report --strategy breakout --out breakout-v1
npm test --prefix services/orion-fx
npm test
node --test --test-isolation=none services/orion-fx/tests/*.test.js
```

Todos os comandos aceitam `--help`. Saída 0=sucesso, 1=erro. Repetir `--out` falha
por segurança; use outro nome. Sem --input, candles são sempre sintéticos. --input
é CSV com contrato estrito. Sem --out, backtest/report imprimem resumo JSON e
não persistem; report reconstrói a simulação, não importa JSON arbitrário.

Opções comuns: --strategy, --capital 1000, --spread 1, --slippage .1,
--commission 0, --swap 0, --count 720, --regime mixed, --allow-gaps true.
--out aceita só nome simples e fica sob reports/ do serviço; data:generate grava
em data/samples/. Algumas opções são específicas: indicadores usam períodos
fixos do CLI (API JS permite configuração); risk:check mostra uma intenção
exemplo USD1000, não executa estratégia nem modifica conta. Parâmetros de risco
avançados são configuráveis pela API JS. Flags repetidas/desconhecidas falham.

Comandos existentes status/auth/accounts/discover/quote/candles são preservados;
comandos offline não chamam loadConfig nem leem .env. Não use `npm run demo` para
pesquisa: `start` não carrega credenciais.

Offline registry consolidation (run from `services/orion-fx`, without `--env-file`):

```sh
node cli/index.js history:merge --registry data/capital-demo/v33b-registry --left sha256-81b64f4d2eee80a86545e2afb86372935d5b73f6f8516b3354b8cacc51b160ac --right sha256-141ce43fb0f3a7d6820257ea7638314854e1e0814fc4c98bfcc08e676b693b7f
node cli/index.js research:evaluate --input data/capital-demo/v33b-registry/sha256-7d270873ef59f50a8f3a05c6f3bfc6b644503309cfb9c4599b1f850a0de83f17.json --strategy trend
```

The registry mode reads only the two selected parents and calls the existing deterministic
merge. It verifies artifacts and manifests, matching instrument/timeframe/price and calendar
contracts, exact overlap deduplication, conflicting overlap rejection, and calendar continuity
through the full requested period, including the month boundary. Publication uses the registry
lock and exclusive content-addressed creation; reruns verify the existing immutable envelope.
Both parent IDs are retained. Output includes candle count, coverage, requested period,
canonical content SHA-256, artifact hash and publication path. Existing incompatible provenance
at the target identity fails closed. The file-output merge mode remains available with `--out`.
Research evaluates TRAIN and VALIDATION only; the protected final holdout remains unconsumed.
