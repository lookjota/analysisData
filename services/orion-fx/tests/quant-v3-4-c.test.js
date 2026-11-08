import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { collectOfflineReceipt, verifyAcquisitionReceipt, saveAcquisitionReceipt, appendReceiptObservations } from '../market-data/acquisition-receipt.js';
import { initializeForwardJournal } from '../market-data/forward-journal.js';
import { hash } from '../persistence/journal.js';
import { run } from '../cli/index.js';
import { fixtureEnv, offlineTransport, price, from, to, asOf } from './fixtures/acquisition-offline.js';
const clock = () => asOf;
const collect = (scenario = 'success', options = {}) => collectOfflineReceipt({ env: fixtureEnv, ...offlineTransport(scenario), from, to, asOf, ...options });
const reseal = r => { const { receiptHash, ...body } = r; return { ...body, receiptHash: hash(body) }; };

test('C receipt preserves actual provider schema and declares fixture trust accurately', async () => {
  const transport = offlineTransport();
  const r = await collectOfflineReceipt({ env: fixtureEnv, ...transport, from, to, asOf });
  const v = verifyAcquisitionReceipt(r);
  assert.equal(v.integrity, 'VERIFIED_LOCAL_CONTENT_ONLY');
  assert.equal(v.sourceAuthentication, 'UNVERIFIED_OFFLINE_FIXTURE');
  assert.equal(v.cryptographicSourceSignature, false);
  assert.equal(v.executableQuoteAvailable, false);
  assert.equal(v.returnedUTC.endExclusive, to);
  assert.equal(v.observationHashes.length, 2);
  assert.equal(r.responses[0].prices[0].snapshotTimeUTC, from.slice(0, 19));
  assert.deepEqual(transport.calls.map(c => c.method), ['POST', 'GET', 'GET', 'GET', 'DELETE']);
  for (const secret of Object.values(fixtureEnv)) assert.ok(!JSON.stringify(r).includes(secret));
});
for (const scenario of ['empty', 'missing', 'duplicate', 'boundary', 'crossed', 'resolution', 'instrument', 'throttle', 'expired', 'malformed', 'redirect', 'host', 'interrupted', 'secret']) {
  test(`C injected provider fixture rejects ${scenario} without publishing a receipt`, async () => {
    await assert.rejects(collect(scenario), error => !error.message.includes('fixture-password'));
  });
}
test('C incomplete current candle and publication delay fail closed', async () => {
  await assert.rejects(collect('success', { asOf: '2026-11-02T12:00:30Z' }));
  assert.ok(await collect('success', { asOf: '2026-11-02T12:01:00Z' }));
  await assert.rejects(collect('success', { publicationDelayMs: -1 }));
});
test('C stale and delayed responses retain engineering identity', async () => {
  for (const time of ['2026-11-02T12:20:00Z', '2026-11-08T12:00:00Z']) {
    const r = await collect('success', { asOf: time });
    assert.equal(verifyAcquisitionReceipt(r).evidenceClassification, 'ENGINEERING_REPLAY');
  }
});
test('C missing injected transport and Live config reject before dispatch', async () => {
  await assert.rejects(collectOfflineReceipt({ env: fixtureEnv }), /OFFLINE_TRANSPORT/);
  await assert.rejects(collectOfflineReceipt({ env: { ...fixtureEnv, CAPITAL_ENV: 'live' }, fetchImpl: () => assert.fail('dispatch') }));
});
test('C declared NY17 calendar respects DST weekend without manufactured bars', async () => {
  const start = '2026-10-30T20:00:00.000Z', end = '2026-11-01T23:00:00.000Z';
  const r = await collectOfflineReceipt({ env: fixtureEnv, ...offlineTransport('success', [price(start), price('2026-11-01T22:00:00.000Z')]), from: start, to: end, asOf });
  assert.equal(r.history.candles.length, 2);
  assert.equal(r.history.acquisition.closedHours, 49);
  assert.equal(verifyAcquisitionReceipt(r).evidenceClassification, 'ENGINEERING_REPLAY');
});
test('C empty closed window is explicitly unsupported by existing history artifact schema', async () => {
  await assert.rejects(collect('empty', { from: '2026-10-31T10:00:00.000Z', to: '2026-10-31T12:00:00.000Z' }));
});
test('C differing calendar cannot attach a receipt sidecar to the journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-receipt-calendar-')), dir = join(root, 'journal');
  await initializeForwardJournal(dir, { calendar: { provider: 'different' } }, clock);
  await assert.rejects(appendReceiptObservations(dir, await collect(), clock), /CALENDAR_MISMATCH/);
  assert.ok(!(await readdir(dir)).some(n => n.startsWith('receipt-')));
});
test('C forged source, environment, publication and raw data reject even with resealed outer hash', async () => {
  const original = await collect();
  for (const mutate of [r => { r.metadata.transportClassification = 'AUTHENTICATED_HTTPS'; },
    r => { r.metadata.environment = 'live'; }, r => { r.metadata.evidenceClassification = 'FORWARD_DATA_OBSERVATION'; },
    r => { r.metadata.cryptographicSourceSignature = true; }, r => { r.metadata.acquiredAt = '2099-01-01T00:00:00Z'; },
    r => { r.responses[0].prices[0].closePrice.bid += .00001; }]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => verifyAcquisitionReceipt(reseal(changed)));
  }
});
test('C atomic receipt publication, recovery before append, duplicate append and correction quarantine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-receipt-')), dir = join(root, 'journal');
  const r = await collect(), path = join(root, 'receipt.json');
  await initializeForwardJournal(dir, {}, clock);
  await saveAcquisitionReceipt(path, r);
  await assert.rejects(saveAcquisitionReceipt(path, r), { code: 'EEXIST' });
  let state = await appendReceiptObservations(dir, JSON.parse(await readFile(path)), clock);
  const head = state.head;
  assert.equal(state.sequence, 2);
  assert.deepEqual(state.classifications, ['ENGINEERING_REPLAY']);
  state = await appendReceiptObservations(dir, r, clock);
  assert.equal(state.sequence, 2); assert.equal(state.head, head);
  assert.ok((await readdir(dir)).includes(`receipt-${r.receiptHash}.json`));
  const before = await readFile(join(dir, 'observation-000001.json'));
  state = await appendReceiptObservations(dir, await collect('corrected'), clock);
  assert.deepEqual(state.quarantinedSequences, [3]);
  assert.deepEqual(await readFile(join(dir, 'observation-000001.json')), before);
});
test('C offline CLI verify and coverage require no credentials or transport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-receipt-cli-')), path = join(root, 'receipt.json');
  await saveAcquisitionReceipt(path, await collect());
  for (const command of ['receipt:verify', 'receipt:coverage']) {
    const lines = [];
    assert.equal(await run([command, '--input', path], { env: {}, fetchImpl: () => assert.fail('network'), output: x => lines.push(JSON.parse(x)), errorOutput: x => assert.fail(x) }), 0);
    assert.equal(lines[0].brokerExecution, 'DISABLED');
  }
  for (const args of [['receipt:verify', '--input', path, '--journal', root], ['receipt:append', '--input', path], ['receipt:verify', '--input', path, '--live', 'true']]) {
    assert.equal(await run(args, { env: {}, fetchImpl: () => assert.fail('network'), output: () => {}, errorOutput: () => {} }), 1);
  }
});

