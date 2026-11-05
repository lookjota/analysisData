export const DEMO_URL = 'https://demo-api-capital.backend-capital.com';

export function loadConfig(env = process.env, { credentials = true } = {}) {
  if ((env.CAPITAL_ENV ?? 'demo') !== 'demo' ||
      (env.CAPITAL_BASE_URL ?? DEMO_URL) !== DEMO_URL) {
    throw new Error('DEMO_ONLY: ambiente ou URL proibidos');
  }
  if ((env.TRADING_ENABLED ?? 'false') !== 'false' ||
      ['LIVE_TRADING_ENABLED', 'ORDER_EXECUTION_ENABLED'].some(key =>
        env[key] !== undefined && env[key] !== 'false')) {
    throw new Error('TRADING_DISABLED: execução proibida');
  }
  const timeoutMs = Number(env.CAPITAL_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new Error('INVALID_TIMEOUT: use 1 a 60000 ms');
  }
  const secrets = {};
  for (const key of ['CAPITAL_API_KEY', 'CAPITAL_IDENTIFIER', 'CAPITAL_API_PASSWORD']) {
    const value = env[key];
    if (credentials && (typeof value !== 'string' || !value.trim() ||
        /[\r\n]/.test(value) || value.startsWith('replace_with_'))) {
      throw new Error(`MISSING_CREDENTIAL: configure ${key} no .env local`);
    }
    secrets[key] = value;
  }
  // Secrets are non-enumerable so routine serialization cannot disclose them.
  return Object.freeze(Object.defineProperties({
    baseUrl: DEMO_URL, environment: 'demo', tradingEnabled: false, timeoutMs,
  }, Object.fromEntries(Object.entries(secrets).map(([key, value]) =>
    [key, { value, enumerable: false }]))));
}
