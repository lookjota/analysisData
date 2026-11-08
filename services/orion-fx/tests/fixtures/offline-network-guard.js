// Optional preload for the full regression commands. Mock transports remain usable.
// Loopback fetch is allowed for root HTTP service tests; external fetch is forbidden.
const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('AUTOMATED_TEST_EXTERNAL_FETCH_FORBIDDEN');
  return fetch(input, options);
};
