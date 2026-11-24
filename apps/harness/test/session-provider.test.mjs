import assert from 'node:assert/strict';
import test from 'node:test';
import { serveSessions } from '../dist-electron/session-provider.js';

test('a provider batch separates read and write operations and reports a receipt without task contents', async () => {
  const account = new AbortController();
  const requestId = 'ab303785-9617-4e18-b4be-58296fc4d6e0';
  const sessionId = 'main';
  const targetRef = 'registered-source';
  const inputs = [
    { operation: 'session.submit', input: { sessionId, requestId, text: 'Summarize' } },
    { operation: 'session.inputStatus', input: { sessionId, requestId } },
    { operation: 'session.submit', input: { sessionId, requestId, text: '文'.repeat(30000) } },
    { operation: 'session.inputStatus', input: { sessionId, requestId }, targetRef: 'another-source' },
    { operation: 'session.stopInput', input: { sessionId, requestId } },
  ];
  let polled = false;
  const completed = [];
  const admitted = [];
  const sessions = {
    async stopInput(id, key) { assert.equal(id, sessionId); assert.equal(key, requestId); return 'requested'; },
    async submit(...args) { admitted.push(args); },
    async inputStatus(id, key) { assert.equal(id, sessionId); assert.equal(key, requestId); return 'placed'; },
  };
  const integration = {
    async registerProvider({ operations }) {
      assert.deepEqual(operations.map(op => [op.name, op.effect]), [
        ['session.list', 'read'],
        ['session.getHistory', 'read'],
        ['session.create', 'write'],
        ['session.submit', 'write'],
        ['session.inputStatus', 'read'],
        ['session.readAnswer', 'read'],
        ['session.stopInput', 'write'],
        ['session.observeProgress', 'read'],
        ['session.reviewDecision', 'read'],
        ['session.resolveDecision', 'write'],
        ['session.listFiles', 'read'],
        ['session.importAttachment', 'write'],
        ['session.downloadResult', 'write'],
      ]);
      return { targetRef };
    },
    async pollProvider() {
      if (polled) { account.abort(); return { calls: [], canceledCallIds: [] }; }
      polled = true;
      return { canceledCallIds: [], calls: inputs.map((row, i) => ({
        operation: row.operation, targetRef: row.targetRef ?? targetRef, callId: String(i), inputJson: JSON.stringify(row.input),
      })) };
    },
    async completeProvider(result) { completed.push(result); },
  };
  await serveSessions(integration, async () => sessions, account.signal);
  assert.deepEqual(admitted, [[sessionId, 'Summarize', requestId]]);
  assert.deepEqual(completed.map(r => r.errorCode), ['', '', 'HARNESS_INPUT_INVALID', 'HARNESS_OPERATION_UNAVAILABLE', '']);
  assert.deepEqual(JSON.parse(completed[4].resultJson), { requestId, outcome: 'requested' });
  assert.deepEqual(JSON.parse(completed[0].resultJson), { requestId });
  assert.deepEqual(JSON.parse(completed[1].resultJson), { requestId, status: 'placed' });
});

test('a later stop is handled while Runtime is still completing an attachment', async () => {
  const account = new AbortController();
  const copying = Promise.withResolvers();
  const release = Promise.withResolvers();
  const stopped = Promise.withResolvers();
  const fileId = 'ab303785-9617-4e18-b4be-58296fc4d6e0';
  const targetRef = 'registered-source';
  let polls = 0;
  const call = (operation, input, extra) => ({ callId: operation, operation, targetRef, inputJson: JSON.stringify(input), ...extra });
  const integration = {
    async registerProvider() { return { targetRef }; },
    async pollProvider() {
      polls++;
      let calls = [];
      if (polls === 1) calls = [call('session.importAttachment', { sessionId: 'main' }, { offeredAsset: { sizeBytes: 8192 } })];
      else if (polls === 2) calls = [call('session.stopInput', { sessionId: 'main', requestId: fileId })];
      else await release.promise;
      return { calls, canceledCallIds: [] };
    },
    async completeProvider(result) {
      if (result.callId === 'session.importAttachment') { copying.resolve(); await release.promise; }
      if (result.callId === 'session.stopInput') stopped.resolve(JSON.parse(result.resultJson));
    },
  };
  const done = serveSessions(integration, async () => ({
    incomingFile: () => ({ fileId, relativePath: 'sessions/main/in/' + fileId }),
    stopInput: async () => 'requested',
  }), account.signal);
  try {
    await copying.promise;
    // A blocked file is deterministic; the control path only needs microtasks to dispatch.
    const observed = await Promise.race([stopped.promise, new Promise(resolve => setImmediate(() => resolve(null)))]);
    assert.deepEqual(observed, { requestId: fileId, outcome: 'requested' });
  } finally {
    account.abort(); release.resolve(); await done;
  }
});

