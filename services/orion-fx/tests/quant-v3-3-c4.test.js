import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { identity } from '../optimization/session.js';
import { inspectSession, auditSessionDirectory, runSessionCommand } from '../optimization/durable-session.js';
const source = new URL('../research-sessions/session-3c7dca39f048e5edc8528f3d0d3e89bf77b1e2646c8a336225e83775c8f47b2d.json',import.meta.url);
const original = JSON.parse(await readFile(source,'utf8'));
function rehash(b) {
  b.sessionId = `session-${identity(b.manifest)}`;
  b.resultHash = identity(b.results);
  const {bundleHash,...body} = b;
  b.bundleHash = identity(body);
  return b;
}
test('C4 legitimate C3 envelope remains inspectable', async () => {
  assert.equal((await inspectSession(source.pathname)).resultHash, original.resultHash);
});
const mutations = {
  'unknown envelope field': b => b.executable = 'unsafe',
  'unsupported version': b => b.schemaVersion = 'orion.research-session.v999',
  'missing configuration flag': b => delete b.manifest.configuration.smoke,
  'invalid flag type': b => b.manifest.configuration.smoke = 'false',
  'unknown configuration behavior': b => b.manifest.configuration.callback = 'execute',
  'duplicate strategy': b => b.manifest.configuration.candidates.push(b.manifest.configuration.candidates[0]),
  'invalid strategy parameters': b => b.manifest.configuration.candidates[0].parameters.fast = -1,
  'dataset mismatch': b => b.results.comparison.dataset.id = 'sha256-'+'0'.repeat(64),
  'forged evidence': b => b.results.statistics.evidence = 'RELIABLE',
  'invalid chronology': b => b.results.comparison.results[0].strategies[0].validation.config.evaluation.evaluationEnd = 'invalid',
  'negative trade count': b => b.results.comparison.results[0].strategies[0].validation.metrics.totalTrades = -1,
};
for (const [name,mutate] of Object.entries(mutations)) test(`C4 rehashed ${name} rejected`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'orion-c4-')), b = structuredClone(original);
  mutate(b); rehash(b);
  const path = join(dir,'bad.json'); await writeFile(path,JSON.stringify(b));
  await assert.rejects(inspectSession(path), /INVALID_SESSION_SCHEMA/);
});
test('C4 read-only recovery is repeatable and preserves orphan evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(),'orion-c4-'));
  const path = join(dir,`${original.sessionId}.json`);
  await writeFile(path,JSON.stringify(original));
  await writeFile(join(dir,'.incomplete-test'),'partial');
  await writeFile(join(dir,'session-'+'0'.repeat(64)+'.json'),'{}');
  await symlink(path,join(dir,'alias'));
  const names = await readdir(dir), bytes = await readFile(path);
  const a = await auditSessionDirectory(dir), b = await auditSessionDirectory(dir);
  assert.deepEqual(a,b); assert.deepEqual(await readdir(dir),names); assert.deepEqual(await readFile(path),bytes);
  assert.deepEqual(new Set(a.artifacts.map(x=>x.status)),new Set(['COMPLETE_SELF_HASH_CHECKED','INCOMPLETE_ORPHAN','INVALID','UNSAFE']));
  await assert.rejects(auditSessionDirectory(join(dir,'alias')));
});
test('C4 CLI rejects irrelevant options and reports incomplete audit exit 2', async () => {
  const io = {output:()=>{},errorOutput:()=>{}};
  assert.equal(await runSessionCommand(['research:session:inspect','--session',source.pathname,'--smoke','true'],io),1);
  const dir = await mkdtemp(join(tmpdir(),'orion-c4-'));
  await writeFile(join(dir,'.incomplete-test'),'partial');
  assert.equal(await runSessionCommand(['research:session:recover','--directory',dir],io),2);
});
