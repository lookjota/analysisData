import { loadConfig, DEMO_URL } from '../config/index.js';
import { timestamp } from '../market-data/historical.js';
import { assertReadOnlyRequest } from '../risk/index.js';

export class BrokerError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'BrokerError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

export class CapitalDemoBroker {
  #config;
  #fetch;
  #tokens;
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    // Validate again at the adapter boundary, even for hand-crafted config objects.
    this.#config = loadConfig({
      CAPITAL_ENV: config.environment, CAPITAL_BASE_URL: config.baseUrl,
      TRADING_ENABLED: String(config.tradingEnabled), CAPITAL_TIMEOUT_MS: config.timeoutMs,
      CAPITAL_API_KEY: config.CAPITAL_API_KEY, CAPITAL_IDENTIFIER: config.CAPITAL_IDENTIFIER,
      CAPITAL_API_PASSWORD: config.CAPITAL_API_PASSWORD,
    });
    this.#fetch = fetchImpl;
  }

  async #request(method, path, { query, body } = {}) {
    assertReadOnlyRequest(method, path);
    const login = method === 'POST' && path === '/session';
    if (!login && !this.#tokens) throw new BrokerError('SESSION_REQUIRED');
    const url = new URL(`/api/v1${path}`, DEMO_URL);
    if (query) url.search = new URLSearchParams(query).toString();
    const headers = { Accept: 'application/json' };
    if (login) headers['X-CAP-API-KEY'] = this.#config.CAPITAL_API_KEY;
    else Object.assign(headers, this.#tokens);
    if (body) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        redirect: 'error', signal: controller.signal,
      });
      // Defense in depth for injected transports and unexpected redirect behavior.
      if (response.redirected || (response.url && new URL(response.url).href !== url.href)) {
        throw new BrokerError('UNEXPECTED_RESPONSE_ORIGIN');
      }
      if (!response.ok) {
        if (response.status === 401) this.#tokens = undefined;
        // A rejected login has no session to expire. HTTP 401 alone cannot
        // distinguish a wrong identifier/password from a disabled API key.
        const code = response.status === 401 ? (login ? 'AUTHENTICATION_FAILED' : 'SESSION_EXPIRED') :
          response.status === 429 ? 'RATE_LIMITED' :
          response.status >= 500 ? 'BROKER_UNAVAILABLE' : 'HTTP_ERROR';
        // Never include upstream response bodies, headers, URLs or exceptions.
        throw new BrokerError(code, response.status);
      }
      if (login) {
        const cst = response.headers.get('CST');
        const security = response.headers.get('X-SECURITY-TOKEN');
        if (!cst || !security) throw new BrokerError('INVALID_SESSION');
        this.#tokens = { CST: cst, 'X-SECURITY-TOKEN': security };
        return;
      }
      if (method === 'DELETE') return;
      try {
        const data = await response.json();
        const secrets = [this.#config.CAPITAL_API_KEY, this.#config.CAPITAL_IDENTIFIER,
          this.#config.CAPITAL_API_PASSWORD, ...Object.values(this.#tokens ?? {})];
        const unsafe = value => typeof value === 'string' ? secrets.some(secret => secret && value.includes(secret)) :
          value && typeof value === 'object' ? Object.entries(value).some(([key, child]) =>
            /^(?:password|api[_-]?key|identifier|cst|(?:x-)?security[_-]?token|authorization)$/i.test(key) || unsafe(key) || unsafe(child)) : false;
        if (unsafe(data)) throw new BrokerError('UNSAFE_RESPONSE');
        return data;
      }
      catch (error) { if (error instanceof BrokerError) throw error; throw new BrokerError(controller.signal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      throw new BrokerError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }

  async authenticate() {
    if (this.#tokens) throw new BrokerError('SESSION_ALREADY_ACTIVE');
    await this.#request('POST', '/session', { body: {
      identifier: this.#config.CAPITAL_IDENTIFIER,
      password: this.#config.CAPITAL_API_PASSWORD, encryptedPassword: false,
    } });
    return { authenticated: true, environment: 'demo', tradingEnabled: false };
  }

  async accounts() {
    const data = await this.#request('GET', '/accounts');
    if (!Array.isArray(data?.accounts)) throw new BrokerError('INVALID_RESPONSE');
    return data.accounts.map(account => ({
      accountId: account.accountId, accountName: account.accountName,
      accountType: account.accountType, currency: account.currency,
      preferred: account.preferred,
    }));
  }

  async findEurUsd({ metadata = false } = {}) {
    const data = await this.#request('GET', '/markets', { query: { searchTerm: 'EUR/USD' } });
    if (!Array.isArray(data?.markets)) throw new BrokerError('INVALID_RESPONSE');
    const normalize = value => typeof value === 'string' ? value.replace(/[/\s]/g, '').toUpperCase() : '';
    const matches = data.markets.filter(market => market.instrumentType === 'CURRENCIES' &&
      [market.epic, market.symbol, market.instrumentName].some(value => normalize(value) === 'EURUSD') &&
      ![market.symbol, market.instrumentName].some(value => /^[A-Z]{6}$/.test(normalize(value)) && normalize(value) !== 'EURUSD'));
    if (matches.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(matches[0].epic)) {
      throw new BrokerError(matches.length > 1 ? 'AMBIGUOUS_INSTRUMENT' : 'INSTRUMENT_NOT_FOUND');
    }
    return Object.freeze({ epic: matches[0].epic, symbol: 'EUR/USD', ...(metadata ? { metadata: structuredClone(matches[0]) } : {}) });
  }

  async verifyContext(expectedAccountId) {
    const data = await this.#request('GET', '/session');
    if (typeof expectedAccountId !== 'string' || !expectedAccountId.trim() || data?.accountId !== expectedAccountId) throw new BrokerError('UNEXPECTED_ACCOUNT_CONTEXT');
    return { verified: true, environment: 'demo' };
  }

  historicalCandles(epic, { from, to, max = 1000 }) {
    const start = timestamp(from), end = timestamp(to);
    if (!from.endsWith('Z') || !to.endsWith('Z') || start > end ||
        [start, end].some(t => Date.parse(t) % 3600000) ||
        !Number.isInteger(max) || max < 1 || max > 1000 ||
        (Date.parse(end) - Date.parse(start)) / 3600000 + 1 > max) throw new BrokerError('INVALID_HISTORICAL_REQUEST');
    return this.#request('GET', `/prices/${epic}`, { query: { resolution: 'HOUR', max: String(max),
      from: start.slice(0, 19), to: end.slice(0, 19) } });
  }

  market(epic) { return this.#request('GET', `/markets/${epic}`); }

  candles(epic, max = 24) {
    if (!Number.isInteger(max) || max < 1 || max > 1000) throw new BrokerError('INVALID_CANDLE_LIMIT');
    return this.#request('GET', `/prices/${epic}`, { query: { resolution: 'HOUR', max: String(max) } });
  }

  async close() {
    if (!this.#tokens) return;
    try { await this.#request('DELETE', '/session'); }
    finally { this.#tokens = undefined; }
  }
}
