import assert from 'node:assert/strict';
import test from 'node:test';
import { createNimiLocalAppAgentWorkClient, type NimiLocalAppAgentWorkShell } from './local-app-runtime-platform-agent-work.js';
import { createNimiLocalAppConversationClient } from './local-app-runtime-platform-conversation.js';
import { createNimiLocalAppIntegrationClient, type NimiLocalAppIntegrationShell } from './local-app-runtime-platform-integration.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import { validateAgentWork } from './local-app-agent-work-input.js';

const agentHandle = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const scope = { agentHandle, executionId: 'execution-1' };
const execution = { executionId: 'execution-1', workId: 'work-1', state: 'succeeded', outputText: 'A complete result.', reasonCode: '', message: '', sequence: '4' };
const call = { callId: 'call-1', targetRef: 'target-1', operation: 'save', status: 'accepted', resultJson: '', errorCode: '', consumerDisplayName: 'Consumer', createdAt: null, updatedAt: null, targetDisplayName: 'Documents', accountLabel: 'Workspace' };

test('business execution works without invoking any Conversation method and rejects partial success', async () => {
  let output: unknown = execution;
  const client = createNimiLocalAppAgentWorkClient({
    get: async () => ({ execution: output }),
    status: async () => ({ busy: true, ownExecutionId: null }),
  } as unknown as NimiLocalAppAgentWorkShell);
  assert.deepEqual(await client.get(scope), execution);
  assert.deepEqual(await client.status({ agentHandle }), { busy: true, ownExecutionId: null });
  output = { ...execution, state: 'failed' };
  await assert.rejects(client.get(scope));
  output = { ...execution, executionId: 'another-execution' };
  await assert.rejects(client.get(scope));
});

test('Conversation rejects the retired work carrier before sending', async () => {
  let sends = 0;
  const client = createNimiLocalAppConversationClient({ send: async () => { sends++; return { turnId: 'turn-1' }; } } as never);
  await assert.rejects(client.send({ agentHandle, conversationAnchorId: 'anchor-1', requestId: 'request-1', parts: [{ kind: 'text', text: 'work' }], work: {} } as never));
  assert.equal(sends, 0);
  assert.equal('listToolCalls' in client, false);
  assert.equal('submitToolResult' in client, false);
});

test('business tool result validates correlation and ordered execution event scope', async () => {
  let cancellations = 0;
  const client = createNimiLocalAppAgentWorkClient({
    submitToolResult: async () => ({ callId: 'foreign-call' }),
    subscribe: async () => ({
      events: (async function* () {
        yield { executionId: 'execution-1', sequence: '2', type: 'text-delta', delta: 'progress' };
        yield { executionId: 'execution-1', sequence: '2', type: 'text-delta', delta: 'duplicate' };
      })(), cancel: async () => { cancellations++; },
    }),
  } as unknown as NimiLocalAppAgentWorkShell);
  await assert.rejects(client.submitToolResult({ ...scope, callId: 'call-1', resultJson: '{}', isError: false }));
  const stream = await client.subscribe({ ...scope, afterSequence: '1' });
  const received: unknown[] = [];
  await assert.rejects(async () => { for await (const event of stream) received.push(event); });
  assert.equal(received.length, 1);
  assert.equal(cancellations, 1);
});

test('Integration separates accepted and uncertain effects and never resends an invocation', async () => {
  let invokes = 0;
  const client = createNimiLocalAppIntegrationClient({
    invoke: async () => { invokes++; return { call }; },
    getCall: async () => ({ call: { ...call, status: 'unconfirmed', errorCode: 'connection-lost' } }),
  } as unknown as NimiLocalAppIntegrationShell);
  assert.equal((await client.invoke({ targetRef: 'target-1', operation: 'save', inputJson: '{"token":"ordinary business content"}' })).status, 'accepted');
  assert.equal((await client.getCall({ callId: 'call-1' })).status, 'unconfirmed');
  assert.equal(invokes, 1);
  await assert.rejects(client.invoke({ targetRef: 'target-1', operation: 'save', inputJson: '{}', accountId: 'forged' } as never));
  assert.equal(invokes, 1);
});

test('Agent work EOF does not close an already retired Host stream', async () => {
  let closes = 0;
  const client = createNimiLocalAppAgentWorkClient({ subscribe: async () => ({
    events: (async function* () {})(),
    cancel: async () => { closes++; throw new Error('already retired'); },
  }) } as unknown as NimiLocalAppAgentWorkShell);
  const subscription = await client.subscribe(scope);
  for await (const _event of subscription) assert.fail('empty stream');
  await subscription.cancel();
  assert.equal(closes, 0);
});

