import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NimiElectronLocalAppHostError } from '@nimiplatform/kit/shell/electron/main';
import { openHarness } from '../dist-electron/harness.js';

test('reopening and running another session preserves a parked write', async () => {
  const namespace = randomUUID();
  const folder = join(homedir(), '.nimi-harness', namespace);
  const documents = new Map([['harness-namespace.json', namespace]]);
  const services = {
    storage: {
      async readJson(key) {
        if (!documents.has(key)) throw new NimiElectronLocalAppHostError('not-found', false);
        return { value: structuredClone(documents.get(key)) };
      },
      async writeJson(key, value) {
        documents.set(key, structuredClone(value));
        return { value };
      },
    },
    aiConfig: { async get() { return { record: {configRef:'main',name:'Default',revision:'1',isDefault:true}, effectiveSelections: [{
      capabilityContract: 'text.generate', state: 'ready',
      contextWindowTokens: 8192,
      resource: { oneofKind: 'local', local: {
        label: 'Test model', loadoutRef: 'loadout-a', implementation: { implementationId: 'test' }, configuredFeatures: [],
      } },
    }] }; } },
    ai: { text: { async streamTurn(input) {
      assert.ok(input.tools.length > 0, 'a short task in a small window must not trigger a summary request');
      const latestUser = input.messages.findLastIndex(message => message.role === 'user');
      const finished = input.messages.slice(latestUser + 1).some(message => message.turnItems?.some(item => item.type === 'tool-result'));
      const filename = input.messages[latestUser].text;
      return {
        async *[Symbol.asyncIterator]() {
          if (finished) yield { type: 'delta', itemIndex: 0, text: 'Written.' };
          else yield { type: 'tool-call', itemIndex: 0, toolCall: {
            id: randomUUID(), name: 'write', arguments: { path: filename, content: filename === 'large.txt' ? '文'.repeat(12000) : filename },
          } };
          yield { type: 'completed', finishReason: finished ? 'stop' : 'tool-calls' };
        },
        async cancel() {},
      };
    } } },
  };
  let harness;
  const waitFor = async predicate => {
    let last;
    for (let attempt = 0; attempt < 200; attempt++) {
      const view = await harness.snapshot();
      last = view;
      if (predicate(view)) return view;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(`Session did not reach the expected state: ${JSON.stringify(last)}`);
  };
  try {
    let viewChanges = 0;
    harness = await openHarness(services, new AbortController().signal, () => { viewChanges++; });
    await harness.create();
    const first = await harness.snapshot();
    const beforeRename = viewChanges;
    await harness.rename(first.sessionId, 'Handoff');
    assert.ok(viewChanges > beforeRename, 'a catalogue-only change must update the desktop view');
    const afterRename = viewChanges;
    await harness.snapshot();
    assert.equal(viewChanges, afterRename, 'reading an idle snapshot must not invalidate it again');
    await harness.setInstructions(first.sessionId, 'Keep unknown dates pending.');
    const firstRequest = randomUUID();
    await harness.submit(first.sessionId, 'first.txt', firstRequest);
    const pending = await waitFor(view => view.decisions.length === 1);
    const followup = randomUUID();
    await assert.rejects(harness.submit(first.sessionId, 'remote.txt', randomUUID()), /current task/);
    await harness.submit(first.sessionId, 'follow-up.txt', followup, true);
    await harness.submit(first.sessionId, 'follow-up.txt', followup, true);
    await assert.rejects(harness.submit(first.sessionId, 'changed.txt', followup, true), /already identifies/);
    assert.deepEqual((await harness.snapshot()).queued.map(item => item.text), ['follow-up.txt']);
    const readProgress = (id, cursor = '', signal = new AbortController().signal) => harness.readProgress(id, cursor, signal);
    const waitingSnapshot = await readProgress(first.sessionId);
    assert.equal(JSON.parse(waitingSnapshot).stage, 'waiting');
    assert.equal(waitingSnapshot.includes('first.txt'), false); // Pending tool arguments are private.
    const observation = new AbortController();
    const cursor = createHash('sha256').update(waitingSnapshot).digest('hex');
    const observing = readProgress(first.sessionId, cursor, observation.signal);
    observation.abort();
    await assert.rejects(observing, { name: 'AbortError' });
    await harness.create();
    const second = await harness.snapshot();
    assert.equal(second.instructions, '');
    assert.deepEqual(harness.list(0).sessions.find(row => row.id === second.sessionId), { id: second.sessionId, title: 'New session' });
    const requestId = randomUUID();
    assert.equal(await harness.inputStatus(second.sessionId, requestId), 'not-found');
    await Promise.all([
      harness.submit(second.sessionId, 'second.txt', requestId),
      harness.submit(second.sessionId, 'second.txt', requestId),
    ]);
    await assert.rejects(harness.submit(second.sessionId, 'other.txt', requestId), { code: 'HARNESS_REQUEST_CONFLICT' });
    await assert.rejects(harness.submit(second.sessionId, 'busy.txt', randomUUID()), { code: 'HARNESS_SESSION_BUSY' });
    await waitFor(view => view.decisions.length === 1);
    await harness.close();

    harness = await openHarness(services, new AbortController().signal);
    // Lookup after restart precedes any open session or model access.
    assert.equal(await harness.inputStatus(second.sessionId, requestId), 'placed');
    const restored = await harness.snapshot();
    assert.equal(restored.sessionId, second.sessionId);
    assert.equal(restored.decisions.length, 1);
    assert.equal(await harness.inputStatus(second.sessionId, requestId), 'placed');
    assert.equal(await harness.inputStatus(first.sessionId, requestId), 'not-found');
    await harness.submit(second.sessionId, 'second.txt', requestId);
    const repeated = await harness.snapshot();
    assert.deepEqual(repeated.decisions, restored.decisions);
    assert.equal(repeated.entries.filter(entry => entry.role === 'user' && entry.text === 'second.txt').length, 1);
    await assert.rejects(readFile(join(second.workspace, 'second.txt')), { code: 'ENOENT' });
    const preview = await harness.pendingDecision(second.sessionId);
    assert.equal(preview.state, 'review');
    assert.equal(preview.tool, 'write');
    assert.equal(JSON.parse(preview.argumentsJson).path, 'second.txt');
    assert.equal(await harness.resolveDecision(second.sessionId, preview.taskId, '0'.repeat(64), true), 'stale');
    assert.equal(await harness.resolveDecision(first.sessionId, preview.taskId, preview.revision, true), 'stale');
    await harness.close();
    harness = await openHarness(services, new AbortController().signal);
    assert.deepEqual(await harness.pendingDecision(second.sessionId), preview);
    const cold = await readProgress(second.sessionId);
    assert.equal(JSON.parse(cold).stage, 'waiting');
    await assert.rejects(readFile(join(second.workspace, 'second.txt')), { code: 'ENOENT' });
    const nextSnapshot = readProgress(second.sessionId, createHash('sha256').update(cold).digest('hex'));
    assert.equal(await harness.resolveDecision(second.sessionId, preview.taskId, preview.revision, true), 'recorded');
    assert.notEqual(await nextSnapshot, cold);
    assert.equal(await harness.resolveDecision(second.sessionId, preview.taskId, preview.revision, false), 'stale');
    await harness.resume(second.sessionId);
    await waitFor(view => !view.running);
    await harness.submit(second.sessionId, 'second.txt', requestId);
    assert.equal((await harness.snapshot()).running, false);
    assert.equal(await harness.inputStatus(second.sessionId, requestId), 'done');
    assert.deepEqual(JSON.parse(await readProgress(second.sessionId)), { stage: 'done', turn: 0, text: 'Written.', truncated: false });
    assert.deepEqual(await harness.readAnswer(second.sessionId, requestId), { status: 'done', text: 'Written.', truncated: false });
    assert.deepEqual(await harness.readAnswer(first.sessionId, requestId), { status: 'not-found' });
    assert.equal(await readFile(join(second.workspace, 'second.txt'), 'utf8'), 'second.txt');
    await assert.rejects(readFile(join(first.workspace, 'first.txt')), { code: 'ENOENT' });

    await harness.select(first.sessionId);
    const stillPending = await harness.snapshot();
    assert.equal(stillPending.needsResume, true);
    assert.equal(stillPending.instructions, 'Keep unknown dates pending.');
    assert.equal(stillPending.sessions.find(item => item.id === first.sessionId).title, 'Handoff');
    assert.deepEqual(stillPending.queued.map(item => item.text), ['follow-up.txt']);
    assert.deepEqual(stillPending.decisions, pending.decisions);
    assert.equal(await harness.stopInput(first.sessionId, requestId), 'not-found');
    await harness.close();
    harness = await openHarness(services, new AbortController().signal);
    assert.equal(await harness.stopInput(first.sessionId, firstRequest), 'requested');
    await waitFor(view => !view.running);
    assert.equal(await harness.inputStatus(first.sessionId, firstRequest), 'unanswered');
    assert.equal(await harness.inputStatus(first.sessionId, followup), 'queued'); // The remote stop targeted a different request.
    await harness.withdraw(first.sessionId, stillPending.queued[0].id);
    assert.equal(await harness.inputStatus(first.sessionId, followup), 'unanswered');
    assert.deepEqual((await harness.snapshot()).queued, []);
    await harness.setInstructions(first.sessionId, '');
    assert.equal((await harness.snapshot()).instructions, '');
    const nextRequest = randomUUID();
    await harness.submit(first.sessionId, 'later.txt', nextRequest);
    await waitFor(view => view.decisions.length === 1);
    assert.equal(await harness.stopInput(first.sessionId, firstRequest), 'settled');
    assert.equal((await harness.snapshot()).decisions.length, 1);
    await harness.stop(first.sessionId);
    await assert.rejects(readFile(join(first.workspace, 'first.txt')), { code: 'ENOENT' });
    await harness.select(second.sessionId);
    assert.equal((await harness.snapshot()).running, false);
    const largeRequest = randomUUID();
    await harness.submit(second.sessionId, 'large.txt', largeRequest);
    const large = await waitFor(view => view.decisions.length === 1);
    assert.deepEqual(await harness.pendingDecision(second.sessionId), { state: 'open-on-pc', tool: 'write', reason: 'payload_exceeds_32kib' });
    assert.equal(await harness.resolveDecision(second.sessionId, large.decisions[0].id, preview.revision, true), 'stale');
    const correction = 'Use the smaller export instead.';
    await harness.decide(second.sessionId, large.decisions[0].id, false, correction);
    const declined = await waitFor(view => !view.running);
    assert.ok(declined.entries.some(entry => entry.toolFailure === 'blocked' && entry.text.includes(correction)));
    await assert.rejects(harness.decide(second.sessionId, large.decisions[0].id, true), /no longer waiting/);
    await assert.rejects(readFile(join(second.workspace, 'large.txt')), { code: 'ENOENT' });
    const creationId = randomUUID();
    const [created, duplicate] = await Promise.all([harness.createRemote('consumer-a', creationId), harness.createRemote('consumer-a', creationId)]);
    assert.deepEqual(duplicate, created);
    assert.equal((await harness.snapshot()).sessionId, second.sessionId);
    await harness.close();
    harness = await openHarness(services, new AbortController().signal);
    assert.deepEqual(await harness.createRemote('consumer-a', creationId), created);
    assert.notEqual((await harness.createRemote('consumer-b', creationId)).id, created.id);
    assert.deepEqual(await harness.pendingDecision(created.id), { state: 'none' });
    assert.equal(JSON.parse(await readProgress(created.id)).stage, 'idle');
    assert.equal(await harness.stopInput(created.id, randomUUID()), 'not-found');
    await assert.rejects(readFile(join(folder, 'session-' + created.id + '.sqlite')), { code: 'ENOENT' });
    await assert.rejects(harness.select(randomUUID()), /Unknown Harness session/);
  } finally {
    await harness?.close();
    await rm(folder, { recursive: true, force: true });
  }
});
