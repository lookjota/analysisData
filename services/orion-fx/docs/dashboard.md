# Contratos v1 para dashboard futuro

Frontend consome arquivos JSON; não importa estratégias, portfólio ou adaptadores.
`orion.simulation.v1` é a representação completa, em backtest e paper-replay:

- simulatorVersion: versão do comportamento de execução;
- mode, tradingEnabled:false;
- strategy: id, version, parameters;
- config: initialCapital, accountCurrency, costs, risk e hipóteses;
- dataset: instrument, timeframe, synthetic, sources, count, start, end, warnings;
- orders: intenções virtuais, signalTimestamp, timestamp e decisão de risco;
- fills: execuções virtuais com direção, preço e unidades;
- trades: entradas/saídas fechadas, custos e PnL;
- ledger: débitos/créditos locais e cash após evento;
- equityCurve: estados incluindo posição virtual e margem;
- riskEvents: códigos e timestamps;
- metrics, warnings: adicionados por enrich/writeReports.

Exemplo resumido de estado para consumo (valores inventados):

```json
{
  "schemaVersion": "orion.simulation.v1",
  "mode": "paper-replay",
  "tradingEnabled": false,
  "equityCurve": [{
    "timestamp": "2024-01-08T01:00:00.000Z",
    "cash": 1000,
    "equity": 1000,
    "unrealizedPnl": 0,
    "realizedPnl": 0,
    "marginUsed": 0,
    "freeMargin": 1000,
    "exposure": 0,
    "position": null
  }],
  "riskEvents": [],
  "trades": []
}
```

`orion.indicators.v1` contém timestamps e arrays alinhados dos indicadores;
null significa indisponível, não zero. Estratégias são listadas por `strategyIds`
e descritas por createStrategy; não há endpoint de execução. Para alterações
incompatíveis criar v2; consumidores devem rejeitar schemaVersion desconhecida.
JSON com metrics undefined não é permitido; métricas indefinidas são null.
Relatório completo gerado é exemplo executável do contrato, não só este fragmento.
Ainda faltam schema JSON formal, tipos TS de todas as variantes e testes de
compatibilidade entre versões.

Nenhum servidor novo é criado. Futura API deverá ser somente leitura por padrão,
ligada a 127.0.0.1, com limites de tamanho, política de acesso e sem credenciais
no payload. Não criar proxy de ordens nem habilitar conexão Live.
