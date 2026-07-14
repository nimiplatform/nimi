import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiAppRuntimePlatformClient,
  type NimiAppRuntimePlatformStandardShell,
} from './local-app-runtime-platform';

function standardShell(
  overrides: Partial<NimiAppRuntimePlatformStandardShell> = {},
): NimiAppRuntimePlatformStandardShell {
  const base: NimiAppRuntimePlatformStandardShell = {
    session: {
      async status() {
        return { state: 'zero-grant', reasonCode: 'no-grant', retryable: false };
      },
    },
    permission: {
      async posture(input) {
        return {
          state: 'zero-grant',
          ...input,
          reasonCode: 'no-grant',
          actionHint: 'request_local_app_operation_grant',
          retryable: false,
        };
      },
      async request(input) {
        return {
          state: 'pending',
          operationId: input.operationId,
          resourceRef: input.resourceRef,
          reasonCode: 'no-grant',
          actionHint: 'await_local_app_grant_decision',
          retryable: true,
        };
      },
    },
    artifacts: {
      async readRuntimeBytes() {
        return { bytes: new Uint8Array([1, 2]), mimeType: 'text/plain', sizeBytes: 2, mimeInferred: false };
      },
    },
    agent: {
      async openConversation() { return {}; },
      async sendTurn() { return {}; },
      async subscribeTurn() { return {}; },
      async getConversationSnapshot() { return {}; },
    },
  };
  return { ...base, ...overrides };
}

test('local-app Runtime platform client consumes the nested Kit zero-grant posture', async () => {
  const client = createNimiAppRuntimePlatformClient({ standardShell: standardShell() });
  assert.deepEqual(await client.auth.status(), {
    mode: 'local-app',
    state: 'session-bound-zero-grant',
    sessionBound: true,
    operationAllowed: false,
    reasonCode: 'no-grant',
    actionHint: 'request_local_app_operation_grant',
    retryable: false,
  });
  assert.equal((await client.permissions.posture({
    operationId: 'runtime-agent.send-turn',
    resourceRef: 'agent-a',
  })).state, 'zero-grant');
  assert.equal((await client.permissions.request({
    operationId: 'runtime_agent.conversation.turn.send',
    resourceRef: 'agent:agent-a/conversation:anchor-a',
    purpose: 'Continue this conversation from the isolated Zhiyu build',
  })).state, 'pending');
});

test('local-app Runtime platform client exposes only the selected typed operation set', async () => {
  const client = createNimiAppRuntimePlatformClient({ standardShell: standardShell() });
  assert.deepEqual(Object.keys(client).sort(), ['agent', 'artifacts', 'auth', 'permissions']);
  assert.deepEqual(Object.keys(client.agent).sort(), [
    'getConversationSnapshot', 'openConversation', 'sendTurn', 'subscribeTurn',
  ]);
  assert.deepEqual(await client.artifacts.readRuntimeBytes('artifact:one'), {
    bytes: new Uint8Array([1, 2]), mimeType: 'text/plain', sizeBytes: 2, mimeInferred: false,
  });
});

test('local-app subscribeTurn is an honest cursor pull, not a cast Promise stream', async () => {
  const client = createNimiAppRuntimePlatformClient({
    standardShell: standardShell({
      agent: {
        async openConversation() { return {}; },
        async sendTurn() { return {}; },
        async subscribeTurn() {
          return {
            cursor: '7',
            events: [{
              eventType: 1,
              sequence: '7',
              messageId: 'message-a',
              messageType: 'runtime.agent.turn.text_delta',
              payload: {
                localAgentRef: 'agent-a',
                conversationAnchorId: 'anchor-a',
                turnId: 'turn-a',
                streamId: 'stream-a',
                detail: { textDelta: 'hello' },
              },
              reasonCode: 1,
              traceId: '',
              timestamp: null,
            }],
          };
        },
        async getConversationSnapshot() { return {}; },
      },
    }),
  });
  const page = await client.agent.subscribeTurn({ agentId: 'agent-a', conversationAnchorId: 'anchor-a' });
  assert.equal(page.cursor, '7');
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0].eventName, 'runtime.agent.turn.text_delta');
  assert.equal(page.events[0].conversationAnchorId, 'anchor-a');
});

test('local-app Runtime platform client rejects portable authority material and expanded shell surfaces', async () => {
  const client = createNimiAppRuntimePlatformClient({ standardShell: standardShell() });
  await assert.rejects(
    () => client.agent.sendTurn({ session_id: 'forged' } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
  );
  assert.throws(
    () => createNimiAppRuntimePlatformClient({ standardShell: standardShell(), endpoint: 'forged' } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  assert.throws(
    () => createNimiAppRuntimePlatformClient({
      standardShell: { ...standardShell(), runtime: { unary: async () => ({}) } },
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
});

test('local-app Runtime platform client rejects host pseudo-success flags', async () => {
  const client = createNimiAppRuntimePlatformClient({
    standardShell: standardShell({
      session: {
        async status() {
          return { state: 'zero-grant', reasonCode: 'no-grant', retryable: false, operationAllowed: true };
        },
      },
    }),
  });
  await assert.rejects(
    () => client.auth.status(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});
