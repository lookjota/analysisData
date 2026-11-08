import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, DEMO_URL } from '../config/index.js';
import { CapitalDemoBroker } from '../brokers/capital-demo.js';
import { assertReadOnlyRequest, evaluateOrder } from '../risk/index.js';
import { spread, readQuote, readHourlyCandles } from '../market-data/index.js';
import { run } from '../cli/index.js';

const env = { CAPITAL_API_KEY: 'fake-key-secret', CAPITAL_IDENTIFIER: 'fake-login-secret',
  CAPITAL_API_PASSWORD: 'fake-password-secret', TRADING_ENABLED: 'false' };
const tokens = { CST: 'fake-cst-secret', 'X-SECURITY-TOKEN': 'fake-security-secret' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const login = () => json({}, 200, tokens);
const markets = { markets: [
  { epic: 'EURUSD', symbol: 'EUR/USD', instrumentType: 'CURRENCIES' },
  { epic: 'EURUSD_OTHER', symbol: 'EUR/USD other', instrumentType: 'CURRENCIES' },
] };
const pair = { bid: 1.08, ask: 1.0802 };
const prices = { prices: [{ snapshotTimeUTC: '2026-11-05T10:00:00', openPrice: pair,
  highPrice: pair, lowPrice: pair, closePrice: pair }] };

function fixture(responses, overrides = {}) {
  const calls = [];
  const broker = new CapitalDemoBroker(loadConfig({ ...env, ...overrides }), { fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), ...options });
    assert.ok(responses.length, 'unexpected request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  } });
  return { broker, calls };
}

test('configuration defaults to Demo and does not serialize credentials', () => {
  const config = loadConfig(env);
  assert.equal(config.baseUrl, DEMO_URL);
  assert.equal(config.tradingEnabled, false);
  assert.ok(Object.isFrozen(config));
  for (const secret of Object.values(env).filter(v => v.includes('secret'))) {
    assert.ok(!JSON.stringify(config).includes(secret));
  }
  assert.throws(() => loadConfig({}), /MISSING_CREDENTIAL/);
  assert.throws(() => loadConfig({ ...env, CAPITAL_API_KEY: 'replace_with_demo_api_key' }));
  for (const value of ['0', '-1', 'NaN', '60001', '1.2']) {
    assert.throws(() => loadConfig({ ...env, CAPITAL_TIMEOUT_MS: value }), /INVALID_TIMEOUT/);
  }
});

test('Live, alternative hosts, URL credentials and trading flags fail closed', () => {
  for (const value of ['live', 'LIVE', 'production', '']) {
    assert.throws(() => loadConfig({ ...env, CAPITAL_ENV: value }), /DEMO_ONLY/);
  }
  for (const value of ['https://api-capital.backend-capital.com', `${DEMO_URL}.evil.test`,
    'http://demo-api-capital.backend-capital.com', `${DEMO_URL}/`,
    'https://user:password@demo-api-capital.backend-capital.com']) {
    assert.throws(() => loadConfig({ ...env, CAPITAL_BASE_URL: value }), /DEMO_ONLY/);
  }
  for (const key of ['TRADING_ENABLED', 'LIVE_TRADING_ENABLED', 'ORDER_EXECUTION_ENABLED']) {
    assert.throws(() => loadConfig({ ...env, [key]: 'true' }), /TRADING_DISABLED/);
  }
  assert.throws(() => new CapitalDemoBroker({ ...loadConfig(env), baseUrl: 'https://example.org' }), /DEMO_ONLY/);
});

test('orders, account mutation, traversal and arbitrary requests are blocked', () => {
  for (const path of ['/positions', '/workingorders', '/accounts/topUp', '/session',
    '/markets/../positions', '/markets/EURUSD?redirect=evil', '//example.org']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      if (path === '/session' && ['POST', 'DELETE', 'GET'].includes(method)) continue;
      assert.throws(() => assertReadOnlyRequest(method, path), /ENDPOINT_BLOCKED/);
    }
  }
  assert.equal(evaluateOrder({ side: 'buy' }).allowed, false);
});

