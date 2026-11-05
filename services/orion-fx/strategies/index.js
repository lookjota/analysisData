/**
 * Future research strategy interface; receives normalized market data only.
 * @typedef {Object} ResearchStrategy
 * @property {string} id
 * @property {(context: {quote: object, candles: object[]}) => Promise<object[]>} analyze
 * Returned observations have no execution route in FX V1.
 */
export const observationOnlyStrategy = Object.freeze({
  id: 'observation-only',
  async analyze() { return []; },
});
