export function evaluateOrder() {
  return Object.freeze({ allowed: false, code: 'TRADING_DISABLED' });
}

// Transport guard: the only writes allowed manage the authentication session.
export function assertReadOnlyRequest(method, path) {
  const allowed = (path === '/session' && ['POST', 'DELETE', 'GET'].includes(method)) ||
    (method === 'GET' && (path === '/accounts' || path === '/markets' ||
      /^\/(markets|prices)\/[A-Za-z0-9_-]+$/.test(path)));
  if (!allowed) throw new Error('ENDPOINT_BLOCKED: somente consultas Demo');
}
