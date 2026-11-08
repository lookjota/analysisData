import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../cli/index.js';
import { DEMO_URL } from '../config/index.js';

const env = { CAPITAL_ENV: 'demo', TRADING_ENABLED: 'false',
  CAPITAL_API_KEY: 'test-api-secret', CAPITAL_IDENTIFIER: 'test-user-secret',
  CAPITAL_API_PASSWORD: 'test-password-secret' };
const tokens = { CST: 'test-cst-secret', 'X-SECURITY-TOKEN': 'test-token-secret' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

async function list(payload, status = 200) {
  const calls = [], output = [], errors = [];
  const responses = [json({}, 200, tokens), json(payload, status), json({})];
  const code = await run(['accounts:list'], { env,
    output: line => output.push(line), errorOutput: line => errors.push(line),
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), ...options });
      assert.ok(responses.length, 'unexpected request');
      return responses.shift();
    } });
  return { code, calls, output, errors };
}

test('accounts:list reuses Demo session and displays only the five account fields', async () => {
  const accounts = [true, false].map((preferred, i) => ({ accountId: `demo-${i}`,
    accountName: `Demo ${i}`, accountType: 'CFD', currency: 'USD', preferred }));
  const result = await list({ accounts: accounts.map(account => ({ ...account,
    status: 'ENABLED', balance: { balance: 10000 }, extra: 'private-data' })) });
  assert.equal(result.code, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(JSON.parse(result.output.join('')), accounts);
  assert.deepEqual(result.calls.map(call => [call.method, call.url.pathname]), [
    ['POST', '/api/v1/session'], ['GET', '/api/v1/accounts'], ['DELETE', '/api/v1/session'],
  ]);
  for (const call of result.calls) {
    assert.equal(call.url.origin, DEMO_URL);
    assert.equal(call.url.search, '');
    assert.equal(call.redirect, 'error');
  }
  assert.equal(result.calls[1].body, undefined);
  assert.equal(result.calls[1].headers.CST, tokens.CST);
  assert.equal(result.calls[1].headers['X-SECURITY-TOKEN'], tokens['X-SECURITY-TOKEN']);
  for (const secret of [...Object.values(tokens), env.CAPITAL_API_KEY,
    env.CAPITAL_IDENTIFIER, env.CAPITAL_API_PASSWORD]) {
    assert.ok(![...result.output, ...result.errors].join('').includes(secret));
  }
});

test('accounts:list handles empty accounts and fails safely on malformed or unsafe responses', async () => {
  const empty = await list({ accounts: [] });
  assert.equal(empty.code, 0);
  assert.deepEqual(JSON.parse(empty.output[0]), []);
  for (const payload of [{}, { accounts: [{ accountName: tokens.CST }] }]) {
    const result = await list(payload);
    assert.equal(result.code, 1);
    assert.deepEqual(result.output, []);
    assert.equal(result.calls.at(-1).method, 'DELETE');
    assert.ok(!result.errors.join('').includes(tokens.CST));
  }
  const failed = await list({ error: env.CAPITAL_API_PASSWORD }, 500);
  assert.equal(failed.code, 1);
  assert.deepEqual(failed.output, []);
  assert.match(failed.errors[0], /BROKER_UNAVAILABLE/);
  assert.ok(!failed.errors.join('').includes(env.CAPITAL_API_PASSWORD));
  assert.equal(failed.calls.at(-1).method, 'DELETE');
});

test('accounts:list rejects Live, trading enablement and extra arguments before network access', async () => {
  for (const overrides of [{ CAPITAL_ENV: 'live' }, { TRADING_ENABLED: 'true' },
    { CAPITAL_BASE_URL: 'https://api-capital.backend-capital.com' }]) {
    assert.equal(await run(['accounts:list'], { env: { ...env, ...overrides },
      errorOutput: () => {}, fetchImpl: () => assert.fail('network forbidden') }), 1);
  }
  assert.equal(await run(['accounts:list', 'extra'], { env, errorOutput: () => {},
    fetchImpl: () => assert.fail('network forbidden') }), 1);
});
