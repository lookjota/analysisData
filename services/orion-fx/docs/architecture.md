# Arquitetura e auditoria — 2026-11-05

Estado inicial: `.gitignore` modificado; `services/freqtrade/scripts/` e
`services/orion-fx/` não rastreados. Nenhum AGENTS.md encontrado. Node v26.13.0,
ESM, sem dependências. `npm test` da raiz e `npm test --prefix services/orion-fx`
passaram antes de editar. No Node 26, o modo padrão resume arquivos como testes;
a contagem de casos individuais exige `--test-isolation=none`.

O adaptador Demo, configuração, bloqueio HTTP, normalização de consultas e testes
existiam e foram preservados. Somente o roteamento CLI existente foi ampliado.
Nenhum arquivo `.env` foi aberto, nenhum comando da API foi executado.

Ordem aplicada: A dados/contratos → B indicadores/estratégias → C execução,
portfólio e risco → D avaliação/relatórios → E ferramentas temporais → F contratos.

```text
orion-fx/
├── brokers/             # adaptador Demo de leitura existente
├── config/              # bloqueios Demo/execução existentes
├── cli/                 # comandos de consulta + dispatcher offline
├── market-data/         # consultas existentes + contrato e CSV históricos
├── data/fixtures/       # gerador sintético determinístico
├── indicators/          # cálculos puros, null no warm-up
├── strategies/          # observações existentes + hipóteses de pesquisa
├── execution/           # preços executáveis, spread, slippage, stops
├── portfolio/           # saldo, margem, posição, ledger e trades virtuais
├── risk/                # transporte existente + avaliação de intenções virtuais
├── backtesting/         # orquestração determinística
├── paper/               # replay limitado e relógio injetável
├── analytics/           # métricas e alertas
├── optimization/        # splits, janelas e sensibilidade
├── reporting/           # JSON, CSV e HTML offline
├── docs/                # guias e contratos
├── tests/               # node:test sem rede
└── reports/             # resultados locais ignorados pelo Git
```

Fluxo offline: candles validados → estratégia com prefixo fechado → intenção
pendente → risco → preços simulados → ledger → métricas → relatórios. Módulos
offline não importam corretora/configuração e não recebem credenciais. O bloqueio
`evaluateOrder` existente continua negando ordens externas; o avaliador de risco
simulado possui nome e módulo distintos.

Persistência: arquivos exclusivos, permissões 0600, diretórios 0700; sem SQLite,
sem migrações ou banco compartilhado. Criação exclusiva impede sobrescrita.
Relatórios são coleções locais, não transações: interrupção pode deixar um
conjunto parcial. Importadores nunca leem relatórios incompletos como estado.
Dados de entrada e saída são limitados; cálculos e backtests mantêm arrays em
memória. Rolling windows e sinais por prefixo priorizam clareza sobre velocidade;
não são adequados a históricos de milhões de candles.

Limites de autorização permanecem: nenhuma alteração na raiz ou no Freqtrade,
nenhum commit, push, merge, operação de contêiner ou alteração de credenciais.

## Incremento Quant V2

O estado acima descreve a fundação anterior, não aceitação integral V2. A nova
fronteira `financial/decimal.js` faz PnL decimal e booking USD8; portfolio verifica
invariantes e emite strings contábeis exatas. `backtesting/passive.js` é benchmark
separado sem breakers da estratégia. `experiments/quant-v2.js` registra código e
resultados em arquivos exclusivos. Novos modelos e limitações estão em
[quant-v2-audit.md](quant-v2-audit.md), [financial-model.md](financial-model.md),
[execution-model.md](execution-model.md) e [statistical-validation.md](statistical-validation.md).
Nenhuma alteração de integração, serviço ou dashboard foi introduzida.
