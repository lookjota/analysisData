import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createCollection, resumeCollection, collectionStatus, publishCollection, planWindows, mergeHistory } from '../market-data/collection.js';
import { acquireHistory, readStoredJson, importDataset, verifyHistory, saveHistory } from '../market-data/capital-history.js';
import { BrokerError } from '../brokers/capital-demo.js';
import { marketSession } from '../calendar/forex.js';
import { run } from '../cli/index.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';

const HOUR = 3600000, from = '2026-11-02T00:00:00.000Z', to = '2026-11-02T06:00:00.000Z';
const account = 'fixture-account-only';
const price = timestamp => ({ snapshotTimeUTC: timestamp, openPrice: { bid: 1.1, ask: 1.1002 }, highPrice: { bid: 1.101, ask: 1.1012 }, lowPrice: { bid: 1.099, ask: 1.0992 }, closePrice: { bid: 1.1, ask: 1.1002 } });
function broker({ fault, mutate = x => x, epic = 'EURUSD', onRequest } = {}) {
  let requests = 0;
  const calls = [];
  return { calls, verifyContext: async a => { assert.equal(a, account); calls.push('context'); }, findEurUsd: async () => { calls.push('discovery'); return { epic, metadata: { symbol: 'EUR/USD', instrumentType: 'CURRENCIES' } }; },
    historicalCandles: async (epic, request) => {
      calls.push(request); requests++;
      if (onRequest) await onRequest(requests);
      if (fault) { const e = fault(requests); if (e) throw e; }
      const prices = [];
      for (let t = Date.parse(request.from); t <= Date.parse(request.to); t += HOUR) {
        const iso = new Date(t).toISOString();
        if (!['WEEKLY_CLOSED', 'DECLARED_HOLIDAY'].includes(marketSession(iso).status)) prices.push(price(iso));
      }
      return mutate({ prices });
    } };
}
async function job(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'orion-collection-'));
  const directory = join(root, 'job'), registry = join(root, 'registry');
  await mkdir(registry);
  await createCollection(directory, { from, to, expectedAccountId: account, windowHours: 2, ...options });
  return { root, directory, registry };
}
const resume = (directory, b, options = {}) => resumeCollection(directory, b, { expectedAccountId: account, sleep: async () => {}, ...options });
async function artifact(options = {}, overrides = {}) {
  return acquireHistory(broker(overrides), { from, to, expectedAccountId: account, sleep: async () => {}, ...options });
}

test('bounded multi-window collection, paced UTC inclusive wire endpoints, end-exclusive publication and offline consumption', async () => {
  const { directory, registry } = await job();
  const b = broker(), sleeps = [];
  assert.equal((await resume(directory, b, { sleep: async ms => sleeps.push(ms) })).state, 'READY');
  const requests = b.calls.filter(x => typeof x === 'object');
  assert.deepEqual(requests.map(r => r.max), [2, 2, 2]);
  assert.equal(requests[0].from, from); assert.equal(requests.at(-1).to, '2026-11-02T05:00:00.000Z');
  assert.deepEqual(sleeps, Array(9).fill(200));
  const published = await publishCollection(directory, registry);
  assert.equal(published.count, 6);
  const data = await importDataset(published.path);
  assert.equal(data.contentHash, published.contentHash);
  assert.equal((await collectionStatus(directory, { verify: true })).state, 'PUBLISHED');
  assert.equal((await publishCollection(directory, registry)).datasetId, published.datasetId);
  const before = b.calls.length;
  await resume(directory, b); await resume(directory, b);
  assert.equal(b.calls.length, before);
  for (const id of ['trend', 'mean-reversion', 'breakout', 'ma-cross']) {
    const result = backtest(data.candles, { strategy: createStrategy(id), dataValidation: { calendarMode: 'calendar-v1', calendar: data.manifest.calendar } });
    assert.equal(result.dataset.count, 6);
  }
  const lines = [];
  for (const args of [['history:inspect', '--input', published.path], ['history:job:verify', '--job', directory], ['history:job:status', '--job', directory], ['data:validate', '--input', published.path]]) {
    assert.equal(await run(args, { env: {}, fetchImpl: () => assert.fail('network forbidden'), output: s => lines.push(s), errorOutput: s => lines.push(s) }), 0, lines.join());
  }
});

