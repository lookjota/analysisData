# Continuidade Orion Quant Engine — 2026-11-05

Branch confirmada: `feat/orion-fx-v1`. Auditoria sem leitura de credenciais,
sem conexões com corretoras e sem edição de Freqtrade. Não há AGENTS.md na
árvore pesquisada. Estado inicial: `.gitignore` modificado, `services/orion-fx/`
e `services/freqtrade/scripts/` não rastreados. Essas alterações foram preservadas.
Não houve commit, push nem staging.

## Base encontrada

O roadmap local já define A–F. A–D têm componentes implementados; E e F são
parciais. A suíte inicial tinha 39 casos FX aprovados. Foram reutilizados os
contratos, importador CSV, indicadores, estratégias, simulador, ledger, métricas,
relatórios, replay e ferramentas temporais. Nenhum desses módulos foi reescrito.

## Incremento implementado

- A / histórico: validação estrita das opções `maxRows` (1–100000) e `sort`
  (booleano). SHA-256 das linhas normalizadas na ordem temporal, com valores na
  ordem `FIELDS` e ausentes como null. Metadados `contentHash`, `hashAlgorithm`
  e `hashVersion=orion.candles.canonical.v1` acompanham dataset e backtest.
  Identifica conteúdo canônico; não é hash dos bytes originais nem prova de
  autoria, licença ou autenticidade da fonte. Gaps continuam sem preenchimento.
- B / indicadores: ATR, ADX, estocástico e amplitude rejeitam arrays/candles
  inválidos, preços não finitos/não positivos e high/low incompatíveis com close.
  São funções de HLC, sem exigência de metadados do contrato histórico.
  Fórmulas e convenções de warm-up existentes foram mantidas.
- C / backtesting: sinais pendentes passam por cópia restrita dos campos do
  contrato. Campos extras não podem sobrescrever timestamps de ordens virtuais
  nem transportar referências de metadados mutáveis para a execução.
- C / risco: a API pública `assessIntent` valida também configurações fornecidas
  diretamente. Configuração inválida resulta em `INVALID_RISK_CONFIG`; posições
  negativas/fracionárias/não finitas e flags não booleanas são rejeitadas.
  Chaves herdadas de Object.prototype não são opções válidas.

## Validação desta continuidade

Node v26.13.0, sem dependências adicionais. `npm test` passou (7 arquivos);
`npm --prefix services/orion-fx test` passou (6 arquivos);
`npm --prefix services/orion-fx run test:cases` passou (43 casos, zero falhas);
`npm run check` passou, execução de ordens desativada.
Quatro novos casos cobrem identidade canônica/CSV/revisão de preços, configuração
pública de risco, rejeição HLC/warm-up e integridade dos timestamps das ordens.
Os testes do adaptador existente utilizam transporte simulado.

## Pendências

A: histórico real licenciado, manifesto de licença/origem, bid/ask OHLC completo,
calendário Forex com DST/feriados. O hash implementado cobre apenas conteúdo.
B: comparação das convenções numéricas com referência independente.
C: precisão monetária decimal, múltiplos ativos, latência/parciais e swaps
contratuais. Limites observados não garantem perdas máximas em gaps/intrabar.
E: OOS contínuo com warm-up separado, inferência estatística, controle de múltiplas
comparações e bootstrap temporal. F: API local/dashboard e retomada incremental.
Node 22 e escala massiva não foram validados nesta execução.
Integrações com corretoras continuam fora do escopo autorizado.
