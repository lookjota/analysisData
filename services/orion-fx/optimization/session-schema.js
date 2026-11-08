import { createStrategy } from '../strategies/research.js';
import { identity } from './session.js';
const fail = () => { throw new Error('INVALID_SESSION_SCHEMA'); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => { if (!object(v) || Object.keys(v).sort().join('|') !== [...keys].sort().join('|')) fail(); };
const hash = v => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail(); };
function tree(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) fail();
  if (v && typeof v === 'object') for (const [k,x] of Object.entries(v)) {
    if (['__proto__','constructor','prototype'].includes(k)) fail();
    tree(x);
  }
  else if (!['string','number','boolean'].includes(typeof v) && v !== null) fail();
}
/** v1 is not migrated or rewritten. Nested financial contracts still require replay. */
export function validateSessionSchema(b) {
  tree(b);
  exact(b, ['schemaVersion','state','sessionId','manifest','resultHash','results','bundleHash']);
  if (b.schemaVersion !== 'orion.research-session.v1' || b.state !== 'COMPLETED' || !/^session-[a-f0-9]{64}$/.test(b.sessionId)) fail();
  hash(b.resultHash); hash(b.bundleHash);
  const m = b.manifest;
  exact(m, ['hashRules','configuration','configurationHash','dataset','readiness','implementation','execution','accountPolicy','windows','selection','evidencePolicy','seed','holdout']);
  if (m.hashRules !== 'sorted-json-sha256-v1; JSON projection; exact numeric comparison' || m.selection !== 'NONE_NO_PROMOTION' || m.evidencePolicy !== 'ALWAYS_INSUFFICIENT_EVIDENCE_V1; descriptive only' || m.seed !== null || m.holdout !== 'NOT_EVALUATED; REGISTRY_STATE_UNKNOWN_NOT_QUERIED; NO_FRESHNESS_CLAIM') fail();
  hash(m.configurationHash);
  exact(m.implementation, ['policy','files','digest','node']);
  if (m.implementation.policy !== 'runtime-source-sha256-v1; strict Node version; no external research dependencies' || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(m.implementation.node) || !object(m.implementation.files) || !Object.keys(m.implementation.files).length) fail();
  hash(m.implementation.digest);
  for (const [path,digest] of Object.entries(m.implementation.files)) {
    if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(path) || path.split('/').some(p => p === '..' || p === '.')) fail();
    hash(digest);
  }
  if (identity(m.implementation.files) !== m.implementation.digest) fail();
  const c = m.configuration;
  exact(c, ['candidates','smoke','costStress','walkForward']);
  if (typeof c.smoke !== 'boolean' || typeof c.costStress !== 'boolean' || ![null,'rolling','expanding'].includes(c.walkForward) || !Array.isArray(c.candidates) || !c.candidates.length || c.candidates.length > 7) fail();
  const order = ['trend','mean-reversion','breakout','ma-cross','no-trade','buy-hold','risk-managed-hold'];
  let last = -1;
  for (const candidate of c.candidates) {
    exact(candidate, ['id','parameters']);
    const index = order.indexOf(candidate.id);
    if (index <= last || !object(candidate.parameters)) fail();
    last = index;
    try { if (identity(createStrategy(candidate.id,candidate.parameters).parameters) !== identity(candidate.parameters)) fail(); } catch { fail(); }
  }
  exact(b.results, ['comparison','statistics']);
  const r = b.results.comparison;
  if (!object(r) || r.schemaVersion !== 'orion.strategy-comparison.v1' || r.simulatedResearch !== true || r.tradingEnabled !== false || r.status !== 'INSUFFICIENT_EVIDENCE' || r.ranking !== null) fail();
  if (identity(r.dataset) !== identity(m.dataset) || identity(r.readiness) !== identity(m.readiness) || r.configurationDigest !== m.configurationHash || identity(r.integrity) !== identity(m.execution) || r.accountPolicy !== m.accountPolicy) fail();
  hash(m.dataset.contentHash); hash(m.dataset.artifactHash);
  if (!/^sha256-[a-f0-9]{64}$/.test(m.dataset.id)) fail();
  const expected = c.costStress ? ['baseline','slippage','commission'] : ['baseline'];
  if (!Array.isArray(r.results) || r.results.length !== expected.length || !Array.isArray(m.windows) || m.windows.length !== c.candidates.length) fail();
  r.results.forEach((scenario,i) => {
    if (scenario.id !== expected[i] || !Array.isArray(scenario.strategies) || scenario.strategies.length !== c.candidates.length) fail();
    scenario.strategies.forEach((s,j) => {
      if (s.strategy.id !== c.candidates[j].id || identity(s.strategy.parameters) !== identity(c.candidates[j].parameters) || s.evidence !== 'INSUFFICIENT_EVIDENCE') fail();
      for (const [part,set] of [['training','TRAIN'],['validation','VALIDATION']]) {
        const p = s[part], e = p?.config?.evaluation;
        if (!e || e.set !== set || p.config.initialCapital !== 1000 || !Number.isSafeInteger(p.metrics.totalTrades) || p.metrics.totalTrades < 0) fail();
        for (const k of ['evaluationStart','evaluationEnd']) if (typeof e[k] !== 'string' || !Number.isFinite(Date.parse(e[k])) || new Date(e[k]).toISOString() !== e[k]) fail();
        if (e.evaluationStart >= e.evaluationEnd) fail();
      }
      if (i === 0 && (identity(m.windows[j].training) !== identity(s.training.config) || identity(m.windows[j].validation) !== identity(s.validation.config))) fail();
    });
  });
  if (b.results.statistics?.evidence !== 'INSUFFICIENT_EVIDENCE') fail();
  return b;
}
