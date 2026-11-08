import { lstat } from 'node:fs/promises';
import { loadConfig } from '../config/index.js';
import { CapitalDemoBroker, BrokerError } from '../brokers/capital-demo.js';
import { acquireHistory, saveHistory, importDataset, safePath, historyRange } from '../market-data/capital-history.js';

export const historyCommands = ['history:download', 'history:inspect'];
export async function runHistory(args, { env, fetchImpl, output, errorOutput }) {
  let broker;
  let code = 0;
  try {
    if (args.length === 2 && args[1] === '--help') {
      output('history:download --from UTC_ISO_Z --to UTC_ISO_Z --out NEW.json (end exclusive; H1 aligned; CAPITAL_EXPECTED_ACCOUNT_ID required). history:inspect --input LOCAL.json. No strategy is executed.');
      return 0;
    }
    const flags = {};
    const allowed = args[0] === 'history:download' ? ['from', 'to', 'out'] : ['input'];
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i].slice(2);
      if (!args[i].startsWith('--') || !allowed.includes(key) || key in flags || !args[i + 1]) throw new Error('INVALID_ARGUMENTS');
      flags[key] = args[i + 1];
    }
    if (allowed.some(k => !flags[k])) throw new Error('INVALID_ARGUMENTS');
    if (args[0] === 'history:inspect') {
      const d = await importDataset(flags.input);
      output(JSON.stringify({ count: d.candles.length, contentHash: d.contentHash, synthetic: d.synthetic, quality: d.quality, manifest: d.manifest }, null, 2));
      return 0;
    }
    historyRange(flags.from, flags.to);
    if (!flags.out.endsWith('.json') || !env.CAPITAL_EXPECTED_ACCOUNT_ID?.trim()) throw new Error('INVALID_ARGUMENTS');
    const target = await safePath(flags.out);
    try { await lstat(target); throw new Error('OUTPUT_EXISTS'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    broker = new CapitalDemoBroker(loadConfig(env), { fetchImpl });
    await broker.authenticate();
    const artifact = await acquireHistory(broker, { from: flags.from, to: flags.to, expectedAccountId: env.CAPITAL_EXPECTED_ACCOUNT_ID });
    await saveHistory(target, artifact);
    output(JSON.stringify({ saved: true, count: artifact.candles.length, contentHash: artifact.manifest.canonicalContentHash,
      environment: 'demo', tradingEnabled: false, quality: artifact.manifest.quality }, null, 2));
  } catch (error) {
    errorOutput(error instanceof BrokerError ? `Capital Demo: ${error.code}${error.status ? ` (HTTP ${error.status})` : ''}` : 'Orion FX: historical input, validation or storage failed; see history:download --help.');
    code = 1;
  } finally {
    if (broker) try { await broker.close(); }
    catch { errorOutput('Capital Demo: remote logout unconfirmed; local session discarded.'); code = 1; }
  }
  return code;
}
