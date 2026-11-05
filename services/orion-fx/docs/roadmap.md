# Roadmap e escopo entregue

| Checkpoint | Situação | Evidência / limite |
|---|---|---|
| A fundação | Implementado no escopo EUR/USD H1 | Contrato, CSV, fixtures, diagnósticos e testes; sem bid/ask OHLC nem calendário Forex completo |
| B pesquisa | Implementado | Indicadores e seis hipóteses; sem comparação externa de indicadores |
| C simulação | Implementado com limites | Uma posição, USD, custos configuráveis, risco, stops/alvos/trailing, ledger; sem microestrutura ou múltiplos ativos |
| D avaliação | Implementado | Métricas, comparação e JSON/CSV/HTML; charts sem dependências |
| E robustez | Parcial | Janelas, seleção somente treino, OOS independente e sensibilidade via API JS; sem curva OOS contínua ou inferência estatística |
| F integração futura | Parcial | Contratos documentados; sem servidor, React, streaming ou novo adaptador |

Prioridades seguintes:

1. Importar histórico EUR/USD licenciado e verificável, identificar mid/bid/ask,
   abertura/fechamento e timezone; incluir calendário de sessão com DST/feriados,
   hash/licença do dataset e bid/ask OHLC completo. Validar sem preencher gaps.
2. Congelar hipóteses, reservar período OOS intocado, usar warm-up anterior sem
   negociar no treino, construir walk-forward contínuo; registrar todas as
   tentativas e ajustar múltiplas comparações. Testar parâmetros próximos,
   regimes e custos maiores. Implementar bootstrap temporal e métricas de
   incerteza somente depois de verificar dados e contabilidade.
3. Aguardar resposta do suporte sobre HTTP401/error.invalid.api.key. Nenhuma
   alteração automática de chave ou .env. Após resolução externa, validar
   explicitamente leituras Demo existentes; continuar sem endpoints de ordens.
4. Separar feed Demo de executor incremental virtual, adicionar deduplicação,
   candles fechados, reconexão e relógio de eventos. Streaming não habilita ordens.
5. Dashboard React sobre contratos versionados, API local read-only em 127.0.0.1,
   fixtures para UI, sem acesso a credenciais pelo frontend.
6. Replay incremental, checkpoints recuperáveis, integridade transacional,
   observabilidade sem segredos e simulação prolongada. Avaliar SQLite exclusivo
   do FX somente quando retomada/volume justificarem migrações e índices.

Pendências adicionais: fixtures bid/ask, latência/parciais, swaps contratuais
verificados, precisão decimal monetária, testes de todos os caminhos raros de
falha em filesystem e benchmark de desempenho. Nada disso foi declarado validado.

## Reavaliação V2 — prevalece sobre rótulos de conclusão anteriores

A auditoria V2 encontrou lacunas incompatíveis com declarar a plataforma pronta.
Checkpoint A entregue no escopo auditado; B parcial após USD8, invariantes e
benchmark passivo. C–G continuam parciais/pendentes. Ordem: concluir fronteiras
numéricas/margem e execução → proveniência/calendário/bid-ask → warm-up/OOS e
inferência temporal → breakers adicionais/stress → observabilidade geral/CI.
Dashboard adiado enquanto os itens HIGH de realismo e contabilidade sistêmica
permanecerem abertos. Ver [auditoria V2](quant-v2-audit.md) para aceitação por item.
CI proposta: jobs Node22/26 sem segredos/rede de corretoras, testes e syntax-check;
sem dependências de runtime, não usar npm ci até existir lockfile. Scanner de
segredos deve operar no diff autorizado sem ler .env. Auditoria npm não agrega
cobertura enquanto não houver dependências; lint configurado e CI não entregues.
