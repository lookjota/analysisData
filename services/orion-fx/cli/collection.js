import { normalizeCandle } from '../market-data/historical.js';
import { CapitalDemoBroker } from '../brokers/capital-demo.js';
import { loadConfig } from '../config/index.js';
import { assertCollectionAccount, createCollection, collectionStatus, resumeCollection, publishCollection, inspectRegistry, mergeHistory } from '../market-data/collection.js';
import { readStoredJson, saveHistory, verifyHistory, safePath } from '../market-data/capital-history.js';
import { lstat } from 'node:fs/promises';

export const collectionCommands = ['history:job:create', 'history:job:status', 'history:job:resume', 'history:job:verify', 'history:job:publish', 'history:merge', 'history:revisions', 'history:registry:inspect'];
const contracts = {
  'history:registry:inspect': { required: ['registry'] },
  'history:job:create': { required: ['job', 'from', 'to'], optional: ['window-hours', 'delay-ms', 'retries', 'retry-ms', 'calendar'] },
  'history:job:status': { required: ['job'] }, 'history:job:resume': { required: ['job'] }, 'history:job:verify': { required: ['job'] },
  'history:job:publish': { required: ['job', 'registry'], optional: ['parent'] },
  'history:merge': { required: ['left', 'right', 'out'], optional: ['parent'] }, 'history:revisions': { required: ['left', 'right'] },
};
export async function runCollection(args, { env, fetchImpl, output, errorOutput }) {
  let broker, code = 0;
  try {
    const contract = contracts[args[0]], flags = {};
    if (args.length === 2 && args[1] === '--help') {
      output(`${args[0]} ${contract.required.map(k => `--${k} VALUE`).join(' ')} ${(contract.optional ?? []).map(k => `[--${k} VALUE]`).join(' ')}. Only history:job:resume uses network; create requires CAPITAL_EXPECTED_ACCOUNT_ID. UTC H1 boundaries, exclusive end. Defaults: window-hours 168, delay-ms 200, retries 2, retry-ms 1000. Parents are sha256 dataset IDs. Registry must exist. history:inspect --input FILE.json verifies published data offline.`);
      return 0;
    }
    for (let i = 1; i < args.length; i += 2) {
      const k = args[i].slice(2);
      if (!args[i].startsWith('--') || ![...contract.required, ...(contract.optional ?? [])].includes(k) || k in flags || !args[i + 1]) throw new Error('INVALID_ARGUMENTS');
      flags[k] = args[i + 1];
    }
    if (contract.required.some(k => !flags[k])) throw new Error('INVALID_ARGUMENTS');
    let result;
    if (args[0] === 'history:job:create') {
      result = await createCollection(flags.job, { from: flags.from, to: flags.to, expectedAccountId: env.CAPITAL_EXPECTED_ACCOUNT_ID, ...(flags.calendar ? { calendar: await readStoredJson(flags.calendar) } : {}),
        ...Object.fromEntries([['window-hours', 'windowHours'], ['delay-ms', 'delayMs'], ['retries', 'retries'], ['retry-ms', 'retryMs']].filter(([k]) => k in flags).map(([k, field]) => [field, Number(flags[k])])) });
    } else if (args[0] === 'history:registry:inspect') {
      result = await inspectRegistry(flags.registry);
    } else if (['history:job:status', 'history:job:verify'].includes(args[0])) {
      result = await collectionStatus(flags.job, { verify: args[0].endsWith(':verify') });
    } else if (args[0] === 'history:job:publish') {
      result = await publishCollection(flags.job, flags.registry, { parentDatasetIds: flags.parent ? [flags.parent] : [] });
    } else if (args[0] === 'history:job:resume') {
      // Verify local state before any authentication request.
      await assertCollectionAccount(flags.job, env.CAPITAL_EXPECTED_ACCOUNT_ID);
      const status = await collectionStatus(flags.job, { verify: true });
      if (status.state !== 'STAGING') result = status;
      else {
        broker = new CapitalDemoBroker(loadConfig(env), { fetchImpl });
        await broker.authenticate();
        result = await resumeCollection(flags.job, broker, { expectedAccountId: env.CAPITAL_EXPECTED_ACCOUNT_ID });
      }
    } else {
      const left = await readStoredJson(flags.left), right = await readStoredJson(flags.right);
      verifyHistory(left); verifyHistory(right);
      if (args[0] === 'history:revisions') {
        const observed = new Map(left.candles.map(c => [c.timestamp, JSON.stringify(normalizeCandle(c))]));
        const timestamps = right.candles.filter(c => observed.has(c.timestamp) && observed.get(c.timestamp) !== JSON.stringify(normalizeCandle(c))).map(c => c.timestamp);
        result = { conflictingTimestamps: timestamps, left: left.manifest.datasetId, right: right.manifest.datasetId };
      } else {
        if (!flags.out.endsWith('.json')) throw new Error('INVALID_ARGUMENTS');
        await safePath(flags.out);
        try { await lstat(flags.out); throw new Error('OUTPUT_EXISTS'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        const artifact = mergeHistory([left, right], { parentDatasetIds: flags.parent ? [flags.parent] : [] });
        await saveHistory(flags.out, artifact);
        result = { datasetId: artifact.manifest.datasetId, count: artifact.candles.length };
      }
    }
    output(JSON.stringify(result, null, 2));
  } catch (error) {
    errorOutput(JSON.stringify({ error: 'COLLECTION_FAILED', ...(error.message === 'CONFLICTING_OVERLAP' ? { conflictingTimestamps: error.timestamps } : {}) }));
    code = 1;
  } finally {
    if (broker) try { await broker.close(); } catch { errorOutput('Capital Demo: remote logout unconfirmed; local session discarded.'); code = 1; }
  }
  return code;
}
