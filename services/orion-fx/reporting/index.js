import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { csvCell, writeExclusive } from '../market-data/historical.js';
import { analyze, robustnessWarnings } from '../analytics/index.js';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function enrich(result) {
  const metrics = analyze(result);
  return { ...result, metricOrigin: result.config.evaluation?.set ?? (result.mode === 'benchmark' ? 'PASSIVE_BENCHMARK' : 'EXPLORATORY'), metrics, warnings: robustnessWarnings(result, metrics) };
}
export function tableCsv(rows, columns) {
  return [columns.map(csvCell).join(','), ...rows.map(row => columns.map(k => csvCell(row[k])).join(','))].join('\n') + '\n';
}
function chart(values, label) {
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((v, i) => `${10 + 780 * i / Math.max(1, values.length - 1)},${190 - 180 * (v - min) / range}`).join(' ');
  return `<figure><figcaption>${escape(label)} — min ${min.toFixed(4)}, max ${max.toFixed(4)}</figcaption><svg viewBox="0 0 800 210" role="img" aria-label="${escape(label)}"><polyline points="${points}" fill="none" stroke="#63d9b0" stroke-width="2"/></svg></figure>`;
}
export function htmlReport(report) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Orion FX — pesquisa offline</title><style>body{background:#101820;color:#eee;font:16px system-ui;max-width:1100px;margin:2em auto;padding:1em}svg{width:100%;background:#172630}table{border-collapse:collapse}td,th{padding:.4em;border:1px solid #567}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Orion FX: ${escape(report.strategy.id)}</h1><p>${report.dataset.synthetic ? 'DADOS SINTÉTICOS: preços inventados. Não evidenciam desempenho no mercado real.' : 'Dados importados: proveniência deve ser verificada.'} Simulação sem ordens externas.</p><p>Período: ${escape(report.dataset.start)} a ${escape(report.dataset.end)}</p><h2>Experimento</h2><pre>${escape(JSON.stringify({ experiment: report.experiment ? { runId: report.experiment.runId, experimentId: report.experiment.experimentId, executedAt: report.experiment.executedAt, gitCommit: report.experiment.gitCommit } : null, metricOrigin: report.metricOrigin, research: report.research, engineVersion: report.simulatorVersion, datasetHash: report.dataset.contentHash, durability: report.durability, riskTransitions: report.riskTransitions, operationalWarnings: report.operationalWarnings }, null, 2))}</pre><h2>Métricas líquidas</h2><table>${Object.entries(report.metrics).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => `<tr><th>${escape(k)}</th><td>${escape(v ?? 'indefinido')}</td></tr>`).join('')}</table>${chart(report.equityCurve.map(x => x.equity), 'Equity USD')}${chart(report.metrics.drawdownCurve.map(x => x.percentage), 'Drawdown %')}<h2>Configuração e parâmetros</h2><pre>${escape(JSON.stringify({ strategy: report.strategy, config: report.config, dataset: report.dataset, warnings: report.warnings, assumptions: report.metrics.assumptions }, null, 2))}</pre><h2>Trades</h2><pre>${escape(JSON.stringify(report.trades, null, 2))}</pre><p>Hipóteses OHLC; liquidez não modelada, sem evidência de capacidade. Modelo de preço e custos declarados na configuração. Stops não garantem perda máxima em gaps. Rentabilidade futura não é garantida.</p></html>`;
}
export async function writeReports(result, directory) {
  const report = enrich(result);
  // Directory must be new; partial failures remain inspectable, never overwrite.
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const files = {
    'report.json': JSON.stringify(report, null, 2) + '\n',
    'report.html': htmlReport(report),
    'trades.csv': tableCsv(report.trades, ['openedAt', 'closedAt', 'side', 'units', 'entry', 'exit', 'reason', 'grossPnl', 'entryCommission', 'exitCommission', 'swap', 'netPnl']),
    'fills.csv': tableCsv(report.fills ?? [], ['timestamp', 'signalTimestamp', 'signalAvailableAt', 'earliestEligibleExecutionTimestamp', 'type', 'side', 'orderSide', 'executionMode', 'executableQuote', 'spreadBasis', 'units', 'requestedPrice', 'requestedPriceBasis', 'executedPrice', 'price', 'spreadCostUsd', 'slippageCostUsd', 'commissionUsd', 'reason']),
    'equity.csv': tableCsv(report.equityCurve, ['timestamp', 'cash', 'equity', 'realizedPnl', 'unrealizedPnl', 'marginUsed', 'freeMargin', 'exposure']),
    'metrics.csv': tableCsv(Object.entries(report.metrics).filter(([, v]) => typeof v === 'number' || v === null).map(([metric, value]) => ({ metric, value })), ['metric', 'value']),
  };
  for (const [name, content] of Object.entries(files)) await writeExclusive(join(directory, name), content);
  return report;
}
