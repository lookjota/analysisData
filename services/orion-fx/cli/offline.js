import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { importCsv, validateDataset, exportCsv, writeExclusive } from '../market-data/historical.js';
import { syntheticCandles } from '../data/fixtures/synthetic.js';
import { createStrategy, strategyIds } from '../strategies/research.js';
import { backtest } from '../backtesting/index.js';
import { passiveHold } from '../backtesting/passive.js';
import { replay } from '../paper/replay.js';
import { enrich, writeReports } from '../reporting/index.js';
import { sma, ema, rsi, macd, atr, adx, bollinger, stochastic, returns, candleRange, rollingHigh, rollingLow, standardDeviation } from '../indicators/index.js';
import { assessIntent, riskConfig } from '../risk/simulation.js';
import { datasetManifest, writeManifest } from '../market-data/manifest.js';
export const offlineCommands = ['data:manifest', 'data:validate', 'data:generate', 'indicators', 'backtest', 'compare', 'risk:check', 'paper:replay', 'report'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(['input', 'strategy', 'count', 'regime', 'spread', 'slippage', 'commission', 'swap', 'capital', 'out', 'allow-gaps', 'acquired-at', 'license-status', 'license-reference']);
const help = command => `${command}: pesquisa offline sem credenciais\nUso: npm start -- ${command} [--input candles.csv] [--strategy ${[...strategyIds, 'passive-hold-benchmark'].join('|')}]\n[--count 720] [--regime mixed|up|down|flat|volatile|quiet|gap|invalid]\n[--capital 1000] [--spread 1] [--slippage 0.1] [--commission 0] [--swap 0]\n[--out nome] [--allow-gaps true|false] [--help]\nSem --input: fixture SINTÉTICA. Custos: spread/slippage em pips; comissão USD/unidade/lado; swap USD/unidade/dia.\n--out cria services/orion-fx/reports/nome (novo); data:generate cria data/samples/nome.csv.\nreport gera novamente o backtest, sem desserializar relatórios externos.`;
export async function runOffline(args, { output, errorOutput }) {
  const [command, ...rest] = args;
  if (rest.length === 1 && rest[0] === '--help') { output(help(command)); return 0; }
  try {
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      const key = rest[i].startsWith('--') ? rest[i].slice(2) : '';
      if (!flags.has(key) || rest[i + 1] === undefined || rest[i + 1].startsWith('--') || key in options) throw new Error('INVALID_ARGUMENTS');
      options[key] = rest[i + 1];
    }
    if (options['allow-gaps'] && !['true', 'false'].includes(options['allow-gaps'])) throw new Error('INVALID_ARGUMENTS');
    if (options.out && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(options.out)) throw new Error('INVALID_OUTPUT_NAME');
    if (options.input && !options.input.endsWith('.csv')) throw new Error('CSV_REQUIRED');
    const dataset = options.input ? await importCsv(resolve(options.input)) : validateDataset(syntheticCandles({ count: Number(options.count ?? 720), regime: options.regime ?? 'mixed' }));
    const candles = dataset.candles;
    if (command === 'data:manifest') {
      const manifest = datasetManifest(candles, { acquiredAt: options['acquired-at'], license: { status: options['license-status'] ?? (dataset.synthetic ? 'synthetic' : 'unverified'), reference: options['license-reference'] ?? (dataset.synthetic ? 'local-synthetic-generator' : 'not-verified'), redistributionAllowed: false } });
      if (options.out) {
        const directory = resolve(root, 'reports', options.out);
        await mkdir(resolve(root, 'reports'), { recursive: true });
        await mkdir(directory, { mode: 0o700 });
        await writeManifest(resolve(directory, 'dataset-manifest.json'), manifest);
      }
      output(JSON.stringify(manifest, null, 2)); return 0;
    }
    if (command === 'data:validate') { output(JSON.stringify({ ...dataset, candles: undefined, count: candles.length }, null, 2)); return 0; }
    if (command === 'data:generate') {
      if (options.input || !options.out) throw new Error('GENERATE_REQUIRES_OUT_AND_NO_INPUT');
      const directory = resolve(root, 'data/samples'); await mkdir(directory, { recursive: true });
      await writeExclusive(resolve(directory, `${options.out}.csv`), exportCsv(candles));
      output(`Fixture SINTÉTICA criada: data/samples/${options.out}.csv`); return 0;
    }
    if (command === 'indicators') {
      const xs = candles.map(c => c.close);
      output(JSON.stringify({ schemaVersion: 'orion.indicators.v1', synthetic: dataset.synthetic, timestamps: candles.map(c => c.timestamp), sma: sma(xs, 20), ema: ema(xs, 20), rsi: rsi(xs), macd: macd(xs), atr: atr(candles), adx: adx(candles), bollinger: bollinger(xs), stochastic: stochastic(candles), returns: returns(xs), logReturns: returns(xs, true), range: candleRange(candles), high: rollingHigh(candles.map(c => c.high), 20), low: rollingLow(candles.map(c => c.low), 20), standardDeviation: standardDeviation(xs, 20) }, null, 2)); return 0;
    }
    if (command === 'risk:check') {
      output(JSON.stringify(assessIntent({ side: 1, entry: candles.at(-1).close, stopDistance: .002, takeDistance: .004, equity: 1000, cash: 1000, peak: 1000, dayStart: 1000 }, riskConfig()), null, 2)); return 0;
    }
    const configuration = { strategy: options.strategy === 'passive-hold-benchmark' ? null : createStrategy(options.strategy ?? 'trend'), initialCapital: Number(options.capital ?? 1000), costs: { spreadPips: Number(options.spread ?? 1), slippagePips: Number(options.slippage ?? .1), commissionPerUnit: Number(options.commission ?? 0), swapPerUnitPerDay: Number(options.swap ?? 0) }, allowSessionGaps: options['allow-gaps'] === 'true' };
    if (command === 'compare') {
      output(JSON.stringify(strategyIds.map(id => { const r = enrich(backtest(candles, { ...configuration, strategy: createStrategy(id) })); return { strategy: id, synthetic: dataset.synthetic, metrics: { ...r.metrics, drawdownCurve: undefined }, warnings: r.warnings }; }), null, 2)); return 0;
    }
    if (command === 'paper:replay' && configuration.strategy === null) throw new Error('PASSIVE_BENCHMARK_REPLAY_UNSUPPORTED');
    const result = configuration.strategy === null ? passiveHold(candles, configuration) : command === 'paper:replay' ? await replay(candles, configuration) : backtest(candles, configuration);
    let report;
    if (options.out) {
      await mkdir(resolve(root, 'reports'), { recursive: true });
      report = await writeReports(result, resolve(root, 'reports', options.out));
    } else report = enrich(result);
    output(JSON.stringify({ schemaVersion: report.schemaVersion, strategy: report.strategy, dataset: report.dataset, config: report.config, mode: report.mode, metrics: { ...report.metrics, drawdownCurve: undefined }, warnings: report.warnings, reportDirectory: options.out ? relative(process.cwd(), resolve(root, 'reports', options.out)) : null }, null, 2));
    return 0;
  } catch (error) {
    // Only fixed internal codes; never print filesystem paths or raw external content.
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'OFFLINE_INPUT_OR_OUTPUT_ERROR';
    errorOutput(`Orion FX offline: ${code}. Use ${command} --help.`); return 1;
  }
}
