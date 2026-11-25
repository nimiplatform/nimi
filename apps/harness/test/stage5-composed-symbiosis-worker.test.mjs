import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NimiElectronLocalAppHostError } from '@nimiplatform/kit/shell/electron/main';
import { ReasonCode } from '@nimiplatform/sdk/runtime/generated';
import {
  attachHarnessEngineWorker,
  HarnessEngineWorkerClient,
} from '../dist-electron/engine-worker.js';
import { openHarness } from '../dist-electron/harness.js';
import { HarnessBodySymbiosisClient } from '../dist-electron/body-symbiosis.js';
import { SecureWorkspaceExecutionEnv } from '../dist-electron/secure-workspace-env.js';

function createLinkedWorkerPorts() {
  const hostBus = new EventEmitter();
  const workerBus = new EventEmitter();
  let closed = false;

  const workerPort = {
    on(event, listener) {
      workerBus.on(event, listener);
    },
    postMessage(msg) {
      if (closed) return;
      const cloned = structuredClone(msg);
      queueMicrotask(() => hostBus.emit('message', cloned));
    },
  };

  const hostProc = {
    on(event, listener) {
      hostBus.on(event, listener);
    },
    postMessage(msg) {
      if (closed) return;
      const cloned = structuredClone(msg);
      queueMicrotask(() => workerBus.emit('message', { data: cloned }));
    },
    kill() {
      if (closed) return false;
      closed = true;
      queueMicrotask(() => hostBus.emit('exit', 0));
      return true;
    },
    simulateCrash(code = 137) {
      if (closed) return;
      closed = true;
      queueMicrotask(() => hostBus.emit('exit', code));
    },
  };

  return { workerPort, hostProc };
}

function createInMemoryStorage() {
  const kv = new Map();
  return {
    async readJson(relativePath) {
      if (!kv.has(relativePath)) {
        throw new NimiElectronLocalAppHostError('not-found', false);
      }
      return { value: structuredClone(kv.get(relativePath)) };
    },
    async writeJson(relativePath, value) {
      kv.set(relativePath, structuredClone(value));
      return { value: structuredClone(value) };
    },
    async removeJson(relativePath) {
      kv.delete(relativePath);
    },
    assets: {
      async stat() { throw new NimiElectronLocalAppHostError('not-found', false); },
      async list() { return { items: [], nextCursor: '' }; },
      async remove() {},
      async move() {},
      async reveal() {},
      async adoptArtifact() { throw new Error('unused'); },
      async write() { throw new Error('unused'); },
      async read() { throw new Error('unused'); },
    },
  };
}

async function waitFor(predicate, timeoutMs = 8000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const val = await predicate();
    if (val) return val;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise(r => setTimeout(r, 25));
  }
}

