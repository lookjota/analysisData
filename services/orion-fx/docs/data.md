# Importação de dados

Contrato `orion.candles.v1`: EUR/USD H1 neste release. Campos CSV, nesta ordem:

```csv
instrument,timeframe,timestamp,open,high,low,close,volume,source,synthetic
EUR/USD,H1,2024-01-08T00:00:00Z,1.1,1.101,1.099,1.1005,,manual-synthetic,true
```

Timestamp é a **abertura** do candle; fechamento uma hora depois. ISO 8601 com
segundos e timezone explícito; offsets são normalizados para UTC. Datas inválidas,
preços não finitos/positivos, OHLC inconsistente, volume negativo, fonte ausente,
flag sintética ausente, alinhamento diferente de H1 e outros mercados são rejeitados.
Volume ausente é permitido. Um snapshot bid/ask não permite reconstruir OHLC
executável: `bid`/`ask` são rejeitados; suporte bid/ask completo está pendente.
Preços atuais representam mid-price, sem pressupor que CSV de terceiros seja mid.

`validateDataset(rows,{sort:false,asOf,maxRows:100000})` rejeita desordem e
duplicatas. Ordenação precisa ser explícita; não deduplica. `asOf` rejeita candles
que ainda não fecharam naquele instante; sem `asOf` não usa o relógio do sistema.
`exportCsv` e JSON.stringify preservam os campos normalizados; importação JSON
externa ainda não é oferecida pelo CLI.

`importCsv` é incremental na leitura, com limite de 32 MiB, 100 mil linhas e
4096 caracteres por linha; dataset validado permanece em memória. Aceita campos
com vírgulas/aspas escapadas e CRLF, rejeita campos multilinha, schema diferente,
linhas vazias e arquivos especiais/links simbólicos. Arquivos inválidos não geram
um dataset parcial. CSV de relatórios neutraliza fórmulas de planilha.

Gaps nunca são preenchidos. Fechamento aproximado: sexta 22h UTC até domingo
22h UTC. Não há calendário de feriados nem DST. `WEEKEND_CLOSURE` é informativo;
`SESSION_GAP` bloqueia backtest por padrão. `--allow-gaps true` registra uma
aceitação explícita da ausência. Gaps acima de 366 dias são rejeitados.

Fixtures: `mixed`, `up`, `down`, `flat`, `volatile`, `quiet`, `gap`, `invalid`.
Todas têm `synthetic:true`, fonte `orion-synthetic-v1` e nenhuma cotação real.
Spread ampliado é cenário de execução via `--spread 5`, não OHLC fictício bid/ask.
O cenário invalid existe para testar rejeição. Arquivos reais devem ser mantidos
em `data/samples/` (ignorado), com licença e metodologia documentadas à parte.

Identidade canônica: `validateDataset` também retorna `contentHash` SHA-256,
`hashAlgorithm` e `hashVersion`. O backtest inclui esses campos em `dataset`.
Detalhes e limites: [auditoria de continuidade](quant-checkpoints-audit.md).
