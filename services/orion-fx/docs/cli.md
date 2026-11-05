# CLI offline reproduzível

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