test('auth uses custom API password, private tokens, Demo URL and safe logout', async () => {
  const { broker, calls } = fixture([login(), json({ accounts: [{ accountId: 'demo-1', accountType: 'CFD', currency: 'USD' }] }), json({})]);
  await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
  assert.deepEqual(await broker.authenticate(), { authenticated: true, environment: 'demo', tradingEnabled: false });
  await assert.rejects(broker.authenticate(), /SESSION_ALREADY_ACTIVE/);
  assert.equal((await broker.accounts())[0].accountId, 'demo-1');
  await broker.close();
  await broker.close();
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[0].body), { identifier: env.CAPITAL_IDENTIFIER,
    password: env.CAPITAL_API_PASSWORD, encryptedPassword: false });
  assert.equal(calls[0].headers['X-CAP-API-KEY'], env.CAPITAL_API_KEY);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url.pathname, '/api/v1/session');
  assert.equal(calls[0].url.search, '');
  assert.deepEqual(calls[0].headers, { Accept: 'application/json',
    'X-CAP-API-KEY': env.CAPITAL_API_KEY, 'Content-Type': 'application/json' });
  assert.equal(calls[1].headers.CST, tokens.CST);
  assert.equal(calls[1].headers['X-SECURITY-TOKEN'], tokens['X-SECURITY-TOKEN']);
  assert.equal(calls[2].method, 'DELETE');
  for (const call of calls) {
    assert.equal(call.url.origin, DEMO_URL);
    assert.equal(call.redirect, 'error');
  }
  assert.equal(JSON.stringify(broker), '{}');
  await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
});

test('missing authentication headers are rejected', async () => {
  const { broker } = fixture([json({})]);
  await assert.rejects(broker.authenticate(), /INVALID_SESSION/);
  await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
});

test('initial 401 is authentication failure, sanitized, without retry or logout', async () => {
  const lines = [];
  const calls = [];
  const result = await run(['auth'], { env,
    output: line => lines.push(line), errorOutput: line => lines.push(line),
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return json({ errorCode: 'error.invalid.details',
        detail: [...Object.values(env), ...Object.values(tokens)].join(' ') }, 401);
    },
  });
  assert.equal(result, 1);
  assert.deepEqual(lines, ['Capital Demo: AUTHENTICATION_FAILED (HTTP 401)']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
});

test('failed login permits explicit retry; expired session requires fresh login', async () => {
  const { broker, calls } = fixture([new Response('untrusted non-JSON body', { status: 401 }),
    login(), json({}, 401), login(), json({ accounts: [] })]);
  await assert.rejects(broker.authenticate(), error =>
    error.code === 'AUTHENTICATION_FAILED' && error.status === 401);
  await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
  assert.equal(calls.length, 1);
  await broker.authenticate();
  await assert.rejects(broker.accounts(), error =>
    error.code === 'SESSION_EXPIRED' && error.status === 401);
  await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
  await broker.authenticate();
  assert.deepEqual(await broker.accounts(), []);
  assert.equal(calls.length, 5);
  assert.equal(calls[3].headers.CST, undefined);
  assert.equal(calls[3].headers['X-SECURITY-TOKEN'], undefined);
});

test('EUR/USD discovery chooses only exact currency pair and rejects ambiguity', async () => {
  const { broker, calls } = fixture([login(), json(markets), json({ markets: [] }),
    json({ markets: [markets.markets[0], { ...markets.markets[0], epic: 'SECOND' }] })]);
  await broker.authenticate();
  assert.deepEqual(await broker.findEurUsd(), { epic: 'EURUSD', symbol: 'EUR/USD' });
  assert.equal(calls[1].url.searchParams.get('searchTerm'), 'EUR/USD');
  await assert.rejects(broker.findEurUsd(), /INSTRUMENT_NOT_FOUND/);
  await assert.rejects(broker.findEurUsd(), /AMBIGUOUS_INSTRUMENT/);
});

test('quote maps offer to ask and calculates EUR/USD spread in pips', async () => {
  const { broker } = fixture([login(), json({ instrument: { epic: 'EURUSD' },
    snapshot: { bid: 1.08, offer: 1.0802, marketStatus: 'TRADEABLE' } })]);
  await broker.authenticate();
  const quote = await readQuote(broker, 'EURUSD');
  assert.equal(quote.ask, 1.0802);
  assert.equal(quote.spread, 0.0002);
  assert.equal(quote.spreadPips, 2);
  assert.equal(spread(1, 1).spreadPips, 0);
  for (const [bid, ask] of [[2, 1], [null, 2], [1, NaN], [0, 1], ['1', 2]]) {
    assert.throws(() => spread(bid, ask), /INVALID_QUOTE/);
  }
});

