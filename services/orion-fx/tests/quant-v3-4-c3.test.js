import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readStoredJson, writeAtomicJson } from '../market-data/capital-history.js';
import { initializeForwardJournal, appendForwardObservations, inspectForwardJournal } from '../market-data/forward-journal.js';
import { assessOpsReadiness } from '../paper/ops-readiness.js';
import { processAppendableJournal } from '../paper/appendable-operations.js';
import { observations, clock } from './fixtures/appendable-c2.js';
import { hash } from '../persistence/journal.js';
const temporary = () => mkdtemp(join(tmpdir(), 'orion-c3-'));
for (const path of ['a/../b.json', '.env', '.env.local', '.aws/credentials', '.ssh/id_rsa', 'protected-holdout/input.json']) test(`C3 rejects protected lexical input ${path}`, async () => {
  await assert.rejects(readStoredJson(path), /PATH_TRAVERSAL_FORBIDDEN|PROTECTED_PATH_FORBIDDEN/);
});
for (const kind of ['file','parent','dangling']) test(`C3 rejects ${kind} symlink`, async () => {
  const root = await temporary(); await writeAtomicJson(join(root,'source.json'), {ok:true});
  const link = join(root,'link'); await symlink(kind === 'parent' ? root : kind === 'file' ? join(root,'source.json') : join(root,'absent'), link);
  await assert.rejects(readStoredJson(kind === 'parent' ? join(link,'source.json') : link));
});
test('C3 rejects directory input and publishes exclusively with private permissions', async () => {
  const root = await temporary(); await assert.rejects(readStoredJson(root), /FILE_SIZE_OR_TYPE/);
  const path = join(root,'artifact.json'); await writeAtomicJson(path, {original:true});
  await assert.rejects(writeAtomicJson(path, {replaced:true}), {code:'EEXIST'});
  assert.deepEqual(JSON.parse(await readFile(path)), {original:true}); assert.equal((await stat(path)).mode & 0o777, 0o600);
});
test('C3 readonly filesystem failure is visible', async () => {
  await assert.rejects(writeAtomicJson('/proc/orion-c3-denied.json', {}));
});
test('C3 network tripwires reject fetch HTTP HTTPS TCP Socket TLS in isolated process', () => {
  const child = spawnSync(process.execPath, [new URL('./fixtures/c3-network-child.js', import.meta.url).pathname], {timeout:10000});
  assert.equal(child.status, 0, child.stderr.toString()); assert.equal(child.signal, null);
});
for (const mutation of ['payload','previous','sequence','calendar','resealed-payload']) test(`C3 detects ${mutation} journal mutation`, async () => {
  const root = await temporary(), directory=join(root,'journal'); await initializeForwardJournal(directory, {}, clock); await appendForwardObservations(directory, observations(3), clock);
  const path=join(directory,mutation==='calendar'?'journal.json':'observation-000001.json'); const record=JSON.parse(await readFile(path));
  if(mutation==='calendar') record.calendar.provider='altered';
  else if(mutation==='previous') record.previous='0'.repeat(64);
  else if(mutation==='sequence') record.sequence=2;
  else record.observation.sourceRevision='altered';
  if(mutation==='resealed-payload') { const {digest,...body}=record; record.digest=hash(body); }
  await writeFile(path,JSON.stringify(record)); await assert.rejects(inspectForwardJournal(directory,clock));
});
test('C3 readiness blocks missing evidence and synchronized engineering fixtures', async () => {
  const root=await temporary(); assert.equal((await assessOpsReadiness({directory:root,runId:'demo',clock})).classification,'UNKNOWN');
  const directory=join(root,'journal'); await initializeForwardJournal(directory,{},clock); await appendForwardObservations(directory,observations(3),clock);
  await processAppendableJournal({directory,runId:'demo',action:'init',clock}); await processAppendableJournal({directory,runId:'demo',action:'step',limit:3,clock});
  const result=await assessOpsReadiness({directory,runId:'demo',clock}); assert.equal(result.classification,'FORWARD_OBSERVATION_BLOCKED'); assert.equal(result.engineeringAssessment,'ENGINEERING_READY'); assert.equal(result.receiptIntegrity,'MISSING'); assert.equal(result.tradingEnabled,false); assert.equal(result.accountEvidence.length,4);
});