test('Stage 5 composed: utilityProcess engine worker + real pi-durable + native openBinaryReader + single-auth write + zero 404 startup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nimi-stage5-worker-'));
  const dataRoot = join(root, 'data');
  const workspaceRoot = join(root, 'workspace');
  await rm(workspaceRoot, { recursive: true, force: true });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, 'notes.txt'), 'line-1\nline-2\nline-3\n', 'utf8');

  const projections = [];
  const authorizeCalls = [];
  const ackedOutboxIds = [];
  const stepRequests = [];
  let pushOutbox;
  let outboxClosed = false;

  const outboxQueue = [];
  const outboxWaiters = [];
  pushOutbox = (env) => {
    const w = outboxWaiters.shift();
    if (w) w({ value: env, done: false });
    else outboxQueue.push(env);
  };

  let stepCounter = 0;
  const agentSession = {
    async registerBodyCarrier(req) {
      assert.equal(req.capabilityNamespace, 'os.pc.workspace');
      return { leaseEpoch: '1', effectiveContextBudgetTokens: 64000, pendingTombstones: [] };
    },
    async heartbeatBodyCarrier() {
      return { alive: true, renewed: true, leaseEpoch: '1' };
    },
    async unregisterBodyCarrier() {
      return { unregistered: true };
    },
    subscribeBodyOutbox(_req, opts) {
      return {
        async *[Symbol.asyncIterator]() {
          const onAbort = () => {
            outboxClosed = true;
            while (outboxWaiters.length) outboxWaiters.shift()({ value: undefined, done: true });
          };
          opts?.signal?.addEventListener('abort', onAbort, { once: true });
          try {
            while (!outboxClosed && !opts?.signal?.aborted) {
              if (outboxQueue.length > 0) {
                yield outboxQueue.shift();
              } else {
                const next = await new Promise(resolve => outboxWaiters.push(resolve));
                if (next.done) break;
                yield next.value;
              }
            }
          } finally {
            opts?.signal?.removeEventListener('abort', onAbort);
          }
        },
      };
    },
    async ackBodyOutbox(req) {
      ackedOutboxIds.push(req.outboxId);
      return { acked: true };
    },
    async reportBodySessionProjection(req) {
      projections.push(structuredClone(req));
      return { applied: true };
    },
    async authorizeBodySideEffect(req) {
      authorizeCalls.push(structuredClone(req));
      return { authorized: true };
    },
    async deleteSession() {
      return { deleted: true };
    },
    streamLocalAgentBodyStep(req) {
      stepRequests.push(structuredClone(req));
      stepCounter += 1;
      const currentStep = stepCounter;
      return {
        async *[Symbol.asyncIterator]() {
          // Verify zero Body-authored system messages ever reach Runtime!
          for (const msg of req.workingMessages ?? []) {
            assert.notEqual(msg.role, 'system', 'Body must never send role=system');
          }
          if (currentStep === 1) {
            // Step 1: exercise real pi-durable `read` tool -> SecureWorkspaceExecutionEnv.openBinaryReader
            yield {
              payload: {
                oneofKind: 'toolCall',
                toolCall: {
                  callId: 'call-read-1',
                  name: 'read',
                  argumentsJson: JSON.stringify({ path: 'notes.txt' }),
                },
              },
            };
            yield {
              payload: {
                oneofKind: 'done',
                done: {
                  finishReason: 'tool_calls',
                  usageInputTokens: '120',
                  usageOutputTokens: '25',
                  stepMac: 'mac-1',
                  compactionSummary: '',
                  postCompactionMac: '',
                  effectiveContextBudgetTokens: 64000,
                },
              },
            };
            return;
          }
          if (currentStep === 2) {
            // Verify step 1 read tool returned real contents via native openBinaryReader!
            const toolMsg = (req.workingMessages ?? []).find(m => m.role === 'tool' && m.toolCallId === 'call-read-1');
            assert.ok(toolMsg, 'expected tool result from read tool');
            assert.match(toolMsg.contentJson, /line-1/);
            assert.match(toolMsg.contentJson, /line-3/);
            // Step 2: issue write tool requiring explicit PC approval + Runtime AuthorizeBodySideEffect!
            yield {
              payload: {
                oneofKind: 'toolCall',
                toolCall: {
                  callId: 'call-write-1',
                  name: 'write',
                  argumentsJson: JSON.stringify({ path: 'output.txt', content: 'verified-v2.1-write' }),
                },
              },
            };
            yield {
              payload: {
                oneofKind: 'done',
                done: {
                  finishReason: 'tool_calls',
                  usageInputTokens: '200',
                  usageOutputTokens: '40',
                  stepMac: 'mac-2',
                  compactionSummary: '',
                  postCompactionMac: '',
                  effectiveContextBudgetTokens: 64000,
                },
              },
            };
            return;
          }
          // Step 3: final assistant response after write succeeds!
          yield { payload: { oneofKind: 'textDelta', textDelta: 'Wrote output.txt successfully.' } };
          yield {
            payload: {
              oneofKind: 'done',
              done: {
                finishReason: 'stop',
                usageInputTokens: '260',
                usageOutputTokens: '15',
                stepMac: 'mac-3',
                compactionSummary: '',
                postCompactionMac: '',
                effectiveContextBudgetTokens: 64000,
              },
            },
          };
        },
      };
    },
  };

  const services = {
    storage: createInMemoryStorage(),
    agentSession,
    activity: { async put() { return {}; } },
    aiConfig: {
      async get() { throw new Error('aiConfig.get must not be called in requireSymbiosis mode'); },
    },
    integration: {
      async listCatalog() { return { items: [] }; },
      async listConnections() { return { connections: [] }; },
      async registerProvider() { return {}; },
      async unregisterProvider() { return {}; },
      async pollProvider() {
        await new Promise(r => setTimeout(r, 100));
        return { calls: [] };
      },
      async completeProvider() { return {}; },
    },
    ai: {
      artifacts: { async read() { throw new Error('unused'); }, async upload() { throw new Error('unused'); } },
    },
  };

  const { workerPort, hostProc } = createLinkedWorkerPorts();
  const workerHost = attachHarnessEngineWorker(workerPort);
  let crashedCode;
  const client = new HarnessEngineWorkerClient(hostProc, {
    onCrash: code => { crashedCode = code; },
  });

  try {
    // Verify ping over utilityProcess RPC
    const pong = await client.request({ kind: 'ping' });
    assert.equal(pong.pong, true);

    // Activate account session inside worker
    client.activateSession(services, {
      dataRoot,
      requireSymbiosis: true,
      allowInsecureTestFallback: false,
    });

    // Fresh startup must NEVER report an unbound local 'main' session to Runtime!
    await new Promise(r => setTimeout(r, 200));
    assert.equal(
      projections.some(p => p.workSessionRef === 'main'),
      false,
      'must not report unbound local main placeholder on fresh startup',
    );

    // Legacy paths must fail closed in requireSymbiosis mode!
    await assert.rejects(
      client.callEngine('importHome', ['{"title":"x","messages":[]}']),
      /retired in Brain-Body Symbiosis mode/,
    );
    await assert.rejects(
      client.callEngine('reviewModel', ['main']),
      /managed by Nimi Home and Runtime/,
    );

    // Push inbound NEW_INTENT with handoffHistory + handoffBriefText + workspaceRoot!
    const workSessionRef = `ws-${randomUUID()}`;
    const outboxId = randomUUID();
    pushOutbox({
      outboxId,
      workSessionRef,
      agentBinding: 'binding-alpha',
      commandKind: 1, // NEW_INTENT
      payloadJson: JSON.stringify({
        text: 'Read notes.txt and write output.txt',
        title: 'Stage 5 Composed Task',
        workspaceRoot,
        permissionMode: 'strict',
        handoffBriefText: 'User requested file verification.',
        handoffHistory: [{ role: 'user', text: 'Prior Home chat turn' }],
      }),
    });

    // Wait for read tool to finish automatically and write tool to park on explicit PC decision!
    const waitingSnapshot = await waitFor(async () => {
      const snap = await client.callEngine('snapshot');
      return snap.decisions?.length > 0 ? snap : null;
    }, 10_000, 'write tool approval decision');

    assert.equal(waitingSnapshot.decisions.length, 1);
    const dec = waitingSnapshot.decisions[0];
    assert.equal(dec.name, 'write');
    assert.ok(dec.revision && /^[a-f0-9]{64}$/.test(dec.revision));
    assert.ok(ackedOutboxIds.includes(outboxId), 'NEW_INTENT should be ACKed');
    assert.ok(
      waitingSnapshot.entries.some(e => e.fromHome && e.text.includes('Prior Home chat turn')),
      'handoffHistory must be imported into durable transcript',
    );

    // Approve write decision over utilityProcess RPC!
    await client.callEngine('decide', [waitingSnapshot.sessionId, dec.id, true, undefined, false, dec.revision]);

    // Wait for write to execute and step 3 final assistant message to complete!
    const doneSnapshot = await waitFor(async () => {
      const snap = await client.callEngine('snapshot');
      const hasFinal = snap.entries?.some(e => e.role === 'assistant' && e.text.includes('Wrote output.txt successfully.'));
      return hasFinal && !snap.running ? snap : null;
    }, 10_000, 'final assistant completion');

    // Verify file written cleanly via native security host + snapshot recorded!
    const written = await readFile(join(workspaceRoot, 'output.txt'), 'utf8');
    assert.equal(written, 'verified-v2.1-write');
    assert.equal(doneSnapshot.snapshots.length, 1);

    // Verify AuthorizeBodySideEffect was called ONCE with real callId and canonical payloadHash!
    assert.equal(authorizeCalls.length, 1, 'AuthorizeBodySideEffect must be called exactly once (no double call, no empty callId)');
    assert.equal(authorizeCalls[0].callId, 'call-write-1');
    assert.equal(authorizeCalls[0].toolName, 'write');
    assert.equal(authorizeCalls[0].workSessionRef, workSessionRef);
    assert.equal(authorizeCalls[0].actionKind, 'file_write');
    const expectedHash = createHash('sha256')
      .update(JSON.stringify({ content: 'verified-v2.1-write', path: 'output.txt' }))
      .digest('hex');
    assert.equal(authorizeCalls[0].payloadHash, expectedHash);

    // Verify pendingAttention was reported on waiting status!
    assert.ok(
      projections.some(p => p.workSessionRef === workSessionRef && p.pendingAttention?.attentionKind === 'tool_approval'),
      'waiting status must report pendingAttention in projection',
    );

    // Verify worker crash fails closed cleanly without auto-replay!
    hostProc.simulateCrash(137);
    await waitFor(() => crashedCode === 137, 2000, 'worker crash callback');
    await assert.rejects(
      client.callEngine('snapshot'),
      /exited unexpectedly \(code=137\)/,
    );
  } finally {
    await workerHost.dispose().catch(() => {});
    client.close();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test('Stage 5 composed: SecureWorkspaceExecutionEnv blocks rogue side effects without grant & filters openDirReader/exists on .envrc', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nimi-stage5-env-'));
  const dataRoot = join(root, 'data');
  const workspaceRoot = join(root, 'workspace');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, 'visible.txt'), 'hello\nworld', 'utf8');
  await writeFile(join(workspaceRoot, '.envrc'), 'export SECRET=topsecret123', 'utf8');

  const env = new SecureWorkspaceExecutionEnv({
    sessionId: 'sec-test',
    workspaceRoot,
    explicitDevWorkspace: false,
    dataRoot,
    authorizeSideEffect: async () => {
      throw new Error('Side effect denied fail-closed: missing Runtime tool authorization grant');
    },
  });

  try {
    const ctx = {};
    // exists() must NEVER disclose sensitive .envrc
    const envrcExists = await env.exists('.envrc', ctx);
    assert.equal(envrcExists.ok, true);
    assert.equal(envrcExists.value, false);

    // openDirReader must filter out .envrc
    const dirReaderRes = await env.openDirReader('.', ctx);
    assert.equal(dirReaderRes.ok, true);
    const page = await dirReaderRes.value.next(50, ctx);
    assert.equal(page.ok, true);
    assert.equal(page.value.entries.some(e => e.name === '.envrc'), false);
    assert.equal(page.value.entries.some(e => e.name === 'visible.txt'), true);
    await dirReaderRes.value.close(ctx);

    // openTextLineReader must follow pi-durable TextLineReader contract (readLine -> { text, terminated })
    const lineReaderRes = await env.openTextLineReader('visible.txt', ctx);
    assert.equal(lineReaderRes.ok, true);
    const l1 = await lineReaderRes.value.readLine(ctx);
    const l2 = await lineReaderRes.value.readLine(ctx);
    const l3 = await lineReaderRes.value.readLine(ctx);
    assert.deepEqual(l1.value, { text: 'hello', terminated: true });
    assert.deepEqual(l2.value, { text: 'world', terminated: false });
    assert.equal(l3.value, undefined);
    await lineReaderRes.value.close(ctx);

    // Non-dev workspace must block interpreter & git -c shell escapes!
    const gitEscape = await env.exec(['git', '-c', 'core.pager=sh -c id', 'status'], undefined, ctx);
    assert.equal(gitEscape.ok, false);
    const envEscape = await env.exec(['env', 'sh'], undefined, ctx);
    assert.equal(envEscape.ok, false);

    // Rogue write without beforeTool grant must fail closed!
    const rogueWrite = await env.writeFile('pwn.txt', 'bad', ctx);
    assert.equal(rogueWrite.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test('Stage 5 composed: HarnessBodySymbiosisClient enforces tombstone barrier & rejects unknown commandKind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nimi-stage5-purge-'));
  const acks = [];
  const handledIntents = [];
  let failPurge = true;
  let purgeAttempts = 0;
  let streamOpens = 0;

  const client = new HarnessBodySymbiosisClient({
    deviceId: 'pc-test-device',
    client: {
      async registerBodyCarrier() {
        return {
          leaseEpoch: String(streamOpens + 2),
          effectiveContextBudgetTokens: 32000,
          pendingTombstones: [],
        };
      },
      async heartbeatBodyCarrier() { return { alive: true, renewed: true, leaseEpoch: '2' }; },
      async unregisterBodyCarrier() { return { unregistered: true }; },
      async ackBodyOutbox(req) {
        acks.push(req.outboxId);
        return { acked: true };
      },
      subscribeBodyOutbox() {
        streamOpens += 1;
        const openNo = streamOpens;
        return {
          async *[Symbol.asyncIterator]() {
            if (openNo === 1) {
              yield { outboxId: 'unk-1', workSessionRef: 'ws-1', agentBinding: 'b1', commandKind: 99, payloadJson: '{}' };
              yield { outboxId: 'purge-1', workSessionRef: 'ws-1', agentBinding: 'b1', commandKind: 3, payloadJson: '{}' };
              // Strict tombstone barrier: this NEW_INTENT MUST NOT run on stream 1 after purge-1 fails!
              yield { outboxId: 'intent-after-failed-purge', workSessionRef: 'ws-1', agentBinding: 'b1', commandKind: 1, payloadJson: '{"text":"blocked"}' };
            } else {
              if (!acks.includes('purge-1')) {
                yield { outboxId: 'purge-1', workSessionRef: 'ws-1', agentBinding: 'b1', commandKind: 3, payloadJson: '{}' };
              }
              if (!acks.includes('intent-after-purge-ok')) {
                yield { outboxId: 'intent-after-purge-ok', workSessionRef: 'ws-1', agentBinding: 'b1', commandKind: 1, payloadJson: '{"text":"allowed"}' };
              }
              await new Promise(r => setTimeout(r, 5000));
            }
          },
        };
      },
    },
    handlers: {
      async onPurgeSession() {
        purgeAttempts += 1;
        if (failPurge) {
          failPurge = false;
          throw new Error('EBUSY: sqlite file locked');
        }
      },
      async onPurgeAgent() {},
      async onInvalidateMemory() {},
      async onNewIntent(env) {
        handledIntents.push(env.outboxId);
      },
      async onReconcileAfterTombstones() { return []; },
    },
  });

  const ac = new AbortController();
  try {
    await client.start(ac.signal);
    await waitFor(() => acks.includes('intent-after-purge-ok'), 5000, 'purge-1 retry + post-purge intent ACK');
    assert.equal(acks.includes('unk-1'), false, 'unknown commandKind must NEVER be ACKed');
    assert.equal(handledIntents.includes('intent-after-failed-purge'), false, 'NEW_INTENT must NEVER execute behind a failed tombstone');
    assert.equal(purgeAttempts, 2, 'failed purge must not be ACKed and must retry on reconnect');
    assert.deepEqual(acks, ['purge-1', 'intent-after-purge-ok']);
  } finally {
    ac.abort();
    await client.stop().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test('losing the lease on an outbox ACK revokes readiness until the next registration drains tombstones', async () => {
  const lost = [];
  const acks = [];
  const barrier = Promise.withResolvers();
  let epoch = 0;
  let purgeStarted = false;
  const intent = { outboxId: 'intent-1', commandKind: 1, workSessionRef: 'ws-1', payloadJson: '{}' };
  const client = new HarnessBodySymbiosisClient({
    deviceId: 'pc-1',
    client: {
      async registerBodyCarrier() {
        epoch++;
        return { leaseEpoch: String(epoch), pendingTombstones: epoch === 2
          ? [{ outboxId: 'purge-2', commandKind: 3, workSessionRef: 'ws-2' }] : [] };
      },
      async unregisterBodyCarrier() {},
      async *subscribeBodyOutbox() { yield intent; },
      async ackBodyOutbox(req) {
        if (req.leaseEpoch === '1') throw new Error('AGENT_BODY_LEASE_CONFLICT');
        acks.push(req.outboxId);
        return { acked: true };
      },
    },
    handlers: {
      onLeaseLost(reason) { lost.push(reason); },
      async onNewIntent() {},
      async onReconcileAfterTombstones() { return []; },
      async onPurgeSession() { purgeStarted = true; await barrier.promise; },
    },
  });
  const ac = new AbortController();
  try {
    await client.start(ac.signal);
    await waitFor(() => !client.isRunning(), 3000, 'ACK loses first lease');
    assert.deepEqual(lost, ['AGENT_BODY_LEASE_CONFLICT']);
    let ready = false;
    const waiting = client.waitUntilReady().then(() => { ready = true; });
    await waitFor(() => purgeStarted, 5000, 'replacement lease starts draining');
    assert.equal(ready, false);
    assert.equal(client.isReadyForProjections(), false);
    barrier.resolve();
    await waiting;
    await waitFor(() => acks.includes('intent-1'), 3000, 'intent replay acknowledged');
    assert.deepEqual(acks, ['purge-2', 'intent-1']);
    assert.equal(client.isReadyForProjections(), true);
    assert.equal(lost.length, 1);
  } finally {
    barrier.resolve();
    ac.abort();
    await client.stop();
  }
});

test('Stage 5 composed: standalone empty-dir first submit discovers Partner handle, deduplicates concurrent outbox NEW_INTENT, sends outboxId, and emits milestone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nimi-stage5-standalone-'));
  const dataRoot = join(root, 'data');
  const routeCalls = [];
  const stepRequests = [];
  const projections = [];
  let firstMilestone = true;
  let stepFailureCode;
  const outboxQueue = [];
  const outboxWaiters = [];
  let outboxClosed = false;
  const pushOutbox = env => {
    const w = outboxWaiters.shift();
    if (w) w({ value: env, done: false });
    else outboxQueue.push(env);
  };

  const partnerHandle = `agent_ref_${'a'.repeat(43)}`;
  const partnerBinding = `agent_binding_${'b'.repeat(43)}`;
  const allocatedWorkSessionRef = `ws-standalone-${randomUUID()}`;
  const allocatedOutboxId = `ob-${randomUUID()}`;

  const services = {
    storage: createInMemoryStorage(),
    agentWork: {
      async listReferences() {
        return [{
          agentHandle: partnerHandle,
          agentBinding: partnerBinding,
          activityAgentRef: 'agr_test1',
          displayName: 'Alpha Partner',
          avatarUrl: null,
        }];
      },
    },
    agentSession: {
      async registerBodyCarrier() {
        return { leaseEpoch: '1', effectiveContextBudgetTokens: 64000, pendingTombstones: [] };
      },
      async heartbeatBodyCarrier() { return { alive: true, renewed: true, leaseEpoch: '1' }; },
      async unregisterBodyCarrier() { return { unregistered: true }; },
      subscribeBodyOutbox(_req, opts) {
        return {
          async *[Symbol.asyncIterator]() {
            const onAbort = () => {
              outboxClosed = true;
              while (outboxWaiters.length) outboxWaiters.shift()({ value: undefined, done: true });
            };
            opts?.signal?.addEventListener('abort', onAbort, { once: true });
            try {
              while (!outboxClosed && !opts?.signal?.aborted) {
                if (outboxQueue.length > 0) yield outboxQueue.shift();
                else {
                  const next = await new Promise(r => outboxWaiters.push(r));
                  if (next.done) break;
                  yield next.value;
                }
              }
            } finally {
              opts?.signal?.removeEventListener('abort', onAbort);
            }
          },
        };
      },
      async ackBodyOutbox() { return { acked: true }; },
      async reportBodySessionProjection(req) {
        projections.push(structuredClone(req));
        if (firstMilestone && req.milestoneKind) {
          firstMilestone = false;
          throw new Error('test transport lost projection receipt');
        }
        return { applied: true };
      },
      async routeAndSubmitInput(req) {
        routeCalls.push(structuredClone(req));
        const outboxId = routeCalls.length === 1 ? allocatedOutboxId : allocatedOutboxId + "-" + routeCalls.length;
        // Simulate Runtime concurrently pushing NEW_INTENT before routeAndSubmitInput returns!
        pushOutbox({
          outboxId,
          workSessionRef: allocatedWorkSessionRef,
          agentBinding: partnerBinding,
          commandKind: 1,
          payloadJson: JSON.stringify({
            text: req.text,
            agentHandle: req.agentHandle,
            permissionMode: 'strict',
          }),
        });
        await new Promise(r => setTimeout(r, 30));
        return {
          resolvedWorkSessionRef: allocatedWorkSessionRef,
          outboxId,
          workSessionRecord: { agentBinding: partnerBinding },
        };
      },
      streamLocalAgentBodyStep(req) {
        stepRequests.push(structuredClone(req));
        const reasonCode = stepFailureCode;
        return {
          async *[Symbol.asyncIterator]() {
            if (reasonCode !== undefined) {
              yield { payload: { oneofKind: 'failed', failed: { reasonCode, message: 'Cannot execute this step.' } } };
              return;
            }
            yield { payload: { oneofKind: 'textDelta', textDelta: 'Standalone task finished cleanly.' } };
            yield {
              payload: {
                oneofKind: 'done',
                done: {
                  finishReason: 'stop',
                  usageInputTokens: '80',
                  usageOutputTokens: '12',
                  stepMac: 'mac-standalone-1',
                  compactionSummary: '',
                  postCompactionMac: '',
                  effectiveContextBudgetTokens: 64000,
                },
              },
            };
          },
        };
      },
    },
    activity: { async put() { return {}; } },
    aiConfig: { async get() { throw new Error('unused'); } },
    integration: {
      async listCatalog() { return { items: [] }; },
      async listConnections() { return { connections: [] }; },
      async registerProvider() { return {}; },
      async unregisterProvider() { return {}; },
      async pollProvider() {
        await new Promise(r => setTimeout(r, 100));
        return { calls: [] };
      },
      async completeProvider() { return {}; },
    },
    ai: {
      artifacts: { async read() { throw new Error('unused'); }, async upload() { throw new Error('unused'); } },
    },
  };

  const { workerPort, hostProc } = createLinkedWorkerPorts();
  const workerHost = attachHarnessEngineWorker(workerPort);
  const client = new HarnessEngineWorkerClient(hostProc);

  try {
    client.activateSession(services, {
      dataRoot,
      requireSymbiosis: true,
      allowInsecureTestFallback: false,
    });
    // Wait briefly for symbiosis startup + Partner reference discovery
    await new Promise(r => setTimeout(r, 150));

    // User opens standalone Harness with empty dataRoot and immediately submits on 'main'!
    await client.callEngine('submit', ['main', 'Inspect standalone startup flow', randomUUID(), false]);

    const doneSnap = await waitFor(async () => {
      const snap = await client.callEngine('snapshot');
      return snap.entries?.some(e => e.role === 'assistant' && e.text.includes('Standalone task finished cleanly.')) && !snap.running
        ? snap
        : null;
    }, 10_000, 'standalone first submit completion');

    assert.equal(routeCalls.length, 1);
    assert.equal(routeCalls[0].agentHandle, partnerHandle, 'must discover and send real Partner agentHandle');
    assert.equal(routeCalls[0].entrySurface, 'harness_new_session', 'unbound Harness session must request fresh session allocation');
    assert.equal(doneSnap.sessions.length, 1, 'concurrent outbox NEW_INTENT must NOT create a duplicate local session');
    assert.equal(doneSnap.sessions[0].workSessionRef, allocatedWorkSessionRef);
    assert.equal(stepRequests.length, 1, 'prompt must execute exactly once');
    assert.equal(stepRequests[0].agentHandle, partnerBinding, 'a bound Body step uses the Runtime-issued session binding');
    const userMsg = stepRequests[0].workingMessages.find(m => m.role === 'user');
    assert.equal(userMsg?.outboxId, allocatedOutboxId, 'user BodyWorkingMessage must carry authentic Runtime outboxId');
    await waitFor(
      () => projections.some(p => p.workSessionRef === allocatedWorkSessionRef && p.milestoneKind === 'initial_goal'),
      5000,
      'initial_goal milestone projection',
    );
    await waitFor(() => projections.filter(p => p.milestoneKind === 'initial_goal').length >= 2, 8000, 'unconfirmed milestone recovered');
    const retries = projections.filter(p => p.milestoneKind === 'initial_goal');
    assert.ok(JSON.parse(retries[0].latestReceiptJson).milestoneRef);
    assert.equal(retries[0].latestReceiptJson, retries[1].latestReceiptJson);
    // Two identical inputs are distinct Runtime deliveries and keep their identities
    // in the committed prefix and new suffix of the second provider request.
    await client.callEngine('submit', ['main', 'Inspect standalone startup flow', randomUUID(), false]);
    await waitFor(() => stepRequests.length === 2, 5000, 'repeated input reaches provider');
    assert.equal(routeCalls[1].agentHandle, partnerBinding, 'bound sessions must survive rotation of the original handle');
    assert.deepEqual(stepRequests[1].workingMessages.filter(m => m.role === 'user').map(m => m.outboxId),
      [allocatedOutboxId, allocatedOutboxId + '-2']);

    for (const code of ['AI_CONFIG_INVALID', 'AI_PROVIDER_INTERNAL']) {
      stepFailureCode = ReasonCode[code];
      await client.callEngine('submit', ['main', 'Try the step', randomUUID(), false]);
      const failed = await waitFor(async () => {
        const snap = await client.callEngine('snapshot');
        return !snap.running && snap.failureReasonCode === code && snap;
      }, 5000, code);
      assert.equal(failed.failure, 'Cannot execute this step.');
    }

    stepFailureCode = undefined;
    await client.callEngine('submit', ['main', 'Continue after recovery', randomUUID(), false]);
    await waitFor(async () => {
      const snap = await client.callEngine('snapshot');
      return !snap.running && !snap.failure && !snap.failureReasonCode && snap.entries.at(-1)?.text === 'Standalone task finished cleanly.';
    }, 5000, 'successful run clears its predecessor’s failure');

  } finally {
    await workerHost.dispose().catch(() => {});
    client.close();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
