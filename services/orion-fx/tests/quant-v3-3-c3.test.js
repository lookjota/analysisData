import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableSession, inspectSession, verifySession, replaySession, implementationIdentity } from '../optimization/durable-session.js';
const input = new URL('../data/capital-demo/v33b-registry/sha256-7d270873ef59f50a8f3a05c6f3bfc6b644503309cfb9c4599b1f850a0de83f17.json', import.meta.url).pathname;
const temp = () => mkdtemp(join(tmpdir(), 'orion-c3-'));
test('C3 real artifact deterministic concurrent creation, replay and isolation', async () => {
  const dir = await temp();
  const before = await readFile(input);
  const options = {};
  const [a,b] = await Promise.all([createDurableSession(input, dir, options), createDurableSession(input, dir, options)]);
  assert.deepEqual(a,b);
  assert.equal((await verifySession(a.path,input)).integrity,'VERIFIED');
  assert.equal((await replaySession(a.path,input)).computationalReplay,'IDENTICAL');
  assert.deepEqual(await readFile(input),before);
  const bundle = await inspectSession(a.path);
  assert.equal(bundle.results.statistics.evidence,'INSUFFICIENT_EVIDENCE');
  assert.ok(bundle.results.statistics.warnings.includes('MULTIPLE_COMPARISON'));
  assert.equal(bundle.results.comparison.results[0].strategies.length,4);
  const expected = [[24,21.43500101,22,-14.26597187],[12,-3.73568,6,6.98565],[20,-8.71596092,10,-13.27511901],[1,3.13616005,1,-.5772]];
  bundle.results.comparison.results[0].strategies.forEach((r,i) => {
    assert.deepEqual([r.training.metrics.totalTrades,r.training.metrics.netProfit,r.validation.metrics.totalTrades,r.validation.metrics.netProfit],expected[i]);
    for (const scenario of bundle.results.comparison.results) for (const s of scenario.strategies) for (const partition of ['training','validation']) {
      const report=s[partition];
      assert.equal(report.config.initialCapital,1000);
      assert.ok(report.trades.every(t => t.openedAt >= report.config.evaluation.evaluationStart));
      assert.ok(report.decisions.every(d => d.signalTimestamp < report.config.evaluation.evaluationEnd));
      assert.equal(report.config.evaluation.set,partition === 'training' ? 'TRAIN':'VALIDATION');
    }
  });
  assert.ok(bundle.manifest.holdout.includes('UNKNOWN'));
});
test('C3 configuration, strategy parameters and costs change identity', async () => {
  const dir=await temp();
  const a=await createDurableSession(input,dir,{candidates:[{id:'no-trade'}]});
  const b=await createDurableSession(input,dir,{candidates:[{id:'no-trade',parameters:{slow:201}}]});
  const c=await createDurableSession(input,dir,{candidates:[{id:'no-trade'}],costStress:true});
  assert.equal(new Set([a.sessionId,b.sessionId,c.sessionId]).size,3);
});
test('C3 manifest/results/schema tampering fail closed; original replay preserved', async () => {
  const dir=await temp(), a=await createDurableSession(input,dir,{candidates:[{id:'no-trade'}]});
  const original=await readFile(a.path,'utf8');
  for (const mutation of [b=>b.manifest.selection='changed',b=>b.results.statistics.evidence='READY',b=>b.schemaVersion='future']) {
    const b=JSON.parse(original);mutation(b);await writeFile(a.path,JSON.stringify(b));
    await assert.rejects(inspectSession(a.path));
    await assert.rejects(createDurableSession(input,dir,{candidates:[{id:'no-trade'}]}));
  }
  await writeFile(a.path,original);
  assert.equal((await replaySession(a.path,input)).computationalReplay,'IDENTICAL');
});
test('C3 dataset verification and safe paths mandatory', async () => {
  const dir=await temp(), artifact=JSON.parse(await readFile(input,'utf8'));
  artifact.artifactHash='0'.repeat(64);
  const bad=join(dir,'bad.json');await writeFile(bad,JSON.stringify(artifact));
  await assert.rejects(createDurableSession(bad,dir));
  const alias=join(dir,'alias');await symlink(dir,alias);
  await assert.rejects(createDurableSession(input,alias,{candidates:[{id:'no-trade'}]}));
  await assert.rejects(createDurableSession(input,`${dir}/../unsafe`,{candidates:[{id:'no-trade'}]}));
  await chmod(dir,0o755);
  await assert.rejects(createDurableSession(input,dir,{candidates:[{id:'no-trade'}]}));
});
test('C3 implementation manifest contains working tree bytes and excludes Freqtrade', async () => {
  const a=await implementationIdentity();
  assert.ok(a.files['optimization/durable-session.js']);
  assert.ok(Object.keys(a.files).every(x=>!x.includes('freqtrade')));
  assert.deepEqual(a,await implementationIdentity());
});

test('C3 cost stress and walk-forward replay independently', async () => {
  for (const options of [{candidates:[{id:'trend'}],costStress:true}, {candidates:[{id:'no-trade'}],walkForward:'expanding'}]) {
    const a=await createDurableSession(input,await temp(),options);
    assert.equal((await replaySession(a.path,input)).computationalReplay,'IDENTICAL');
  }
});
