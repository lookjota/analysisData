# Validação executada — 2026-11-05

Node v26.13.0. Sem instalação de dependências ou conexões autenticadas.

- `npm test --prefix services/orion-fx`: cinco arquivos aprovados.
- `npm test`: seis arquivos aprovados, incluindo a fundação da raiz.
- `node --test --test-isolation=none services/orion-fx/tests/*.test.js tests/*.test.js`:
  **48 casos aprovados, 0 falhas** (39 FX e 9 fundação).
- `git diff --check`: sem erro; FX já era não rastreado na auditoria inicial.
- CLI real: geração/reimportação CSV, trend e mean-reversion com relatórios,
  compare e replay de 250 candles; sucesso com env vazio e fetch injetado proibido.

Cobertura de comportamento: UTC/OHLC/schema, dados inválidos, duplicatas,
ordenação, gaps, CSV, sobrescrita/symlinks; indicadores numéricos e prefixos;
entradas/saídas estratégicas; execução N+1; long/short, preços e contabilidade;
stop/alvo simultâneo, gap, trailing, swap; risco, margem, perda diária e drawdown;
HTML/CSV seguros; métricas definidas/indefinidas; replay/relógio; splits e seleção
pelo treino; regressão da CLI e bloqueios HTTP existentes.

Sem relatório percentual de cobertura, comparação contra biblioteca externa,
validação em Node22, dados históricos reais, sessão Capital.com real, escala
massiva, testes de todo erro de filesystem ou comprovação estatística de estratégias.

## Execução reproduzível sintética

```bash
npm --prefix services/orion-fx start -- data:generate --out validation-synthetic-v1
npm --prefix services/orion-fx start -- data:validate --input services/orion-fx/data/samples/validation-synthetic-v1.csv
npm --prefix services/orion-fx start -- backtest --input services/orion-fx/data/samples/validation-synthetic-v1.csv --strategy trend --out validation-trend-v1
npm --prefix services/orion-fx start -- backtest --strategy mean-reversion --out validation-mean-v1
npm --prefix services/orion-fx start -- paper:replay --count 250 --out validation-replay-v1
```

Esses nomes já existem nesta workspace. Para repetir, escolha nomes novos; não
apague nem sobrescreva artefatos existentes. Sem --out pode repetir no terminal.

720 candles EUR/USD H1 inventados, de 2024-01-08 00:00 UTC até abertura de
2024-02-18 23:00 UTC (último fechamento em 2024-02-19 00:00 UTC). Capital USD1000,
leverage1, spread1 pip, slippage0.1 pip/lado, comissão0, swap0, exposição USD1000.

| Estratégia | Trades | Net USD | Max DD USD | Max DD % |
|---|---:|---:|---:|---:|
| trend EMA50/200 + ATR | 13 | 3.5173377770 | 5.6705248549 | 0.5634332985 |
| mean-reversion BB/RSI | 30 | -15.2954497425 | 15.2954497425 | 1.5295449743 |

Relatórios ignorados pelo Git: `reports/validation-trend-v1/`,
`reports/validation-mean-v1/`, `reports/validation-replay-v1/`.
Cada diretório contém report.json, report.html, trades.csv, equity.csv, metrics.csv.
Dados sintéticos não são evidência de desempenho no mercado real.

Segurança: configuração de execução continua exigindo TRADING_ENABLED=false;
nenhum .env foi aberto ou alterado, portanto seu valor local não foi inspecionado.
Nenhum endpoint de ordens foi introduzido. Nenhum arquivo Freqtrade, Compose ou
SQLite foi editado, nenhum contêiner manipulado, nenhuma chave gerada e nenhuma
conexão Live ou Demo real realizada. Nenhum arquivo foi adicionado ao index,
commitado, enviado por push ou publicado.