test('window bounds cap requests and total work; invalid UTC, alignment and future periods fail offline', () => {
  assert.deepEqual(planWindows('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z', 1000).map(w => (Date.parse(w.to) - Date.parse(w.from)) / HOUR), [1000, 416]);
  for (const size of [0, 1001, 1.1, Infinity]) assert.throws(() => planWindows(from, to, size));
  for (const [start, end] of [[from, from], [to, from], [from, '2026-11-02T06:30:00Z'], [from.replace('Z', '+00:00'), to], [from, '2099-01-01T00:00:00Z']]) assert.throws(() => planWindows(start, end));
});

for (const [name, status, code, retried] of [['401', 401, 'SESSION_EXPIRED', false], ['403', 403, 'HTTP_ERROR', false], ['429', 429, 'RATE_LIMITED', true], ['500', 500, 'BROKER_UNAVAILABLE', true], ['503', 503, 'BROKER_UNAVAILABLE', true], ['timeout', undefined, 'TIMEOUT', true], ['network', undefined, 'NETWORK_ERROR', true]]) {
  test(`${name}: bounded retry policy, durable interruption and explicit resume`, async () => {
    const { directory, registry } = await job({ retries: 1 });
    const b = broker({ fault: () => new BrokerError(code, status) }), sleeps = [];
    await assert.rejects(resume(directory, b, { sleep: async ms => sleeps.push(ms) }));
    assert.equal(b.calls.filter(x => typeof x === 'object').length, retried ? 2 : 1);
    assert.equal(sleeps.filter(x => x === 1000).length, retried ? 1 : 0);
    assert.equal((await collectionStatus(directory)).windows[0].state, 'INTERRUPTED');
    await assert.rejects(publishCollection(directory, registry), /INCOMPLETE/);
    await resume(directory, broker());
    assert.equal((await collectionStatus(directory, { verify: true })).state, 'READY');
  });
}

for (const [name, mutate] of [
  ['missing open hour', d => ({ prices: d.prices.slice(1) })],
  ['duplicate', d => ({ prices: [d.prices[0], d.prices[0]] })],
  ['out of order', d => ({ prices: d.prices.reverse() })],
  ['invalid bid ask', d => { d.prices[0].openPrice.ask = 1; return d; }],
  ['malformed', () => ({ prices: null })],
  ['unsupported resolution', d => ({ ...d, resolution: 'MINUTE' })],
  ['overfull response', d => ({ prices: [...d.prices, d.prices[0]] })],
  ['outside range', d => { d.prices[0].snapshotTimeUTC = '2026-11-01T23:00:00Z'; return d; }],
]) test(`${name}: fail closed, retain rejected state, prohibit publication`, async () => {
  const { directory, registry } = await job();
  await assert.rejects(resume(directory, broker({ mutate })));
  assert.ok(['REJECTED', 'UNAVAILABLE'].includes((await collectionStatus(directory)).windows[0].state));
  await assert.rejects(publishCollection(directory, registry));
  await assert.rejects(resume(directory, broker()), /NEW_JOB/);
});

test('weekend/DST windows are classified closed without broker calls or invented prices', async () => {
  const { directory, registry } = await job({ from: '2026-10-30T20:00:00Z', to: '2026-11-01T23:00:00Z', windowHours: 1 });
  const b = broker(); await resume(directory, b);
  const status = await collectionStatus(directory, { verify: true });
  assert.equal(status.windows.filter(w => w.state === 'CALENDAR_CLOSED').length, 49);
  assert.equal(b.calls.filter(x => typeof x === 'object').length, 2);
  assert.equal((await publishCollection(directory, registry)).count, 2);
  assert.equal(marketSession('2026-03-08T21:00:00Z').status, 'OPEN');
  assert.equal(marketSession('2026-03-01T21:00:00Z').status, 'WEEKLY_CLOSED');
});

test('declared holiday and IANA calendar are preserved; incompatible calendars cannot merge', async () => {
  const calendar = { provider: 'fixture declared calendar', closures: ['2026-11-02'], weeklyTimezone: 'America/New_York' };
  const { directory } = await job({ from: '2026-11-02T05:00:00Z', to: '2026-11-03T05:00:00Z', windowHours: 24, calendar });
  const b = broker(); await resume(directory, b);
  assert.equal(b.calls.length, 0);
  assert.equal((await collectionStatus(directory, { verify: true })).windows[0].state, 'CALENDAR_CLOSED');
  const a = await artifact(), other = await artifact({ calendar: { provider: 'other' } });
  assert.throws(() => mergeHistory([a, other]), /INCOMPATIBLE/);
});

