# Auditoria independente Quant V2 — 2026-11-05

## Escopo e evidência inicial

Branch `feat/orion-fx-v1`, Node 26.13.0, ESM sem dependências externas.
Estado encontrado: `.gitignore` modificado; todo `services/orion-fx/` e
`services/freqtrade/scripts/` não rastreados. Não houve staging, commit ou push.
Nenhum AGENTS.md encontrado. Credenciais, .env, Freqtrade, Docker e SQLite
permaneceram fora das operações. Testes de corretora usam transporte simulado.

Inspecionados: contratos da raiz e FX, importador CSV, normalização temporal,
indicadores, estratégias, execução, portfolio/ledger, risco, analytics,
walk-forward, replay, reporting, CLI e testes. Regressão antes das alterações:
7 arquivos aprovados na raiz; 43 casos FX existentes. Os relatórios antigos
mencionados na documentação não estavam presentes na árvore pesquisada; a
comparação usa as fórmulas e referências documentadas, sem inventar artefatos.

## Arquitetura realmente encontrada

Fluxo: CSV/fixture → validação/hash → prefixo fechado → sinal → próxima abertura
→ avaliação de risco → preenchimento → ledger → equity → analytics → JSON/CSV/HTML.
Uma posição EUR/USD, conta USD, unidades inteiras, preço OHLC mid assumido,
spread/slippage constantes na base, agora com agenda explícita opcional por candle, liquidez ilimitada. Contratos de ordem externos na
raiz usam strings decimais; a simulação originalmente usava Number em tudo.
Há janelas rolling/expanding e seleção pelo treino, mas contas OOS independentes
com warm-up frio. Isso não equivale a um portfolio walk-forward contínuo.
Não existem ML, execução real, limites de liquidez, inferência estatística,
calendário completo nem dashboard. Ver [arquitetura](architecture.md).

## Achados classificados

| ID | Severidade | Evidência / classificação | Tratamento |
|---|---|---|---|
| F01 | HIGH | Confirmado: ledger público aceitava NaN, unidades inválidas, taxas negativas e mutação de registros | Validação antes de booking, registros congelados, reconciliação exata, teste de corrupção |
| F02 | HIGH | Confirmado: PnL `1000*(.3-.1)` difere de USD200; caixa acumulado em IEEE-754 | Caixa USD8 com BigInt, PnL decimal antes de subtração, strings exatas no ledger; migração parcial |
| F03 | HIGH | Confirmado: buy-hold usa ATR, stops, targets e reentradas (17 trades) | Alias explícito risk-managed-hold; legado com alerta; benchmark passivo separado, um trade |
| F04 | MEDIUM | Confirmado: anualização em histórico curto sintético com calendário irregular | Alertas explícitos; convenções preservadas; não há intervalo de confiança |
| F05 | MEDIUM | Hipótese de defeito Breakout descartada para fixture auditada: preço não rompe; fixture com ruptura executa N+1 | Experimento/teste E2E; zero trades não prova falha |
| F06 | HIGH | Limitação confirmada: bid/ask OHLC, spread variável intrabar, latência, liquidez/parciais ausentes; agenda por candle implementada | Declarados sem suporte; bloqueiam conclusão de realismo operacional |
| F07 | HIGH | Limitação confirmada: calendário sexta/domingo UTC fixo, sem DST/feriados | Não usar classificação de gaps como calendário Forex validado |
| F08 | HIGH | Limitação confirmada: OOS sem warm-up separado, bootstrap temporal e múltiplas comparações ausentes | Split triplo e demonstração; seleção não usa final; validação estatística completa pendente |
| F09 | MEDIUM | Confirmado: saída intrabar registrada no timestamp de abertura, duração/exposição subestimáveis | Documentado; OHLC não identifica instante real; métricas de duração são aproximação |
| F10 | MEDIUM | Confirmado: riscos avaliados na abertura/close; drawdown intrabar e perdas de gap podem superar orçamento | Testes e experimento de gap; sem garantia de perda máxima |
| F11 | MEDIUM | Confirmado: não havia manifesto por experimento nem hash do código não commitado | Runner gera manifesto com hash de código, dados, configuração e artefatos exclusivos |
| F12 | MEDIUM | Risco potencial: persistência de conjunto parcial em falha de relatório | Arquivos exclusivos existentes; testes adicionais de falha/recuperação pendentes |
| F13 | LOW | Confirmado: contagem padrão Node26 reporta arquivos, não casos | Executar também `--test-isolation=none` |

Nenhum CRITICAL confirmado nesta auditoria offline limitada. Isso não é certificação
financeira ou de segurança. MA Cross PF8.73/3 trades reproduzido: insuficiência de
amostra confirmada, nenhuma vantagem estatística demonstrada. Não foi encontrado
look-ahead no fluxo auditado; testes por prefixo e perturbação futura reforçam essa
conclusão limitada às interfaces inspecionadas.

## Plano incremental e aceitação

A concluído para esta inspeção: inventário, regressão, achados, referências e
experimentos sintéticos. B parcial: exigir reconciliação exata em USD8, custos
uma vez, long/short independentes, gaps stop-first, dados futuros isolados e
benchmark com um trade. Testes implementados cobrem esse subconjunto.

Antes de considerar B completo: auditar limites numéricos de todos os preços,
exposição e margem, validar modelo de liquidez e bid/ask. Política intrabar parametrizável,
decomposição de custos por fill e agenda de spread por candle foram acrescentadas;
spread variável dentro do candle segue sem suporte. Não avançar dashboard enquanto isso estiver aberto.
C depende de contrato de preços e licença: preservar bruto, manifesto, calendário
DST e bid/ask completo. D depende de B/C: warm-up anterior separado, holdout real
intocado, inferência temporal e registro de tentativas. E depende de B: breakers
de stale/volatilidade/persistência e cenários de ruína com pressupostos. F/G:
observabilidade geral, CI offline, segurança de persistência e Node22.

Critério de fechamento de cada item: teste independente adversarial, regressão
raiz/FX aprovada, documentação atualizada, artefatos reproduzíveis, nenhum acesso
externo de execução. Não declarar checkpoints C–G concluídos neste incremento.

Resultados detalhados, comandos e árvore: [entrega desta execução](quant-v2-delivery.md).
