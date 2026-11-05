# Pesquisa pública de fontes — 2026-11-05

Nenhum dado histórico foi adquirido. Nenhuma licença foi presumida. Esta pesquisa
é uma triagem técnica, não aprovação jurídica nem autorização para coleta.

| Campo | HistData | Dukascopy | Capital.com Demo |
|---|---|---|---|
| Oficial | https://www.histdata.com/f-a-q/ | https://www.dukascopy.com/wiki/en/development/strategy-api/historical-data/ | https://open-api.capital.com/ |
| Exportação/acesso | CSV em ZIP, formatos por aplicação | JForex History API: barras e ticks; exportação exata a verificar | REST JSON, sessão privada exigida |
| EUR/USD | listado na FAQ | verificar disponibilidade no serviço escolhido | descoberta existente, não consultada |
| Frequência | tick e M1 | barras e ticks via API documentada | resoluções no contrato REST |
| Timezone | EST fixo sem DST, segundo FAQ | verificar convenção do exportador escolhido | snapshotTimeUTC no contrato do adaptador existente |
| Bid/ask/mid | confirmar colunas por variante antes de converter | OfferSide no contrato de barras; validar exportação | OHLC bid/ask na API; não disponível offline nesta entrega |
| Volume | FAQ informa ausência de volume | sem atribuir volume financeiro consolidado | não assumir volume financeiro real |
| Precisão temporal | depende da variante; verificar arquivo antes de normalizar | verificar ticks/barras exportados | confirmar granularidade do payload efetivamente exportado |
| Cobertura histórica | organizada por par/ano/mês; início e fim não verificados | início e fim não verificados | profundidade não verificada |
| Automação e limites | FAQ descreve FTP/SFTP; termos, elegibilidade e limites precisam ser confirmados | contrato de acesso/exportação específico pendente; nenhum scraping implementado | autenticação proibida nesta entrega |
| Licença/redistribuição | não estabelecida nesta pesquisa | não estabelecida para dataset histórico; licença XML não deve ser aplicada a outro produto | direitos de exportação/redistribuição não estabelecidos |
| Custo | FAQ descreve dados gratuitos; condições adicionais não verificadas | custo/condições do produto escolhido pendentes | custo/condições de exportação pendentes |
| Ajustes/limitações | conversão EST fixo → UTC deve ser explícita; sem garantia de qualidade na FAQ | não confundir feed de varejo com mercado Forex consolidado | preços específicos da plataforma; integração bloqueada por autorização |

A URL tentativa https://www.histdata.com/terms-of-service/ não foi acessível pela
ferramenta de consulta; não é evidência de ausência de termos. A FAQ declara
acesso gratuito, mas isso não estabelece direito de redistribuição.
A licença XML Dukascopy encontrada em
https://www.dukascopy.com/plugins/cont.php?ref_id=1273 restringe seu próprio
produto e não autoriza genericamente históricos binários ou exportações JForex.

Decisão: usar fixtures explicitamente sintéticas, manter importador CSV local e
manifesto versionado. Adaptadores nativos HistData/Dukascopy, raw storage e
bid/ask v2 dependem de contrato de formato e direitos confirmados. Nenhum arquivo
sintético é rotulado como dado histórico. SHA-256 detecta mudanças locais; não
prova origem, licença ou autenticidade externa.