test('deterministic merge deduplicates exact overlaps; revisions preserve both immutable evidence files', async () => {
  const a = await artifact({ to: '2026-11-02T04:00:00Z' });
  const b = await artifact({ from: '2026-11-02T02:00:00Z' });
  const { artifactHash: ignoredHash, ...reorderedBody } = structuredClone(a);
  reorderedBody.candles = reorderedBody.candles.map(c => Object.fromEntries(Object.entries(c).reverse()));
  const reordered = { ...reorderedBody, artifactHash: createHash('sha256').update(JSON.stringify(reorderedBody)).digest('hex') };
  assert.equal(mergeHistory([a, reordered]).manifest.canonicalContentHash, a.manifest.canonicalContentHash);
  const ab = mergeHistory([a, b]), ba = mergeHistory([b, a]);
  assert.equal(ab.manifest.canonicalContentHash, ba.manifest.canonicalContentHash);
  assert.equal(ab.candles.length, 6);
  const revised = await artifact({}, { mutate: d => { for (const p of d.prices) for (const k of ['openPrice', 'highPrice', 'lowPrice', 'closePrice']) { p[k].bid += .001; p[k].ask += .001; } return d; } });
  assert.notEqual(revised.manifest.datasetId, ab.manifest.datasetId);
  assert.throws(() => mergeHistory([ab, revised]), e => e.message === 'CONFLICTING_OVERLAP' && e.timestamps.length === 6);
  const dir = await mkdtemp(join(tmpdir(), 'orion-revisions-'));
  await saveHistory(join(dir, 'original.json'), ab); await saveHistory(join(dir, 'revision.json'), revised);
  const lines = [];
  assert.equal(await run(['history:revisions', '--left', join(dir, 'original.json'), '--right', join(dir, 'revision.json')], { env: {}, fetchImpl: () => assert.fail('network'), output: s => lines.push(JSON.parse(s)), errorOutput: () => {} }), 0);
  assert.equal(lines[0].conflictingTimestamps.length, 6);
});

test('partial acquisition resumes without skipping pending windows or repeating committed windows', async () => {
  const { directory } = await job({ retries: 0 });
  await assert.rejects(resume(directory, broker({ fault: n => n === 2 ? new BrokerError('TIMEOUT') : null })));
  const b = broker(); await resume(directory, b);
  assert.deepEqual(b.calls.filter(x => typeof x === 'object').map(r => r.from), ['2026-11-02T02:00:00.000Z', '2026-11-02T04:00:00.000Z']);
});

test('filesystem failure leaves a RUNNING checkpoint recoverable without publishing partial data', async () => {
  const { root, directory, registry } = await job({ retries: 0 });
  const backup = join(root, 'renamed-job');
  await assert.rejects(resume(directory, broker({ onRequest: async () => { await rename(directory, backup); } })));
  await rename(backup, directory);
  assert.equal((await collectionStatus(directory)).windows[0].state, 'RUNNING');
  await assert.rejects(publishCollection(directory, registry));
  await resume(directory, broker());
  assert.equal((await publishCollection(directory, registry)).count, 6);
});

test('atomic publication survives missing final checkpoint and never overwrites registry content', async () => {
  const { directory, registry } = await job(); await resume(directory, broker());
  const status = await collectionStatus(directory), artifacts = [];
  for (const w of status.windows) artifacts.push(await readStoredJson(join(directory, `segment-${w.segment}.json`)));
  const config = await readStoredJson(join(directory, 'job.json'));
  const merged = mergeHistory(artifacts, { requestedPeriod: config.requestedPeriod, acquiredAt: artifacts.map(a => a.acquisition.acquiredAt).sort().at(-1) });
  const path = join(registry, `${merged.manifest.datasetId}.json`);
  await saveHistory(path, merged); // Simulate process exit between final link and job checkpoint.
  const bytes = await readFile(path, 'utf8');
  assert.equal((await publishCollection(directory, registry)).datasetId, merged.manifest.datasetId);
  assert.equal(await readFile(path, 'utf8'), bytes);
  await assert.rejects(saveHistory(path, merged), { code: 'EEXIST' });
});

