import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, readFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireHistory, parseHistoricalPrice, historyRange, saveHistory, importDataset, verifyHistory } from '../market-data/capital-history.js';
import { CapitalDemoBroker } from '../brokers/capital-demo.js';
import { loadConfig } from '../config/index.js';
import { run } from '../cli/index.js';
import { backtest } from '../backtesting/index.js';
import { createStrategy } from '../strategies/research.js';

const env = { CAPITAL_API_KEY: 'fake-key-secret', CAPITAL_IDENTIFIER: 'fake-identifier-secret', CAPITAL_API_PASSWORD: 'fake-password-secret', CAPITAL_EXPECTED_ACCOUNT_ID: 'demo-test' };
const tokens = { CST: 'fake-cst-secret', 'X-SECURITY-TOKEN': 'fake-token-secret' };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const price = time => ({ snapshotTimeUTC: time.replace('.000Z', ''), snapshotTime: time.replace('.000Z', ''),
  openPrice: { bid: 1.1, ask: 1.1002 }, closePrice: { bid: 1.1, ask: 1.1002 },
  highPrice: { bid: 1.101, ask: 1.1012 }, lowPrice: { bid: 1.099, ask: 1.0992 }, lastTradedVolume: 20 });
const start = '2026-11-02T00:00:00.000Z';
const end = '2026-11-02T03:00:00.000Z';
function fixture({ mutate = x => x, markets, accountId = 'demo-test' } = {}) {
  const calls = [];
  const broker = new CapitalDemoBroker(loadConfig(env), { fetchImpl: async (url, options) => {
    const u = new URL(url); calls.push({ u, ...options });
    assert.equal(u.origin, 'https://demo-api-capital.backend-capital.com');
    if (options.method === 'POST') return json({}, 200, tokens);
    if (options.method === 'DELETE') return json({});
    if (u.pathname.endsWith('/session')) return json({ accountId });
    if (u.pathname.endsWith('/markets')) return json({ markets: markets ?? [{ epic: 'verified-pair', symbol: 'EUR/USD', instrumentType: 'CURRENCIES', instrumentName: 'EUR/USD', expiry: '-' }] });
    const from = Date.parse(u.searchParams.get('from') + 'Z'), to = Date.parse(u.searchParams.get('to') + 'Z');
    const prices = [];
    for (let t = from; t <= to; t += 3600000) prices.push(price(new Date(t).toISOString()));
    return json(mutate({ prices }));
  } });
  return { broker, calls };
}
async function acquire(options = {}, overrides = {}) {
  const f = fixture(overrides);
  await f.broker.authenticate();
  return { artifact: await acquireHistory(f.broker, { from: start, to: end, asOf: '2026-11-08T00:00:00Z', expectedAccountId: 'demo-test', sleep: async () => {}, ...options }), ...f };
}

test('historical acquisition uses verified epic, preserves metadata/UTC/quotes and canonical provenance', async () => {
  const { artifact, calls, broker } = await acquire();
  assert.equal(artifact.candles.length, 3);
  assert.equal(artifact.candles[0].synthetic, false);
  assert.equal(artifact.candles[0].timestamp, start);
  assert.equal(artifact.acquisition.epic, 'verified-pair');
  assert.equal(artifact.acquisition.instrument.expiry, '-');
  assert.equal(artifact.acquisition.sourceTimestamps[0].snapshotTimeUTC, '2026-11-02T00:00:00');
  assert.equal(artifact.manifest.requestedPeriod.end, end);
  assert.equal(artifact.manifest.coverage.recordCount, 3);
  assert.equal(artifact.manifest.canonicalContentHash, verifyHistory(artifact).contentHash);
  assert.equal(artifact.manifest.calendar.version, 'fx-ny17-v1');
  const request = calls.at(-1).u;
  assert.equal(request.searchParams.get('resolution'), 'HOUR');
  assert.equal(request.searchParams.get('max'), '3');
  assert.equal(request.searchParams.get('to'), '2026-11-02T02:00:00');
  const serialized = JSON.stringify(artifact);
  for (const secret of [...Object.values(env), ...Object.values(tokens)]) assert.ok(!serialized.includes(secret));
  await broker.close();
  assert.ok(calls.every(c => ['GET', 'DELETE'].includes(c.method) || c.u.pathname === '/api/v1/session'));
});

