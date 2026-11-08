import { receiptCommands, runReceipt } from './receipt.js';
import { forwardCommands, runForward } from './forward.js';
import { operationCommands, runOperations } from './operations.js';
import { researchCommands, runResearch } from './research.js';
import { collectionCommands, runCollection } from './collection.js';
import { historyCommands, runHistory } from './history.js';
import { offlineCommands, runOffline } from './offline.js';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config/index.js';
import { CapitalDemoBroker, BrokerError } from '../brokers/capital-demo.js';
import { readQuote, readHourlyCandles } from '../market-data/index.js';

const commands = ['status', 'auth', 'accounts', 'accounts:list', 'discover', 'quote', 'candles'];

export async function run(args = process.argv.slice(2), {
  env = process.env, fetchImpl = globalThis.fetch,
  output = line => console.log(line), errorOutput = line => console.error(line),
} = {}) {
  const [command = 'status', count] = args;
  if (receiptCommands.includes(command)) return runReceipt(args, { output, errorOutput });
  if (forwardCommands.includes(command)) return runForward(args, { output, errorOutput });
  if (operationCommands.includes(command)) return runOperations(args, { output, errorOutput });
  if (researchCommands.includes(command)) return runResearch(args, { output, errorOutput });
  if (collectionCommands.includes(command)) return runCollection(args, { env, fetchImpl, output, errorOutput });
  if (historyCommands.includes(command)) return runHistory(args, { env, fetchImpl, output, errorOutput });
  if (offlineCommands.includes(command)) return runOffline(args, { output, errorOutput });
  if (args.includes('--help')) {
    output('Uso: status | auth | accounts | accounts:list | discover | quote | candles [1..1000] | ' + [...collectionCommands, ...historyCommands, ...offlineCommands].join(' | ') + '; comandos offline: <comando> --help');
    return 0;
  }
  if (!commands.includes(command) || args.length > (command === 'candles' ? 2 : 1)) {
    errorOutput(`Uso: status | auth | accounts | accounts:list | discover | quote | candles [1..1000]`);
    return 1;
  }
  let broker;
  let exitCode = 0;
  try {
    const config = loadConfig(env, { credentials: command !== 'status' });
    if (command === 'status') {
      output(JSON.stringify({ service: 'Orion FX V1', environment: 'demo', tradingEnabled: false, connected: false }));
      return 0;
    }
    const max = count === undefined ? 24 : Number(count);
    if (command === 'candles' && (!Number.isInteger(max) || max < 1 || max > 1000)) {
      throw new Error('INVALID_CANDLE_LIMIT');
    }
    broker = new CapitalDemoBroker(config, { fetchImpl });
    const authenticated = await broker.authenticate();
    let result;
    if (command === 'auth') result = authenticated;
    else if (command === 'accounts' || command === 'accounts:list') result = await broker.accounts();
    else {
      const instrument = await broker.findEurUsd();
      if (command === 'discover') result = instrument;
      else if (command === 'quote') result = await readQuote(broker, instrument.epic);
      else result = await readHourlyCandles(broker, instrument.epic, max);
    }
    output(JSON.stringify(result, null, 2));
  } catch (error) {
    // No raw exception, stack, config, HTTP payload or headers reach the terminal.
    errorOutput(error instanceof BrokerError ? `Capital Demo: ${error.code}${error.status ? ` (HTTP ${error.status})` : ''}` :
      'Orion FX: configuração ou dados inválidos; consulte o README.');
    exitCode = 1;
  } finally {
    if (broker) {
      try { await broker.close(); }
      catch { errorOutput('Capital Demo: encerramento remoto não confirmado; sessão local descartada.'); exitCode = 1; }
    }
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
