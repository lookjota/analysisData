# Paper trading por replay

`replay(rows,options,{clock,onState})` aceita relógio com `advanceTo(isoClose)`
e callback assíncrono de estados virtuais. Sem Date.now, timer, HTTP ou credenciais.
Ordens, fills, posições e saldos são exclusivamente objetos/arquivos locais.
Formato final igual ao backtest com `mode:paper-replay`. A opção de fechamento
final é aplicada apenas no resultado final; callbacks mantêm posições abertas.

Implementação de referência recalcula cada prefixo com fechamento final desligado,
para permitir paridade com backtest. Limite explícito de 1000 candles; é custosa
(O(n²) chamadas acumuladas, além do custo dos indicadores) e não serve a streaming
prolongado. Estratégias customizadas devem ser puras para reprodução. Testes
verificam relógio, snapshots e ledger iguais ao batch. Ainda falta executor
incremental persistente, recuperação de processo, checkpoint de estado e
observabilidade. Integração de leitura Demo é outro fluxo e não alimenta este
replay automaticamente.