test('conservative chunking caps each request at 1000 values and paces every read', async () => {
  let sleeps = 0;
  const { artifact, calls } = await acquire({ from: '2026-09-01T00:00:00Z', to: '2026-10-20T00:00:00Z', sleep: async ms => { assert.equal(ms, 200); sleeps++; } });
  const requests = calls.filter(c => c.u.pathname.includes('/prices/'));
  assert.deepEqual(requests.map(c => Number(c.u.searchParams.get('max'))), [1000, 176]);
  assert.equal(sleeps, 4);
  assert.equal(artifact.candles.length, 1176);
});

for (const [name, mutate, code] of [
  ['interior missing', d => ({ prices: [d.prices[0], d.prices[2]] }), /DATA_QUALITY_REJECTED/],
  ['leading partial', d => ({ prices: d.prices.slice(1) }), /MISSING_REQUESTED_CANDLE/],
  ['trailing partial', d => ({ prices: d.prices.slice(0, -1) }), /MISSING_REQUESTED_CANDLE/],
  ['empty response', () => ({ prices: [] }), /INVALID_DATASET_SIZE/],
  ['missing prices', () => ({}), /INVALID_HISTORY_RESPONSE/],
  ['duplicate', d => ({ prices: [d.prices[0], d.prices[0], d.prices[2]] }), /DUPLICATE_TIMESTAMP/],
  ['out of order', d => ({ prices: d.prices.reverse() }), /UNORDERED_TIMESTAMP/],
  ['outside boundary', d => ({ prices: [price('2026-11-01T23:00:00.000Z'), ...d.prices.slice(1)] }), /OUTSIDE_REQUESTED_RANGE/],
  ['too many values', d => ({ prices: [...d.prices, d.prices[0]] }), /INVALID_HISTORY_RESPONSE/],
]) test(`historical response rejects ${name}`, async () => { await assert.rejects(acquire({}, { mutate }), code); });

test('bid/ask OHLC and aggregate spread integrity reject invalid prices', () => {
  for (const mutate of [p => { p.openPrice.bid = NaN; }, p => { p.lowPrice.ask = 2; },
    p => { p.closePrice.bid = 1.1003; }, p => { p.highPrice.bid = 1.1013; }, p => { delete p.openPrice; },
    p => { p.lastTradedVolume = -1; }]) {
    const p = price(start); mutate(p); assert.throws(() => parseHistoricalPrice(p));
  }
  for (const time of ['2026-02-30T00:00:00', '2026-11-02T00:30:00', '2026-11-02T00:00:00-03:00']) {
    assert.throws(() => parseHistoricalPrice({ ...price(start), snapshotTimeUTC: time }));
  }
});

test('explicit UTC ranges and complete candles are required before network use', async () => {
  for (const [from, to] of [[end, start], [start, start], ['2026-11-02T00:00:00-03:00', end], [start, '2099-01-01T00:00:00Z'], [start, '2026-11-02T01:30:00Z']]) assert.throws(() => historyRange(from, to));
  const output = [];
  assert.equal(await run(['history:download', '--from', start, '--to', end, '--out', '/tmp/must-not-write.json'], { env: { ...env, CAPITAL_EXPECTED_ACCOUNT_ID: '' }, fetchImpl: () => assert.fail('network'), output: x => output.push(x), errorOutput: x => output.push(x) }), 1);
});

test('unexpected account context is rejected before discovery/prices', async () => {
  await assert.rejects(acquire({}, { accountId: 'unexpected' }), /UNEXPECTED_ACCOUNT_CONTEXT/);
});

test('ambiguous EUR/USD discovery fails before prices', async () => {
  await assert.rejects(acquire({}, { markets: ['one', 'two'].map(epic => ({ epic, symbol: 'EUR/USD', instrumentType: 'CURRENCIES' })) }), /AMBIGUOUS_INSTRUMENT/);
});

test('DST weekend closure is accepted without fabricated bars; open edge gaps are rejected', async () => {
  const { artifact } = await acquire({ from: '2026-10-30T20:00:00Z', to: '2026-11-01T23:00:00Z' }, { mutate: d => ({ prices: d.prices.filter(p => ['2026-10-30T20:00:00', '2026-11-01T22:00:00'].includes(p.snapshotTimeUTC)) }) });
  assert.equal(artifact.candles.length, 2);
  assert.equal(artifact.acquisition.closedHours, 49);
});