test('hourly candles request HOUR, preserve bid/ask and normalize UTC', async () => {
  const { broker, calls } = fixture([login(), json(prices)]);
  await broker.authenticate();
  const candles = await readHourlyCandles(broker, 'EURUSD', 48);
  assert.equal(calls[1].url.pathname, '/api/v1/prices/EURUSD');
  assert.equal(calls[1].url.searchParams.get('resolution'), 'HOUR');
  assert.equal(calls[1].url.searchParams.get('max'), '48');
  assert.equal(candles[0].time, '2026-11-05T10:00:00.000Z');
  assert.equal(candles[0].close.ask, pair.ask);
  for (const max of [0, 1001, 1.5]) assert.throws(() => broker.candles('EURUSD', max));
});

test('invalid payloads and candle timestamps are rejected', async () => {
  const { broker } = fixture([login(), json({}), json({ prices: [{ ...prices.prices[0], snapshotTimeUTC: 'bad' }] }), json({})]);
  await broker.authenticate();
  await assert.rejects(readHourlyCandles(broker, 'EURUSD'), /INVALID_CANDLES/);
  await assert.rejects(readHourlyCandles(broker, 'EURUSD'), /INVALID_CANDLE_TIME/);
  await assert.rejects(readQuote(broker, 'EURUSD'), /INVALID_MARKET_RESPONSE/);
});

for (const [status, code] of [[401, 'SESSION_EXPIRED'], [429, 'RATE_LIMITED'], [500, 'BROKER_UNAVAILABLE'], [503, 'BROKER_UNAVAILABLE'], [403, 'HTTP_ERROR'], [302, 'HTTP_ERROR']]) {
  test(`HTTP ${status} is sanitized and never retried or redirected`, async () => {
    const { broker, calls } = fixture([login(), json({ secret: env.CAPITAL_API_PASSWORD }, status)]);
    await broker.authenticate();
    await assert.rejects(broker.accounts(), error => error.code === code && error.status === status && !error.message.includes('secret'));
    assert.equal(calls.length, 2);
    if (status === 401) await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
  });
}

test('request timeout aborts fetch with sanitized error', async () => {
  const broker = new CapitalDemoBroker(loadConfig({ ...env, CAPITAL_TIMEOUT_MS: '5' }), {
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error(env.CAPITAL_API_PASSWORD)), { once: true });
    }),
  });
  await assert.rejects(broker.authenticate(), error => error.code === 'TIMEOUT');
});

test('failed remote logout still clears local tokens', async () => {
  const { broker, calls } = fixture([login(), json({}, 503)]);
  await broker.authenticate();
  await assert.rejects(broker.close(), /BROKER_UNAVAILABLE/);
  await broker.close();
  await assert.rejects(broker.accounts(), /SESSION_REQUIRED/);
  assert.equal(calls.length, 2);
});

test('CLI has no credential or token leaks on success, network failure or HTTP errors', async () => {
  const lines = [];
  for (const responses of [[login(), json({})], [new Error(Object.values(env).join(' '))],
    [login(), json({ error: Object.values(tokens).join(' ') }, 500), json({})]]) {
    await run([responses.length === 3 ? 'accounts' : 'auth'], { env,
      output: line => lines.push(line), errorOutput: line => lines.push(line),
      fetchImpl: async () => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        assert.ok(response);
        return response;
      } });
  }
  const serialized = lines.join('\n');
  for (const secret of [...Object.values(env), ...Object.values(tokens)].filter(value => value !== 'false')) {
    assert.ok(!serialized.includes(secret));
  }
  assert.match(serialized, /NETWORK_ERROR/);
  assert.match(serialized, /BROKER_UNAVAILABLE/);
});

test('CLI closes session on data failure and status requires no credentials or network', async () => {
  const calls = [];
  const output = [];
  assert.equal(await run(['quote'], { env, output: x => output.push(x), errorOutput: x => output.push(x),
    fetchImpl: async (_url, options) => {
      calls.push(options.method);
      return calls.length === 1 ? login() : calls.length === 2 ? json({ markets: [] }) : json({});
    } }), 1);
  assert.deepEqual(calls, ['POST', 'GET', 'DELETE']);
  assert.equal(await run(['status'], { env: {}, output: x => output.push(x), fetchImpl: () => assert.fail('network forbidden') }), 0);
  assert.equal(await run(['candles', '1001'], { env, errorOutput: () => {}, fetchImpl: () => assert.fail('network forbidden') }), 1);
  assert.equal(await run(['order'], { env, errorOutput: () => {}, fetchImpl: () => assert.fail('network forbidden') }), 1);
});
