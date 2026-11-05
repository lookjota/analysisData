# Proveniência e preparação de históricos

Objetivo: separar identidade de conteúdo de autenticidade/licença. Hoje há CSV
validado, SHA256 canônico, source/synthetic por candle, rejeição de duplicatas e
gaps sem preenchimento. Runner conserva CSV canônico, hash e código em diretório
exclusivo. Não há histórico real adquirido ou integração adicional.

Pesquisa em páginas oficiais em 2026-11-05:

| Candidato | Evidência atual | Decisão / lacuna |
|---|---|---|
| [HistData FAQ](https://www.histdata.com/f-a-q/) | EUR/USD tick/M1, OHLC bid, ask apenas tick Generic ASCII; EST fixo sem DST; acesso gratuito e qualidade sem garantia | Não importar OHLC bid como mid; licença de redistribuição não confirmada |
| [Dukascopy histórico](https://www.dukascopy.com/wiki/en/development/strategy-api/historical-data/) | Documentação oficial de serviços e histórico via JForex | Cobertura, custos, limites e autorização do produto específico devem ser confirmados |
| [OANDA pricing](https://developer.oanda.com/rest-live-v20/pricing-ep/) | Documenta componentes de preço e autenticação de conta | Candidato documental somente; nenhuma integração, conta ou credencial utilizada |

A [licença XML Dukascopy](https://www.dukascopy.com/plugins/cont.php?ref_id=1273)
é específica de XML, restrita e não autoriza genericamente histórico binário.
Acesso público não prova permissão de redistribuição. Não foi selecionada fonte
nem realizado download de preços. Limites de API/custos/licença precisam de
verificação por produto antes de aquisição. Documentação pública não substitui
contrato vigente do usuário.

Pipeline planejado: bruto autorizado imutável → SHA256 dos bytes → manifesto de
licença/origem/data de aquisição → interpretação de timezone e lado do preço →
agregação explícita H1 → validação sem limpeza silenciosa → CSV/hash canônico →
experimento. Manifesto futuro exige URL da fonte, instrumento, período, timezone,
priceBasis, licença e evidência, transformações ordenadas, contagens, hashes raw e
normalizado, gaps e versão do calendário. Hoje o hash cobre somente conteúdo
normalizado e não é prova de autoria. CSV original bruto real não está armazenado.

Calendário atual aproxima sexta22UTC/domingo22UTC; falta DST NY/Londres, feriados
e sessões. Nunca inferir spread histórico do OHLC mid; simulação declara custo
hipotético constante. `tests/historical.test.js` e `checkpoints.test.js` validam
contratos/CSV/hash; aceitação de dados reais requer fixtures DST/bid/ask e licença.