test('offline artifact is atomic/exclusive/private, validates hashes, and feeds research and CLI', async () => {
  const { artifact } = await acquire();
  const dir = await mkdtemp(join(tmpdir(), 'orion-capital-'));
  const path = join(dir, 'history.json');
  await saveHistory(path, artifact);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(saveHistory(path, artifact), { code: 'EEXIST' });
  assert.deepEqual(await readdir(dir), ['history.json']);
  const d = await importDataset(path);
  assert.equal(d.contentHash, artifact.manifest.canonicalContentHash);
  assert.equal(d.temporal.provider, artifact.manifest.calendar.provider);
  assert.equal(backtest(d.candles, { strategy: createStrategy('trend'), dataValidation: { calendarMode: 'calendar-v1' } }).dataset.synthetic, false);
  const lines = [];
  for (const args of [['history:inspect', '--input', path], ['data:validate', '--input', path]]) {
    assert.equal(await run(args, { env: {}, fetchImpl: () => assert.fail('network forbidden'), output: x => lines.push(x), errorOutput: x => lines.push(x) }), 0);
  }
  const tampered = JSON.parse(await readFile(path, 'utf8')); tampered.acquisition.epic = 'other';
  assert.throws(() => verifyHistory(tampered), /INTEGRITY/);
  await symlink(path, join(dir, 'link.json'));
  await assert.rejects(importDataset(join(dir, 'link.json')));
  await assert.rejects(saveHistory(join(dir, 'link.json'), artifact));
  await symlink(dir, join(dir, 'parent'));
  await assert.rejects(saveHistory(join(dir, 'parent', 'new.json'), artifact));
  await assert.rejects(importDataset(join(dir, 'parent', 'history.json')));
});

for (const missing of ['CST', 'X-SECURITY-TOKEN']) test(`login rejects missing ${missing} without leaking credentials`, async () => {
  const headers = { ...tokens }; delete headers[missing];
  const broker = new CapitalDemoBroker(loadConfig(env), { fetchImpl: async () => json({}, 200, headers) });
  await assert.rejects(broker.authenticate(), /INVALID_SESSION/);
  await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
});

for (const reason of ['wrong custom password', 'rejected API key']) test(`${reason} is sanitized with no automatic retry`, async () => {
  let calls = 0; const lines = [];
  assert.equal(await run(['auth'], { env, output: x => lines.push(x), errorOutput: x => lines.push(x), fetchImpl: async () => { calls++; return json({ reason, ...env, ...tokens }, 401); } }), 1);
  assert.equal(calls, 1);
  assert.deepEqual(lines, ['Capital Demo: AUTHENTICATION_FAILED (HTTP 401)']);
});

test('broker rejects secret echoes in successful market metadata', async () => {
  await assert.rejects(acquire({}, { markets: [{ epic: 'EURUSD', symbol: 'EUR/USD', instrumentType: 'CURRENCIES', description: tokens.CST }] }), /UNSAFE_RESPONSE/);
});

test('conflicting instrument identity is rejected even when epic says EURUSD', async () => {
  await assert.rejects(acquire({}, { markets: [{ epic: 'EURUSD', symbol: 'GBP/USD', instrumentType: 'CURRENCIES' }] }), /INSTRUMENT_NOT_FOUND/);
});

test('offline real dataset feeds durable replay and report with its original manifest', async () => {
  const { runDurable } = await import('../cli/durable.js');
  const { artifact } = await acquire();
  const dir = await mkdtemp(join(tmpdir(), 'orion-capital-durable-'));
  const path = join(dir, 'history.json');
  await saveHistory(path, artifact);
  const lines = [], errors = [];
  for (const command of ['paper:durable:run', 'paper:durable:verify', 'paper:durable:recover', 'paper:durable:report']) {
    assert.equal(await runDurable([command, '--input', path, '--session', 'history', '--strategy', 'no-trade'], {
      rootDirectory: dir, output: x => lines.push(JSON.parse(x)), errorOutput: x => errors.push(x),
    }), 0, errors.join());
  }
  const report = lines.at(-1);
  assert.equal(report.dataset.synthetic, false);
  assert.equal(report.dataset.manifest.canonicalContentHash, artifact.manifest.canonicalContentHash);
  assert.deepEqual(report.dataset.manifest.requestedPeriod, artifact.manifest.requestedPeriod);
});

