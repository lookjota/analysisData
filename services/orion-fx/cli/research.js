import { resolve, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readStoredJson, verifyHistory } from '../market-data/capital-history.js';
import { writeExclusive } from '../market-data/historical.js';
import { assessReadiness } from '../optimization/readiness.js';
import { createResearchSession, identity } from '../optimization/session.js';
import { createStrategy } from '../strategies/research.js';
export const researchCommands = ['research:readiness', 'research:evaluate'];
export async function runResearch([command, ...args], { output, errorOutput }) {
  if (args.length === 1 && args[0] === '--help') {
    output(`${command} --input verified-history.json [--strategy trend|mean-reversion|breakout|ma-cross|no-trade] [--smoke true|false] [--out NEW_DIRECTORY]\nOffline simulated research. Evaluates TRAIN and VALIDATION only. No final-holdout access.`); return 0;
  }
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].slice(2);
      if (!args[i].startsWith('--') || !['input', 'strategy', 'smoke', 'out'].includes(key) || key in options || args[i + 1] === undefined) throw new Error('INVALID_ARGUMENTS');
      options[key] = args[i + 1];
    }
    if (!options.input || (options.smoke !== undefined && !['true', 'false'].includes(options.smoke))) throw new Error('INVALID_ARGUMENTS');
    const artifact = await readStoredJson(resolve(options.input));
    const candidate = { id: options.strategy ?? 'trend' };
    const readiness = assessReadiness(artifact, { candidates: [candidate], smoke: options.smoke === 'true' });
    let report = { schemaVersion: 'orion.research-readiness.v1', readiness };
    if (command === 'research:evaluate') {
      if (readiness.classification === 'INSUFFICIENT_DATA') throw new Error('INSUFFICIENT_DATA_USE_EXPLICIT_SMOKE');
      const dataset = verifyHistory(artifact);
      const config = { costs: { spreadPips: 0, slippagePips: .1 }, dataValidation: { ...dataset.manifest.validation, calendar: dataset.manifest.calendar } };
      const session = createResearchSession(dataset.candles, { config });
      const results = session.optimize([candidate], { useValidation: true });
      const frozen = session.freeze();
      const body = { schemaVersion: 'orion.research-preview.v1', status: 'INSUFFICIENT_EVIDENCE', simulatedResearch: true, readiness, results, frozen,
        strategy: { ...candidate, version: createStrategy(candidate.id).version, parameters: createStrategy(candidate.id).parameters },
        runtime: process.version, parameterCombinations: 1, strategiesEvaluated: 1, holdout: 'UNCONSUMED_NO_FINAL_EVALUATION_API', ranking: null };
      report = { ...body, reportId: identity(body) };
    }
    if (options.out) {
      const directory = resolve(options.out);
      await mkdir(directory, { recursive: false, mode: 0o700 });
      await writeExclusive(join(directory, 'research.json'), JSON.stringify(report, null, 2) + '\n');
    }
    output(JSON.stringify(report, null, 2)); return 0;
  } catch (error) {
    errorOutput(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'RESEARCH_INPUT_OR_OUTPUT_ERROR'); return 1;
  }
}