test('Integration exposes provider bounded polls and rejects authority or unknown result fields', async () => {
  let polls = 0;
  const client = createNimiLocalAppIntegrationClient({
    pollProvider: async () => { polls++; return { calls: [], canceledCallIds: ['call-1'] }; },
    completeProvider: async () => ({ accepted: true, sessionId: 'forbidden' }),
  } as unknown as NimiLocalAppIntegrationShell);
  await assert.rejects(client.pollProvider({ waitMs: 25001 }));
  assert.equal(polls, 0);
  assert.deepEqual(await client.pollProvider({ waitMs: 25000 }), { calls: [], canceledCallIds: ['call-1'] });
  await assert.rejects(client.completeProvider({ callId: 'call-1', resultJson: '{}', errorCode: '' }));
});

test('Integration preserves expired-result facts and accepts the owner one-MiB result bound', async () => {
  const resultJson = JSON.stringify({ text: 'x'.repeat(300 * 1024) });
  const client = createNimiLocalAppIntegrationClient({
    getCall: async () => ({ call: { ...call, status: 'completed', errorCode: 'INTEGRATION_RESULT_EXPIRED' } }),
    completeProvider: async input => { assert.equal(input.resultJson, resultJson); return { accepted: true }; },
  } as unknown as NimiLocalAppIntegrationShell);
  assert.deepEqual(await client.getCall({ callId: 'call-1' }), { ...call, status: 'completed', errorCode: 'INTEGRATION_RESULT_EXPIRED' });
  assert.deepEqual(await client.completeProvider({ callId: 'call-1', resultJson, errorCode: '' }), { accepted: true });
});

test('Integration accepts full bounded schemas and aggregate descriptors, including boolean schemas', async () => {
  const inputSchemaJson = JSON.stringify({ type: 'object', description: 'x'.repeat(48 * 1024) });
  const operations = Array.from({ length: 30 }, (_, index) => ({ name: `read_${index}`, description: '', inputSchemaJson, outputSchemaJson: 'true', effect: 'read', supportsCancel: false, retryPolicy: 'safe' }));
  const target = { targetRef: 'target-1', integrationId: 'example', displayName: 'Example', accountLabel: '', kind: 'app', available: true, operations, skill: '', permittedOperations: [] };
  let registrations = 0;
  const client = createNimiLocalAppIntegrationClient({
    registerProvider: async input => { registrations++; assert.deepEqual(input.operations, operations); return { target }; },
    listCatalog: async () => ({ targets: [target] }),
  } as unknown as NimiLocalAppIntegrationShell);
  const registration = { integrationId: 'example', displayName: 'Example', operations, skill: '' } as Parameters<typeof client.registerProvider>[0];
  assert.deepEqual(await client.registerProvider(registration), target);
  assert.deepEqual(await client.listCatalog(), [target]);
  for (const inputSchemaJson of ['x'.repeat(65537), '[]', 'null']) {
    await assert.rejects(client.registerProvider({ ...registration, operations: [{ ...operations[0]!, inputSchemaJson }] } as typeof registration));
  }
  assert.equal(registrations, 1);
});

test('Agent work allows an optional empty tool description without weakening schema validation', () => {
  const work = { workId: 'work-1', instructions: '', sources: [], tools: [{ name: 'read', description: '', inputSchemaJson: '{"type":"object"}' }] };
  assert.deepEqual(validateAgentWork(work), work);
  assert.throws(() => validateAgentWork({ ...work, tools: [{ ...work.tools[0], inputSchemaJson: 'true' }] }));
});

test('Integration preserves unavailable permission source metadata without turning it into grant input', async () => {
  const development = { consumerRef: 'consumer-dev', appId: 'nimi.go', displayName: 'NimiGo', sourceKind: 'development' };
  const installed = { consumerRef: 'consumer-installed', appId: 'nimi.go', displayName: 'NimiGo', sourceKind: 'installed' };
  const permission = { consumerRef: installed.consumerRef, targetRef: 'target-1', operations: ['read'], consumer: installed };
  let projected = permission;
  let writes = 0;
  const client = createNimiLocalAppIntegrationClient({
    getManagement: async () => ({ targets: [], consumers: [development], permissions: [projected], calls: [] }),
    setPermission: async input => { writes++; return { permission: { ...input, consumer: null } }; },
  } as unknown as NimiLocalAppIntegrationShell);
  const result = await client.getManagement();
  assert.deepEqual(result.consumers, [development]);
  assert.deepEqual(result.permissions[0]?.consumer, installed);
  await assert.rejects(client.setPermission({ ...permission, operations: [] } as never));
  assert.equal(writes, 0);
  await client.setPermission({ consumerRef: installed.consumerRef, targetRef: 'target-1', operations: [] });
  assert.equal(writes, 1);
  projected = { ...permission, consumer: { ...installed, consumerRef: development.consumerRef } };
  await assert.rejects(client.getManagement());
});