test('offline backtest retains acquisition provenance without credentials', async () => {
  const { artifact } = await acquire();
  const dir = await mkdtemp(join(tmpdir(), 'orion-capital-report-'));
  const path = join(dir, 'history.json');
  await saveHistory(path, artifact);
  const lines = [], errors = [];
  assert.equal(await run(['backtest', '--input', path, '--strategy', 'no-trade'], { env: {}, fetchImpl: () => assert.fail('network forbidden'), output: x => lines.push(JSON.parse(x)), errorOutput: x => errors.push(x) }), 0, errors.join());
  assert.equal(lines[0].dataset.manifest.manifestHash, artifact.manifest.manifestHash);
});

test('explicit CLI download publishes only a dataset, logs out, and refuses overwrite before login', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orion-capital-cli-'));
  const path = join(dir, 'history.json');
  const lines = [], errors = [], calls = [];
  const responses = [json({}, 200, tokens), json({ accountId: env.CAPITAL_EXPECTED_ACCOUNT_ID }),
    json({ markets: [{ epic: 'verified-pair', symbol: 'EUR/USD', instrumentType: 'CURRENCIES' }] }),
    json({ prices: [price(start), price('2026-11-02T01:00:00.000Z'), price('2026-11-02T02:00:00.000Z')] }), json({})];
  const args = ['history:download', '--from', start, '--to', end, '--out', path];
  assert.equal(await run(args, { env, output: x => lines.push(JSON.parse(x)), errorOutput: x => errors.push(x), fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), ...options }); assert.ok(responses.length); return responses.shift();
  } }), 0, errors.join());
  assert.equal(lines[0].saved, true);
  assert.equal(lines[0].count, 3);
  assert.deepEqual(calls.map(c => c.method), ['POST', 'GET', 'GET', 'GET', 'DELETE']);
  assert.deepEqual(await readdir(dir), ['history.json']);
  assert.equal((await importDataset(path)).synthetic, false);
  assert.equal(await run(args, { env, output: () => {}, errorOutput: () => {}, fetchImpl: () => assert.fail('overwrite must fail before login') }), 1);
});

test('historical broker method rejects request overflow without HTTP', () => {
  const { broker } = fixture();
  for (const max of [0, 1001, 1.5]) assert.throws(() => broker.historicalCandles('verified-pair', { from: start, to: end, max }), /INVALID_HISTORICAL_REQUEST/);
  assert.throws(() => broker.historicalCandles('verified-pair', { from: start, to: end, max: 2 }), /INVALID_HISTORICAL_REQUEST/);
});

test('existing CSV durable journal configuration remains recoverable', async () => {
  const { runDurable } = await import('../cli/durable.js');
  const { openStrategyReplay } = await import('../paper/strategy-durable.js');
  const { syntheticCandles } = await import('../data/fixtures/synthetic.js');
  const { exportCsv, writeExclusive, importCsv } = await import('../market-data/historical.js');
  const { mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'orion-capital-legacy-'));
  const path = join(dir, 'old.csv');
  await writeExclusive(path, exportCsv(syntheticCandles({ count: 3 })));
  const dataValidation = { calendarMode: 'calendar-v1', calendar: {}, gapPolicy: 'reject', maxRows: 1000 };
  const data = await importCsv(path, dataValidation);
  await mkdir(join(dir, 'runtime'));
  // Original CLI options, before this integration: preserve their journal identity.
  const replay = await openStrategyReplay({ directory: join(dir, 'runtime'), filename: 'legacy.sqlite', sessionId: 'legacy', rows: data.candles,
    options: { strategyId: 'no-trade', parameters: {}, initialCapital: 1000, risk: {}, costs: {}, dataValidation }, create: true });
  replay.run(); await replay.close();
  const errors = [];
  assert.equal(await runDurable(['paper:durable:recover', '--input', path, '--session', 'legacy', '--strategy', 'no-trade'], { rootDirectory: dir, output: () => {}, errorOutput: x => errors.push(x) }), 0, errors.join());
});
