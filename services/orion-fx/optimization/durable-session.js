import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, lstat, realpath, open, link, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identity, freezeCandidate } from './session.js';
import { compareStrategies, comparisonSummary, comparisonIds } from './comparison.js';
import { readStoredJson, verifyHistory } from '../market-data/capital-history.js';
import { createStrategy } from '../strategies/research.js';
const root = fileURLToPath(new URL('../', import.meta.url));
export const schema = 'orion.research-session.v1';
// JSON projection deliberately removes undefined object properties, as existing reports do.
export const projection = value => JSON.parse(JSON.stringify(value));
const digest = value => identity(projection(value));
export async function implementationIdentity() {
  const files = {};
  async function scan(directory) {
    for (const entry of (await readdir(join(root, directory), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('UNSAFE_SOURCE');
      if (entry.isDirectory()) await scan(name);
      else if (entry.isFile() && entry.name.endsWith('.js')) files[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
    }
  }
  for (const directory of ['calendar','cli','analytics','optimization','strategies','indicators','backtesting','financial','execution','risk','portfolio','market-data','reporting','persistence']) await scan(directory);
  files['package.json'] = createHash('sha256').update(await readFile(join(root, 'package.json'))).digest('hex');
  return { policy: 'runtime-source-sha256-v1; strict Node version; no external research dependencies', files, digest: digest(files), node: process.version };
}
function diagnostics(report) {
  return { method: 'descriptive-v1; no IID assumption; no intervals; no significance claims', evidence: 'INSUFFICIENT_EVIDENCE',
    governance: { strategies: report.results[0].strategies.length, parameterConfigurations: report.results[0].strategies.length, costScenarios: report.results.length, modelSelection: false, datasetReuse: 'UNKNOWN_UNRECORDED_HISTORY', validationReuse: 'UNKNOWN_UNRECORDED_HISTORY' },
    warnings: ['DEPENDENT_TRADES', 'SELECTION_BIAS_IF_USED_FOR_SELECTION', ...(report.results[0].strategies.length > 1 ? ['MULTIPLE_COMPARISON'] : [])],
    samples: report.results.flatMap(s => s.strategies.map(r => {
      const curve = r.validation.equityCurve;
      const returns = curve.slice(1).map((x,i) => x.equity / curve[i].equity - 1);
      const mean = returns.reduce((a,b) => a+b,0) / returns.length;
      const variance = returns.reduce((a,b) => a+(b-mean)**2,0);
      return { scenario: s.id, strategy: r.strategy.id, validationTrades: r.validation.metrics.totalTrades,
        observedUtcDates: new Set(curve.map(x => x.timestamp?.slice(0,10)).filter(Boolean)).size,
        lagOneEquityReturnAutocorrelation: returns.length >= 30 && variance > 0 ? returns.slice(1).reduce((a,b,i) => a+(b-mean)*(returns[i]-mean),0)/variance : null,
        autocorrelationLimitation: 'Descriptive bar equity marks; irregular calendar gaps; not effective independent sample size',
        trainPnl: r.training.metrics.netProfit, validationPnl: r.validation.metrics.netProfit,
        warning: 'UNEQUAL_PARTITION_LENGTHS; INSUFFICIENT_INDEPENDENCE_EVIDENCE' };
    })) };
}
async function safeDirectory(path) {
  if (path.split(/[\\/]/).includes('..')) throw new Error('UNSAFE_PATH');
  const target = resolve(path);
  const parent = dirname(target);
  if (await realpath(parent) !== parent) throw new Error('UNSAFE_DIRECTORY');
  await mkdir(target, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const stat = await lstat(target);
  if (!stat.isDirectory() || await realpath(target) !== target || (stat.mode & 0o077)) throw new Error('UNSAFE_DIRECTORY');
  return target;
}
function validate(bundle) {
  if (bundle?.schemaVersion !== schema || bundle.state !== 'COMPLETED' || bundle.manifest?.hashRules !== 'sorted-json-sha256-v1; JSON projection; exact numeric comparison') throw new Error('INVALID_SESSION_SCHEMA');
  if (bundle.sessionId !== `session-${digest(bundle.manifest)}` || bundle.resultHash !== digest(bundle.results) || bundle.bundleHash !== digest({ schemaVersion: bundle.schemaVersion, state: bundle.state, sessionId: bundle.sessionId, manifest: bundle.manifest, resultHash: bundle.resultHash, results: bundle.results })) throw new Error('SESSION_INTEGRITY_FAILURE');
  return bundle;
}
export async function inspectSession(path) { return validate(await readStoredJson(resolve(path))); }
export async function verifySession(path, input) {
  const bundle = await inspectSession(path);
  const artifact = await readStoredJson(resolve(input));
  const dataset = verifyHistory(artifact);
  if (artifact.artifactHash !== bundle.manifest.dataset.artifactHash || dataset.contentHash !== bundle.manifest.dataset.contentHash || dataset.manifest.datasetId !== bundle.manifest.dataset.id) throw new Error('DATASET_IDENTITY_MISMATCH');
  return { bundle, artifact, integrity: 'VERIFIED', computationalReplay: 'NOT_PERFORMED' };
}
export async function createDurableSession(input, directory, options = {}) {
  const artifact = await readStoredJson(resolve(input));
  // Resolve defaults before the first execution: walk-forward embeds candidate syntax.
  // Creation and replay must receive the same effective candidate representation.
  const candidates = (options.candidates ?? comparisonIds.map(id => ({ id }))).map(candidate => {
    const c = freezeCandidate(candidate), strategy = createStrategy(c.id, c.parameters);
    return { id: c.id, parameters: strategy.parameters };
  });
  const report = projection(compareStrategies(artifact, { ...options, candidates }));
  const manifest = projection({ hashRules: 'sorted-json-sha256-v1; JSON projection; exact numeric comparison',
    configuration: { candidates: report.results[0].strategies.map(x => ({ id: x.strategy.id, parameters: x.strategy.parameters })), smoke: options.smoke ?? false, costStress: options.costStress ?? false, walkForward: options.walkForward ?? null },
    configurationHash: report.configurationDigest, dataset: report.dataset, readiness: report.readiness,
    implementation: await implementationIdentity(), execution: report.integrity, accountPolicy: report.accountPolicy,
    windows: report.results[0].strategies.map(x => ({ strategy: x.strategy, warmupRequirement: x.training.comparison.warmupRequirement, training: x.training.config, validation: x.validation.config })),
    selection: 'NONE_NO_PROMOTION', evidencePolicy: 'ALWAYS_INSUFFICIENT_EVIDENCE_V1; descriptive only', seed: null,
    holdout: 'NOT_EVALUATED; REGISTRY_STATE_UNKNOWN_NOT_QUERIED; NO_FRESHNESS_CLAIM' });
  const results = { comparison: report, statistics: diagnostics(report) };
  const body = { schemaVersion: schema, state: 'COMPLETED', sessionId: `session-${digest(manifest)}`, manifest, resultHash: digest(results), results };
  const bundle = { ...body, bundleHash: digest(body) };
  const target = await safeDirectory(directory), path = join(target, `${bundle.sessionId}.json`);
  const temporary = join(target, `.incomplete-${randomUUID()}`);
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(bundle) + '\n'); await file.sync(); } finally { await file.close(); }
  try {
    try { await link(temporary, path); }
    catch (e) { if (e.code !== 'EEXIST') throw e; const prior = await inspectSession(path); if (prior.bundleHash !== bundle.bundleHash) throw new Error('SESSION_CONFLICT'); }
    const fd = await open(target, 'r'); try { await fd.sync(); } finally { await fd.close(); }
  } finally { await unlink(temporary); }
  return { sessionId: bundle.sessionId, path, resultHash: bundle.resultHash, bundleHash: bundle.bundleHash, state: 'COMPLETED', evidence: 'INSUFFICIENT_EVIDENCE' };
}
export async function replaySession(path, input) {
  const { bundle, artifact } = await verifySession(path, input);
  if (digest(await implementationIdentity()) !== digest(bundle.manifest.implementation)) throw new Error('IMPLEMENTATION_IDENTITY_MISMATCH');
  const report = projection(compareStrategies(artifact, bundle.manifest.configuration));
  if (digest({ comparison: report, statistics: diagnostics(report) }) !== bundle.resultHash) throw new Error('REPLAY_MISMATCH');
  return { sessionId: bundle.sessionId, integrity: 'VERIFIED', computationalReplay: 'IDENTICAL', resultHash: bundle.resultHash };
}
export async function runSessionCommand([command, ...args], { output, errorOutput }) {
  try {
    if (args.length === 1 && args[0] === '--help') { output(`${command} --input HISTORY --out PRIVATE_DIRECTORY (create) | --session SESSION --input HISTORY (verify/replay) | --session SESSION (inspect); create supports --cost-stress true|false --walk-forward rolling|expanding --smoke true|false`); return 0; }
    const options = {};
    for (let i=0;i<args.length;i+=2) { const key=args[i]?.slice(2); if (!args[i].startsWith('--') || !['input','out','session','cost-stress','walk-forward','smoke'].includes(key) || key in options || args[i+1] === undefined) throw new Error('INVALID_ARGUMENTS'); options[key]=args[i+1]; }
    const action = command.split(':').at(-1);
    if (['smoke','cost-stress'].some(k => options[k] !== undefined && !['true','false'].includes(options[k]))) throw new Error('INVALID_ARGUMENTS');
    if (action !== 'inspect' && !options.input || action !== 'create' && !options.session || action === 'create' && !options.out) throw new Error('INVALID_ARGUMENTS');
    let result;
    if (action === 'create') result = await createDurableSession(options.input, options.out, { smoke: options.smoke === 'true', costStress: options['cost-stress'] === 'true', walkForward: options['walk-forward'] ?? null });
    else if (action === 'replay') result = await replaySession(options.session, options.input);
    else if (action === 'verify') { const v=await verifySession(options.session, options.input); result={ sessionId:v.bundle.sessionId, integrity:v.integrity, computationalReplay:v.computationalReplay }; }
    else { const b=await inspectSession(options.session); result={ sessionId:b.sessionId, state:b.state, integrity:'SELF_HASH_CHECKED', holdout:b.manifest.holdout, summary:comparisonSummary(b.results.comparison), statistics:b.results.statistics }; }
    output(JSON.stringify(result,null,2)); return 0;
  } catch(e) { errorOutput(/^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'SESSION_IO_ERROR'); return 1; }
}
export const sessionCommands = ['create','inspect','verify','replay'].map(x => `research:session:${x}`);
