# V3.2 — auditoria e plano

Baseline confirmada: feat/orion-quant-v3, a391199767a16e1c52670547870091ea10c23ebd.
Node v26.13.0. npm test: 11 arquivos; FX: 10 arquivos; check: orders disabled.
Única entrada preexistente: services/freqtrade/scripts/ não rastreada, intocada.
Relatórios V3 e V3.1 e APIs públicas inspecionados antes de alterações.

## Dependências e contratos

CLI → importCsv/validateDataset → backtest → estratégia(prefixo fechado) →
assessIntent/executionPrice → VirtualPortfolio(USD8) → analytics/reporting.
manifest → validateDataset + marketSession; ainda calculava qualidade separadamente.
research → temporal windows → backtest; replay → recomputação de prefixos.
Risco de transporte bloqueia ordens; risco simulado não possui estado durável.

| Requirement | Existing implementation | Missing integration | Risk | Test strategy | Status |
|---|---|---|---|---|---|
| A calendário | IANA NY/London/Tokyo; feriados declarados | validador usa UTC22 fixo; manifesto isolado | HIGH comprovado | DST, CSV→report, adulteração | PARTIAL |
| B preços | mid H1, spread hipotético, bid/ask rejeitado | cotação observada/stale/schema | HIGH limitação | contratos e custos | PENDING |
| C temporal | prefixo fechado; splits cronológicos | warm-up OOS, seleção validation, guard holdout | HIGH limitação | perturbação/fronteiras | PENDING |
| D risco | drawdown/daily flags por execução | estados e recuperação administrativa persistente | HIGH inexistente | reinício HALTED | PENDING |
| E journal | replay recomputa prefixos | armazenamento, atomicidade, idempotência | HIGH inexistente | falhas de append/checksum | PENDING |
| F integração | ledger privado reconciliado | commit durável + risco e recuperação | HIGH inexistente | execução contínua vs restart | PENDING |
| G CI | Node22 raiz/check | matriz, gates offline, lockfile, cobertura | MEDIUM parcial | workflows/checks | PENDING |
| registry | hashes dataset, relatórios existentes | identidade científica integrada | MEDIUM parcial | reprodução/hash | PENDING |
| USD8 | ledger privado; booking preparado; oráculos | preços/sizing Number assumidos | MEDIUM limitação | regressão V3.1 | TESTED baseline |
| segurança | ordens bloqueadas, offline CLI | auditoria integral ainda não feita | HIGH limitação | fetch proibido/check/diff | PARTIAL |

Plano: fechar A com opções explícitas de calendário e política, sem alterar hash
canônico v1; depois B, C, D, E, F, G em ordem. Compatibilidade: padrão legado
explicitamente identificado; modo calendar-v1 opt-in. Não reescrever ledger.
Riscos de regressão: hashes/manifests v1, contagem de gaps, mensagens antigas,
CLI, replay, benchmarks e relatórios. Preservar os contratos antigos por default.
Ausência de um calendário autorizado não pode ser convertida em calendário
universal. Dados são declarações; hash não prova aquisição, licença ou autenticidade.
