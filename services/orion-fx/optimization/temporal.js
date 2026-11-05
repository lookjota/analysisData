/** Index ranges [start,end); chronological, no shuffle or parameter selection. */
export function temporalSplit(length, trainingFraction = .7) {
  if (!Number.isInteger(length) || length < 4 || !Number.isFinite(trainingFraction) || trainingFraction <= 0 || trainingFraction >= 1) throw new Error('INVALID_SPLIT');
  const boundary = Math.floor(length * trainingFraction);
  if (!boundary || boundary >= length) throw new Error('EMPTY_SPLIT');
  return { train: [0, boundary], test: [boundary, length] };
}
export function walkForwardWindows(length, { trainSize, testSize, expanding = false, validationSize = 0 } = {}) {
  if (![length, trainSize, testSize].every(x => Number.isInteger(x) && x > 0) || typeof expanding !== 'boolean' || !Number.isSafeInteger(validationSize) || validationSize < 0 || trainSize + validationSize + testSize > length) throw new Error('INVALID_WINDOWS');
  const windows = [];
  for (let end = trainSize; end + validationSize + testSize <= length; end += testSize) windows.push({ train: [expanding ? 0 : end - trainSize, end], ...(validationSize ? { validation: [end, end + validationSize] } : {}), test: [end + validationSize, end + validationSize + testSize] });
  return windows;
}

/** Final holdout disjoint from training and validation; ranges are half-open. */
export function researchSplit(length, { trainFraction = .6, validationFraction = .2 } = {}) {
  if (!Number.isSafeInteger(length) || length < 3 || ![trainFraction, validationFraction].every(x => Number.isFinite(x) && x > 0) || trainFraction + validationFraction >= 1) throw new Error('INVALID_RESEARCH_SPLIT');
  const a = Math.floor(length * trainFraction), b = Math.floor(length * (trainFraction + validationFraction));
  if (a < 1 || b <= a || b >= length) throw new Error('EMPTY_RESEARCH_SPLIT');
  return { train: [0, a], validation: [a, b], finalTest: [b, length] };
}