test('corrupt staging/config, missing checkpoints, modified candles and wrong identity fail offline', async () => {
  const { directory, registry } = await job();
  await assert.rejects(resumeCollection(directory, broker(), { expectedAccountId: 'wrong' }), /ACCOUNT_MISMATCH/);
  await resume(directory, broker());
  const status = await collectionStatus(directory), segment = join(directory, `segment-${status.windows[0].segment}.json`);
  const a = await readStoredJson(segment); a.candles[0].close += .0001;
  await writeFile(segment, JSON.stringify(a));
  await assert.rejects(collectionStatus(directory, { verify: true }), /INTEGRITY/);
  await assert.rejects(publishCollection(directory, registry));
  const config = await readStoredJson(join(directory, 'job.json')); config.instrument = 'GBP/USD';
  await writeFile(join(directory, 'job.json'), JSON.stringify(config));
  await assert.rejects(collectionStatus(directory), /INTEGRITY/);
  const j = await job(); await resume(j.directory, broker());
  await rename(join(j.directory, 'checkpoint-000001.json'), join(j.directory, 'saved-evidence.json'));
  await assert.rejects(collectionStatus(j.directory), /SEQUENCE_GAP/);
});

test('epic changes across windows are rejected and account mismatch prevents CLI authentication', async () => {
  const { directory } = await job({ retries: 0 });
  await assert.rejects(resume(directory, broker({ fault: n => n === 2 ? new BrokerError('TIMEOUT') : null })));
  await assert.rejects(resume(directory, broker({ epic: 'other-epic' })));
  assert.equal(await run(['history:job:resume', '--job', directory], { env: { CAPITAL_EXPECTED_ACCOUNT_ID: 'wrong' }, fetchImpl: () => assert.fail('network forbidden'), output: () => {}, errorOutput: () => {} }), 1);
});

test('error metadata contains no raw broker secrets; checkpoints and segments use private files', async () => {
  const { directory } = await job({ retries: 0 });
  await assert.rejects(resume(directory, broker({ fault: () => new Error('secret-token password API_KEY https://secret.example') })));
  const files = await readdir(directory);
  for (const name of files.filter(n => n.endsWith('.json'))) {
    const text = await readFile(join(directory, name), 'utf8');
    assert.ok(!text.includes('secret-token')); assert.ok(!text.includes(account)); assert.ok(!text.includes('secret.example'));
  }
});

test('real child-process SIGKILL while second window is in flight resumes only unfinished windows', async t => {
  const { directory } = await job({ retries: 0 });
  const child = fork(fileURLToPath(new URL('./fixtures/collection-child.js', import.meta.url)), [directory], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exit = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit; } });
  const ready = await Promise.race([once(child, 'message'), exit.then(([code]) => { throw new Error(`child exited ${code}`); })]);
  assert.equal(ready[0], 'in-flight'); child.kill('SIGKILL'); await exit;
  const status = await collectionStatus(directory);
  assert.equal(status.windows[0].state, 'ACQUIRED'); assert.equal(status.windows[1].state, 'RUNNING');
  const b = broker(); await resume(directory, b);
  assert.equal(b.calls.filter(x => typeof x === 'object').length, 2);
});

test('registry detects revisions, requires explicit existing parent, and preserves both immutable versions', async () => {
  const { inspectRegistry } = await import('../market-data/collection.js');
  const first = await job(); await resume(first.directory, broker());
  const original = await publishCollection(first.directory, first.registry);
  const second = join(first.root, 'revision-job');
  await createCollection(second, { from, to, expectedAccountId: account, windowHours: 2 });
  await resume(second, broker({ mutate: d => { for (const p of d.prices) for (const k of ['openPrice', 'highPrice', 'lowPrice', 'closePrice']) { p[k].bid += .001; p[k].ask += .001; } return d; } }));
  await assert.rejects(publishCollection(second, first.registry), /CONFLICTING_OVERLAP/);
  const revised = await publishCollection(second, first.registry, { parentDatasetIds: [original.datasetId] });
  assert.notEqual(revised.datasetId, original.datasetId);
  const catalog = await inspectRegistry(first.registry);
  assert.equal(catalog.datasets.length, 2); assert.equal(catalog.conflicts[0].timestamps.length, 6);
  assert.deepEqual(catalog.datasets.find(d => d.datasetId === revised.datasetId).registry.parentDatasetIds, [original.datasetId]);
  assert.equal((await publishCollection(second, first.registry)).datasetId, revised.datasetId);
  const bogus = await job(); await resume(bogus.directory, broker());
  await assert.rejects(publishCollection(bogus.directory, bogus.registry, { parentDatasetIds: [`sha256-${'0'.repeat(64)}`] }), /PARENT_DATASET_NOT_FOUND/);
});