for (const phase of ['before-publication', 'after-publication', 'after-append']) {
  test(`C real SIGKILL recovery ${phase} leaves no duplicated observations`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'orion-receipt-crash-')), dir = join(root, 'journal'), path = join(root, 'receipt.json');
    await initializeForwardJournal(dir, {}, clock);
    const child = fork(new URL('./fixtures/acquisition-receipt-child.js', import.meta.url), [phase, path, dir], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    try {
      const [message] = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('EARLY_EXIT'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('CHILD_TIMEOUT')), 10000).unref())]);
      assert.equal(message, phase);
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      const receipt = phase === 'before-publication' ? await collect() : JSON.parse(await readFile(path));
      const first = await appendReceiptObservations(dir, receipt, clock);
      const second = await appendReceiptObservations(dir, receipt, clock);
      assert.equal(first.sequence, 2); assert.equal(second.sequence, 2); assert.equal(first.head, second.head);
    } finally { child.kill('SIGKILL'); }
  });
}

test('C appending journal data cannot silently extend an existing fixed F2 identity', async () => {
  const { processJournalSnapshot } = await import('../paper/journal-operations.js');
  const { appendForwardObservations } = await import('../market-data/forward-journal.js');
  const root = await mkdtemp(join(tmpdir(), 'orion-receipt-prefix-')), dir = join(root, 'journal');
  await initializeForwardJournal(dir, {}, clock);
  const receipt = await collect();
  await appendReceiptObservations(dir, receipt, clock);
  await processJournalSnapshot({ directory: dir, runId: 'fixed', action: 'init', clock });
  const before = await processJournalSnapshot({ directory: dir, runId: 'fixed', action: 'step', limit: 2, clock });
  const candle = structuredClone(receipt.history.candles.at(-1)); candle.timestamp = '2026-11-02T12:00:00.000Z';
  const later = () => '2026-11-02T13:05:00.000Z';
  await appendForwardObservations(dir, [{ candle, classification: 'ENGINEERING_REPLAY', timestampConvention: 'UTC_BAR_OPEN', complete: true, observedAt: later(), acquiredAt: later(), sourceRevision: 'fixture-later', evidence: { content: candle, contentHash: hash(candle) } }], later);
  const after = await processJournalSnapshot({ directory: dir, runId: 'fixed', action: 'step', limit: 2, clock: later });
  assert.equal(after.pendingJournalRecords, 1);
  assert.equal(after.synchronized, true);
  assert.deepEqual(after.accounts.map(a => a.datasetHash), before.accounts.map(a => a.datasetHash));
  assert.deepEqual(after.accounts.map(a => a.committedCandles), [2, 2, 2, 2]);
  const financial = states => states.map(a => { const { sequence, ...snapshot } = a.snapshot; return snapshot; });
  assert.deepEqual(financial(after.accounts), financial(before.accounts));
});
