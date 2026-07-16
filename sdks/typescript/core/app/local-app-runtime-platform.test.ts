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
    storage: {
      async readJson() {
        return { value: { version: 1 }, sizeBytes: 13 };
      },
      async writeJson(_relativePath, value) {
        return { value, sizeBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength };
      },
      async removeJson() {
        return { removed: true };
      },
    },
    agent: {
      async inventory() { return { ownerUserId: 'account-a', count: 0, localAgents: [] }; },
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
  assert.deepEqual(Object.keys(client).sort(), ['agent', 'artifacts', 'auth', 'permissions', 'storage']);
  assert.deepEqual(Object.keys(client.agent).sort(), [
    'getConversationSnapshot', 'listInventory', 'openConversation', 'sendTurn', 'subscribeTurn',
  ]);
  assert.deepEqual(await client.artifacts.readRuntimeBytes('artifact:one'), {
    bytes: new Uint8Array([1, 2]), mimeType: 'text/plain', sizeBytes: 2, mimeInferred: false,
  });
});

test('local-app storage accepts only bounded relative JSON operations and exact projections', async () => {
  const calls: unknown[] = [];
  const client = createNimiAppRuntimePlatformClient({
    standardShell: standardShell({
      storage: {
        async readJson(relativePath) {
          calls.push(['read', relativePath]);
          return { value: { token: 'app-owned-content' }, sizeBytes: 29 };
        },
        async writeJson(relativePath, value) {
          calls.push(['write', relativePath, value]);
          return { value, sizeBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength };
        },
        async removeJson(relativePath) {
          calls.push(['remove', relativePath]);
          return { removed: false };
        },
      },
    }),
  });

  assert.deepEqual(await client.storage.readJson('agent-chat/state.json'), {
    value: { token: 'app-owned-content' },
    sizeBytes: 29,
  });
  assert.deepEqual(await client.storage.writeJson('agent-chat/state.json', { version: 2 }), {
    value: { version: 2 },
    sizeBytes: 13,
  });
  assert.deepEqual(await client.storage.removeJson('agent-chat/state.json'), { removed: false });
  assert.deepEqual(calls, [
    ['read', 'agent-chat/state.json'],
    ['write', 'agent-chat/state.json', { version: 2 }],
    ['remove', 'agent-chat/state.json'],
  ]);

  for (const relativePath of ['../state.json', '/state.json', 'agent\\state.json', 'CON.json', 'state.txt']) {
    await assert.rejects(
      () => client.storage.readJson(relativePath),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_STORAGE_PATH_INVALID',
    );
  }
  await assert.rejects(
    () => client.storage.writeJson('state.json', { value: Number.NaN } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_STORAGE_VALUE_INVALID',
  );

  const expanded = createNimiAppRuntimePlatformClient({
    standardShell: standardShell({
      storage: {
        async readJson() { return { value: {}, sizeBytes: 2, path: 'forbidden' }; },
        async writeJson() { return { value: {}, sizeBytes: 2 }; },
        async removeJson() { return { removed: true }; },
      },
    }),
  });
  await assert.rejects(
    () => expanded.storage.readJson('state.json'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('local-app agent inventory accepts only the bounded current-owner projection', async () => {
  const client = createNimiAppRuntimePlatformClient({
    standardShell: standardShell({
      agent: {
        async inventory() {
          return {
            ownerUserId: 'account-a',
            count: 1,
            localAgents: [{
              localAgentRef: 'local-agent:runtime-a',
              displayName: '苏轼',
              ownerUserId: 'account-a',
              runtimeSourceRef: 'runtime-source:a',
              sourceReady: true,
            }],
          };
        },
        async openConversation() { return {}; },
        async sendTurn() { return {}; },
        async subscribeTurn() { return {}; },
        async getConversationSnapshot() { return {}; },
      },
    }),
  });
  assert.deepEqual(await client.agent.listInventory(), {
    ownerUserId: 'account-a',
    count: 1,
    localAgents: [{
      localAgentRef: 'local-agent:runtime-a',
      displayName: '苏轼',
      ownerUserId: 'account-a',
      runtimeSourceRef: 'runtime-source:a',
      sourceReady: true,
    }],
  });

  const invalid = createNimiAppRuntimePlatformClient({
    standardShell: standardShell({
      agent: {
        async inventory() {
          return { ownerUserId: 'account-a', count: 1, localAgents: [{ ownerUserId: 'account-b' }] };
        },
        async openConversation() { return {}; },
        async sendTurn() { return {}; },
        async subscribeTurn() { return {}; },
        async getConversationSnapshot() { return {}; },
      },
    }),
  });
  await assert.rejects(
    () => invalid.agent.listInventory(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('local-app subscribeTurn is an honest cursor pull, not a cast Promise stream', async () => {
  const client = createNimiAppRuntimePlatformClient({
    standardShell: standardShell({
      agent: {
        async inventory() { return { ownerUserId: 'account-a', count: 0, localAgents: [] }; },
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
