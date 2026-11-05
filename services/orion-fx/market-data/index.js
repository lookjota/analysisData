export function spread(bid, ask) {
  if (![bid, ask].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0) || ask < bid) {
    throw new Error('INVALID_QUOTE');
  }
  // Display precision for EUR/USD; never used to size or execute an order.
  const absolute = Number((ask - bid).toFixed(10));
  return { bid, ask, spread: absolute, spreadPips: Number((absolute / 0.0001).toFixed(6)) };
}

export async function readQuote(broker, epic) {
  const data = await broker.market(epic);
  if (data?.instrument?.epic !== epic || !data.snapshot) throw new Error('INVALID_MARKET_RESPONSE');
  const quote = spread(data.snapshot.bid, data.snapshot.offer);
  return { symbol: 'EUR/USD', epic, ...quote,
    marketStatus: data.snapshot.marketStatus, brokerTime: data.snapshot.updateTime,
    receivedAt: new Date().toISOString() };
}

export async function readHourlyCandles(broker, epic, max = 24) {
  const data = await broker.candles(epic, max);
  if (!Array.isArray(data?.prices)) throw new Error('INVALID_CANDLES');
  return data.prices.map(price => {
    const time = price.snapshotTimeUTC;
    if (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?$/.test(time) ||
        !Number.isFinite(Date.parse(time.endsWith('Z') ? time : `${time}Z`))) throw new Error('INVALID_CANDLE_TIME');
    return { time: new Date(time.endsWith('Z') ? time : `${time}Z`).toISOString(), resolution: 'HOUR',
      open: spread(price.openPrice?.bid, price.openPrice?.ask),
      high: spread(price.highPrice?.bid, price.highPrice?.ask),
      low: spread(price.lowPrice?.bid, price.lowPrice?.ask),
      close: spread(price.closePrice?.bid, price.closePrice?.ask) };
  });
}