test('nimi.harness.session.v1 handles getHistory, listFiles, feedback resolveDecision, ref downloadResult, and aborted scope isolation', async () => {
  const account = new AbortController();
  const targetRef = 'registered-v1';
  const fileId = 'ab303785-9617-4e18-b4be-58296fc4d6e0';
  const revision = 'a'.repeat(64);
  let polled = false;
  let unregistered = 0;
  const completed = [];
  const resolvedArgs = [];

  const sessions = {
    listDetailed: () => ({
      sessions: [{ id: 'main', title: 'Main', status: 'waiting', hasPendingDecision: true, workspaceLabel: 'demo', updatedAt: 1000 }],
      nextOffset: null,
    }),
    getHistory: async (id, cursor, limit) => ({
      sessionId: id,
      entries: [{ id: '1:0', role: 'user', text: 'Hello' }],
      nextCursor: cursor === 0 && limit === 10 ? 1 : null,
    }),
    listFiles: async () => ({
      items: [{ name: 'report.md', ref: 'report.md', directory: false, size: 128 }],
      next: null,
    }),
    pendingDecision: async () => ({
      state: 'review', taskId: 7, revision, tool: 'edit', title: 'Edit report.md',
      summary: 'Apply 1 replacement to report.md', argumentsJson: '{}',
      diffPreview: { kind: 'edit', path: 'report.md', replacements: [{ oldText: 'a', newText: 'b' }] },
    }),
    resolveDecision: async (...args) => { resolvedArgs.push(args); return 'recorded'; },
    outgoingWorkspaceFile: async (id, ref) => ({
      fileId, name: 'report.md', relativePath: `sessions/${id}/out/${fileId}`,
      source: { mediaType: 'text/markdown', sizeBytes: 128, sha256: 'sha256:abc' },
    }),
  };

  const calls = [
    { callId: 'c1', operation: 'session.list', targetRef, inputJson: JSON.stringify({ offset: 0 }) },
    { callId: 'c2', operation: 'session.getHistory', targetRef, inputJson: JSON.stringify({ sessionId: 'main', cursor: 0, limit: 10 }) },
    { callId: 'c3', operation: 'session.listFiles', targetRef, inputJson: JSON.stringify({ sessionId: 'main' }) },
    { callId: 'c4', operation: 'session.reviewDecision', targetRef, inputJson: JSON.stringify({ sessionId: 'main' }) },
    { callId: 'c5', operation: 'session.resolveDecision', targetRef, inputJson: JSON.stringify({ sessionId: 'main', taskId: 7, revision, allow: false, feedback: 'Keep header intact' }) },
    { callId: 'c6', operation: 'session.downloadResult', targetRef, inputJson: JSON.stringify({ sessionId: 'main', ref: 'report.md' }) },
  ];

  const downloadDone = Promise.withResolvers();
  const integration = {
    async registerProvider() { return { targetRef }; },
    async pollProvider() {
      if (polled) {
        await downloadDone.promise;
        account.abort();
        return { calls: [], canceledCallIds: [] };
      }
      polled = true;
      return { calls, canceledCallIds: [] };
    },
    async completeProvider(result) {
      completed.push(result);
      if (result.callId === 'c6') downloadDone.resolve();
    },
    async unregisterProvider() { unregistered++; },
  };

  await serveSessions(integration, async () => sessions, account.signal);
  // Aborted scope MUST NOT call unregisterProvider on a newly bound session!
  assert.equal(unregistered, 0);
  assert.equal(completed.length, 6);
  assert.equal(JSON.parse(completed[0].resultJson).sessions[0].hasPendingDecision, true);
  assert.equal(JSON.parse(completed[1].resultJson).nextCursor, 1);
  assert.equal(JSON.parse(completed[2].resultJson).items[0].size, 128);
  assert.equal(JSON.parse(completed[3].resultJson).diffPreview.kind, 'edit');
  assert.deepEqual(resolvedArgs, [['main', 7, revision, false, 'Keep header intact']]);
  assert.equal(JSON.parse(completed[5].resultJson).fileId, fileId);
  assert.equal(JSON.parse(completed[5].resultJson).name, 'report.md');
  assert.equal(completed[5].asset.relativePath, `sessions/main/out/${fileId}`);
});

test('serveSessions registers versioned ai.nimi.harness.sessions.v1, retries transient poll failures, and skips unregister on session invalidation', async () => {
  const account = new AbortController();
  const targetRef = 'registered-v1-retry';
  let registeredId = '';
  let pollAttempt = 0;
  let unregistered = 0;
  const completed = [];

  const integration = {
    async registerProvider(input) {
      registeredId = input.integrationId;
      return { targetRef };
    },
    async pollProvider() {
      pollAttempt++;
      if (pollAttempt === 1) {
        throw Object.assign(new Error('temporary network hiccup'), { reasonCode: 'unavailable' });
      }
      if (pollAttempt === 2) {
        return {
          canceledCallIds: [],
          calls: [{ callId: 'ok-1', operation: 'session.list', targetRef, inputJson: JSON.stringify({ offset: 0 }) }],
        };
      }
      throw Object.assign(new Error('session ended'), { reasonCode: 'session-invalid' });
    },
    async completeProvider(result) { completed.push(result); },
    async unregisterProvider() { unregistered++; },
  };

  await serveSessions(
    integration,
    async () => ({ listDetailed: () => ({ sessions: [{ id: 's1', title: 'S1' }], nextOffset: null }) }),
    account.signal,
    { retryBackoffMs: 1 },
  );

  assert.equal(registeredId, 'ai.nimi.harness.sessions.v1');
  assert.equal(pollAttempt, 3);
  assert.equal(completed.length, 1);
  assert.equal(JSON.parse(completed[0].resultJson).sessions[0].id, 's1');
  assert.equal(unregistered, 0);
});
