/** Deterministic invented prices; never real market history. */
export function syntheticCandles({ count = 720, regime = 'mixed' } = {}) {
  if (!Number.isInteger(count) || count < 2 || count > 100000 || !['mixed', 'up', 'down', 'flat', 'volatile', 'quiet', 'gap', 'invalid'].includes(regime)) throw new Error('INVALID_FIXTURE');
  const rows = []; let time = Date.parse('2024-01-08T00:00:00Z'), previous = 1.1;
  for (let i = 0; i < count; i++, time += 3600000) {
    while (true) {
      const d = new Date(time), day = d.getUTCDay(), hour = d.getUTCHours();
      if (day === 6 || (day === 5 && hour >= 22) || (day === 0 && hour < 22)) time += 3600000;
      else break;
    }
    if (regime === 'gap' && i === 40) time += 7200000;
    const amplitude = regime === 'volatile' ? 0.004 : regime === 'quiet' ? 0.00005 : 0.0008;
    const drift = regime === 'up' ? 0.00015 : regime === 'down' ? -0.00015 : 0;
    const close = regime === 'flat' ? 1.1 : 1.1 + drift * i + amplitude * Math.sin(i / 5) + (regime === 'mixed' ? 0.006 * Math.sin(i / 80) : 0);
    rows.push({ instrument: 'EUR/USD', timeframe: 'H1', timestamp: new Date(time).toISOString(), open: previous, high: Math.max(previous, close) + amplitude / 2, low: Math.min(previous, close) - amplitude / 2, close, source: 'orion-synthetic-v1', synthetic: true });
    previous = close;
  }
  if (regime === 'invalid') rows[10].high = 0;
  return rows;
}