test('publication lock rejects concurrent writers and releases after failure', async () => {
  const { withHistoryPublicationLock } = await import('../market-data/capital-history.js');
  const { directory, registry } = await job(); await resume(directory, broker());
  await withHistoryPublicationLock(registry, async () => {
    await assert.rejects(publishCollection(directory, registry), /locked/);
    await assert.rejects(publishCollection(directory, registry), /locked/);
  });
  await assert.rejects(withHistoryPublicationLock(registry, async () => { throw new Error('injected failure'); }), /injected/);
  assert.equal((await publishCollection(directory, registry)).count, 6);
});

test('verified published data feeds indicators, optimizer, replay and reporting without consuming holdout', async () => {
  const { createResearchSession } = await import('../optimization/session.js');
  const { evaluateWalkForward } = await import('../optimization/research.js');
  const { sma } = await import('../indicators/index.js');
  const { enrich } = await import('../reporting/index.js');
  const { directory, registry } = await job({ to: '2026-11-06T04:00:00Z', windowHours: 25 });
  await resume(directory, broker());
  const published = await publishCollection(directory, registry), data = await importDataset(published.path);
  assert.equal(sma(data.candles.map(c => c.close), 5).length, 100);
  const config = { dataValidation: { calendarMode: 'calendar-v1', calendar: data.manifest.calendar } };
  const research = createResearchSession(data.candles, { config });
  const selection = research.optimize([{ id: 'trend' }, { id: 'mean-reversion' }], { useValidation: true });
  assert.equal(research.status().holdoutConsumptionCount, 0);
  const changedHoldout = structuredClone(data.candles);
  for (let i = 80; i < changedHoldout.length; i++) {
    for (const k of ['open', 'high', 'low', 'close']) changedHoldout[i][k] *= 1.1;
    for (const side of ['bid', 'ask']) for (const k of ['open', 'high', 'low', 'close']) changedHoldout[i].quoteBars[side][k] *= 1.1;
  }
  const alternate = createResearchSession(changedHoldout, { config });
  assert.deepEqual(alternate.optimize([{ id: 'trend' }, { id: 'mean-reversion' }], { useValidation: true }), selection);
  assert.equal(alternate.status().holdoutConsumptionCount, 0);
  assert.equal(evaluateWalkForward(data.candles.slice(0, 80), [{ id: 'trend' }], { trainSize: 40, testSize: 20 }, config).length, 2);
  const lengths = [];
  const report = enrich(backtest(data.candles, { ...config, strategy: { id: 'prefix-observer', version: '1', signal: prefix => { lengths.push(prefix.length); return { action: 'hold' }; } } }));
  assert.ok(lengths.every((n, i) => n === i + 1)); assert.equal(report.dataset.count, 100);
  const lines = [];
  assert.equal(await run(['paper:replay', '--input', published.path, '--strategy', 'no-trade'], { env: {}, fetchImpl: () => assert.fail('network'), output: s => lines.push(s), errorOutput: s => lines.push(s) }), 0, lines.join());
});

test('publication lock is released by actual child-process termination', async t => {
  const { directory, registry } = await job(); await resume(directory, broker());
  const child = fork(fileURLToPath(new URL('./fixtures/collection-child.js', import.meta.url)), [registry, 'lock'], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exit = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit; } });
  const [message] = await Promise.race([once(child, 'message'), exit.then(([code]) => { throw new Error(`child exited ${code}`); })]);
  assert.equal(message, 'locked');
  await assert.rejects(publishCollection(directory, registry), /locked/);
  child.kill('SIGKILL'); await exit;
  assert.equal((await publishCollection(directory, registry)).count, 6);
});
