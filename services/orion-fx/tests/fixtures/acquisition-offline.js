import assert from 'node:assert/strict';
import { DEMO_URL } from '../../config/index.js';

export const fixtureEnv = { CAPITAL_API_KEY: 'fixture-key', CAPITAL_IDENTIFIER: 'fixture-user', CAPITAL_API_PASSWORD: 'fixture-password', CAPITAL_EXPECTED_ACCOUNT_ID: 'fixture-account' };
export const from = '2026-11-02T10:00:00.000Z', to = '2026-11-02T12:00:00.000Z', asOf = '2026-11-02T12:05:00.000Z';
export const price = time => ({ snapshotTimeUTC: time.slice(0, 19), snapshotTime: time.slice(0, 19),
  openPrice: { bid: 1.1, ask: 1.1002 }, highPrice: { bid: 1.101, ask: 1.1012 },
  lowPrice: { bid: 1.099, ask: 1.0992 }, closePrice: { bid: 1.1, ask: 1.1002 }, lastTradedVolume: 20 });
export function offlineTransport(scenario = 'success', suppliedPrices) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const u = new URL(url);
    assert.equal(u.origin, DEMO_URL);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const route = u.pathname;
    calls.push({ method: options.method, path: route });
    const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
    if (route === '/api/v1/session') {
      if (options.method === 'POST') return json({}, 200, { CST: 'fixture-cst', 'X-SECURITY-TOKEN': 'fixture-token' });
      if (options.method === 'DELETE') return json({});
      return json({ accountId: fixtureEnv.CAPITAL_EXPECTED_ACCOUNT_ID });
    }
    if (route === '/api/v1/markets') return json({ markets: [{ epic: 'EURUSD', symbol: scenario === 'instrument' ? 'GBP/USD' : 'EUR/USD', instrumentType: 'CURRENCIES' }] });
    assert.equal(route, '/api/v1/prices/EURUSD');
    assert.equal(options.method, 'GET');
    assert.equal(u.searchParams.get('resolution'), 'HOUR');
    if (scenario === 'throttle') return json({ secret: 'never log upstream' }, 429);
    if (scenario === 'expired') return json({}, 401);
    if (scenario === 'interrupted') throw new Error('fixture-password upstream interruption');
    if (scenario === 'malformed') return new Response('{');
    const prices = suppliedPrices ? structuredClone(suppliedPrices) : [price(from), price('2026-11-02T11:00:00.000Z')];
    if (scenario === 'duplicate') prices[1] = structuredClone(prices[0]);
    if (scenario === 'boundary') prices[1].snapshotTimeUTC = '2026-11-02T12:00:00';
    if (scenario === 'crossed') prices[0].openPrice.bid = 1.1003;
    if (scenario === 'corrected') prices[0].closePrice.bid = 1.10001;
    if (scenario === 'secret') prices[0].secret = 'fixture-password';
    const response = json({ resolution: scenario === 'resolution' ? 'MINUTE' : 'HOUR', prices: ['missing', 'empty'].includes(scenario) ? (scenario === 'empty' ? [] : prices.slice(1)) : prices });
    if (scenario === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    if (scenario === 'host') Object.defineProperty(response, 'url', { value: 'https://unexpected.invalid/api/v1/prices/EURUSD' });
    return response;
  };
  return { fetchImpl, calls };
}
