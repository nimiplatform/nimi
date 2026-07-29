import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiClient } from '../../root-client';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppClientInput,
} from './local-app-runtime-platform';

function createLocalAppClient(input: NimiLocalAppClientInput) {
  return createNimiClient({ localApp: input });
}

function standardShell(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      status: async () => ({ state: 'ready', reasonCode: 'action-executed', retryable: false }),
    },
    permission: {
      status: async ({ permissionId }: { permissionId: string }) => ({
        permissionId,
        state: 'unavailable',
        canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
        agents: [],
      }),
      request: async ({ permissionId }: { permissionId: string }) => ({
        permissionId,
        state: 'unavailable',
        canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
        agents: [],
      }),
    },
    storage: {
      readJson: async () => ({ value: { version: 1 }, sizeBytes: 13 }),
      writeJson: async (_path: string, value: unknown) => ({ value, sizeBytes: 13 }),
      removeJson: async () => ({ removed: false }),
    },
    conversation: {
      open: async () => ({ conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null }),
      send: async () => ({ messageId: 'message-1' }),
      subscribe: async () => ({
        events: { async *[Symbol.asyncIterator]() {} },
        cancel: async () => undefined,
      }),
      snapshot: async () => ({ anchor: { conversationAnchorId: 'anchor-1' } }),
    },
    ...overrides,
  };
}

test('local-app client exposes only admitted typed namespaces', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  assert.deepEqual(Object.keys(client).sort(), ['auth', 'conversation', 'permissions', 'storage']);
  assert.deepEqual(await client.auth.status(), {
    mode: 'local-app',
    state: 'session-bound',
    sessionBound: true,
    reasonCode: 'action-executed',
    actionHint: 'continue_local_app_session',
    retryable: false,
  });
  assert.equal('agent' in client, false);
  assert.equal('artifacts' in client, false);
});

test('admitted SDK permission remains fail-closed while Runtime publication is held', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async (input: unknown) => {
          calls.push(input);
          return {
            permissionId: 'agents.interact',
            state: 'unavailable',
            canRequest: false,
            reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
            agents: [],
          };
        },
        request: async (input: unknown) => {
          calls.push(input);
          return {
            permissionId: 'agents.interact',
            state: 'unavailable',
            canRequest: false,
            reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
            agents: [],
          };
        },
      },
    }),
  });
  assert.deepEqual(await client.permissions.status('agents.interact'), {
    permissionId: 'agents.interact',
    posture: 'unavailable',
    canRequest: false,
    agents: [],
    detail: 'LOCAL_APP_OPERATION_UNAVAILABLE',
  });
  assert.deepEqual(calls, [{ permissionId: 'agents.interact' }]);
  assert.equal((await client.permissions.request({
    permissionId: 'agents.interact',
    reason: 'Continue the conversation',
  })).posture, 'unavailable');
  assert.equal(JSON.stringify(calls).includes('operationId'), false);
  assert.equal(JSON.stringify(calls).includes('resourceRef'), false);
});

test('granted account permission projects only branded opaque Agent handles', async () => {
  const client = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async () => ({
          permissionId: 'agents.interact',
          state: 'granted',
          canRequest: false,
          reasonCode: 'ACTION_EXECUTED',
          agents: [{ agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent' }],
        }),
        request: async () => ({}),
      },
    }),
  });
  assert.deepEqual(await client.permissions.status('agents.interact'), {
    permissionId: 'agents.interact',
    posture: 'granted',
    canRequest: false,
    agents: [{ agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent' }],
    detail: 'ACTION_EXECUTED',
  });
});

test('granted account permission accepts zero current Agents', async () => {
  const client = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async () => ({
          permissionId: 'agents.interact',
          state: 'granted',
          canRequest: false,
          reasonCode: 'ACTION_EXECUTED',
          agents: [],
        }),
        request: async () => ({}),
      },
    }),
  });
  assert.deepEqual((await client.permissions.status('agents.interact')).agents, []);
});

test('permission projection rejects duplicate, malformed, or non-granted Agent handles', async () => {
  const invalidAgents = [
    [
      { agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent' },
      { agentHandle: 'opaque-runtime-handle', displayName: 'Other Agent' },
    ],
    [{ agentHandle: ' opaque-runtime-handle', displayName: 'Owned Agent' }],
    [{ agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent', selectorHandle: 'legacy' }],
  ];
  for (const agents of invalidAgents) {
    const client = createLocalAppClient({
      standardShell: standardShell({
        permission: {
          status: async () => ({
            permissionId: 'agents.interact',
            state: 'granted',
            canRequest: false,
            reasonCode: 'ACTION_EXECUTED',
            agents,
          }),
          request: async () => ({}),
        },
      }),
    });
    await assert.rejects(
      () => client.permissions.status('agents.interact'),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
    );
  }
  const nonGranted = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async () => ({
          permissionId: 'agents.interact',
          state: 'denied',
          canRequest: true,
          reasonCode: 'PERMISSION_DENIED',
          agents: [{ agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent' }],
        }),
        request: async () => ({}),
      },
    }),
  });
  await assert.rejects(
    () => nonGranted.permissions.status('agents.interact'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('permission ids and projections are closed to the public catalog', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  await assert.rejects(
    () => client.permissions.status('runtime_agent.conversation.open' as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_ID_UNKNOWN',
  );

  const mismatched = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async () => ({
          permissionId: 'artifacts.open', state: 'unavailable', canRequest: false, reasonCode: 'unavailable', agents: [],
        }),
        request: async () => ({}),
      },
    }),
  });
  await assert.rejects(
    () => mismatched.permissions.status('agents.interact'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('app-private storage works without a permission request', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      storage: {
        readJson: async (path: string) => { calls.push(['read', path]); return { value: { version: 1 }, sizeBytes: 13 }; },
        writeJson: async (path: string, value: unknown) => { calls.push(['write', path, value]); return { value, sizeBytes: 13 }; },
        removeJson: async (path: string) => { calls.push(['remove', path]); return { removed: false }; },
      },
    }),
  });
  assert.deepEqual(await client.storage.readJson('agent-chat/state.json'), { value: { version: 1 }, sizeBytes: 13 });
  assert.deepEqual(await client.storage.writeJson('agent-chat/state.json', { version: 2 }), {
    value: { version: 2 }, sizeBytes: 13,
  });
  assert.deepEqual(await client.storage.removeJson('agent-chat/state.json'), { removed: false });
  assert.deepEqual(calls, [
    ['read', 'agent-chat/state.json'],
    ['write', 'agent-chat/state.json', { version: 2 }],
    ['remove', 'agent-chat/state.json'],
  ]);
});

test('app-private storage rejects path escape and non-JSON values before transport', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  for (const relativePath of ['../state.json', '/state.json', 'agent\\state.json', 'CON.json', 'state.txt']) {
    await assert.rejects(
      () => client.storage.readJson(relativePath),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_STORAGE_PATH_INVALID',
    );
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await assert.rejects(
    () => client.storage.writeJson('state.json', cyclic as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_STORAGE_VALUE_INVALID',
  );
});

test('conversation namespace preserves opaque Agent handles and reserved typed failures', async () => {
  const handle = 'lash_runtime_materialized' as NimiLocalAppAgentHandle;
  const calls: unknown[] = [];
  const unavailable = async (input: unknown): Promise<never> => {
    calls.push(input);
    throw Object.assign(new Error('reserved'), {
      reasonCode: 'local-app-operation-unavailable',
      actionHint: 'continue_without_optional_permission',
    });
  };
  const client = createLocalAppClient({
    standardShell: standardShell({
      conversation: {
        open: unavailable,
        send: unavailable,
        subscribe: unavailable,
        snapshot: unavailable,
      },
    }),
  });
  const operations = [
    () => client.conversation.open({ agentHandle: handle, disposition: 'create-new' }),
    () => client.conversation.send({
      agentHandle: handle,
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: 'hello',
    }),
    () => client.conversation.subscribe({ agentHandle: handle, conversationAnchorId: 'anchor-1' }),
    () => client.conversation.snapshot({ agentHandle: handle, conversationAnchorId: 'anchor-1' }),
  ];
  for (const operation of operations) {
    await assert.rejects(
      operation,
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'local-app-operation-unavailable',
    );
  }
  assert.equal(JSON.stringify(calls).includes('localAgentId'), false);
  assert.equal(calls.length, 4);
});

test('conversation subscription validates events and cancels exactly once', async () => {
  const handle = 'lash_runtime_materialized' as NimiLocalAppAgentHandle;
  let cancelCount = 0;
  const client = createLocalAppClient({
    standardShell: standardShell({
      conversation: {
        open: async () => ({ conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null }),
        send: async () => ({ messageId: 'message-1' }),
        snapshot: async () => ({ anchor: { conversationAnchorId: 'anchor-1' } }),
        subscribe: async () => ({
          events: {
            async *[Symbol.asyncIterator]() {
              yield {
                eventType: 1,
                sequence: '7',
                messageId: 'message-1',
                messageType: 'runtime.agent.turn.delta',
                payload: { text: 'hello' },
                reasonCode: 'ACTION_EXECUTED',
                traceId: 'trace-1',
                timestampUnixMs: 123,
              };
            },
          },
          cancel: async () => { cancelCount += 1; },
        }),
      },
    }),
  });
  assert.deepEqual(await client.conversation.open({ agentHandle: handle, disposition: 'create-new' }), {
    conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null,
  });
  const subscription = await client.conversation.subscribe({
    agentHandle: handle,
    conversationAnchorId: 'anchor-1',
  });
  const events = [];
  for await (const event of subscription) events.push(event);
  await subscription.cancel();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.sequence, '7');
  assert.equal(cancelCount, 1);
});

test('client rejects expanded host namespaces and permission operation selectors', async () => {
  assert.throws(
    () => createLocalAppClient({
      standardShell: { ...standardShell(), runtime: { unary: async () => ({}) } },
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  const client = createLocalAppClient({ standardShell: standardShell() });
  await assert.rejects(
    () => client.permissions.request({
      permissionId: 'agents.interact',
      reason: 'Continue',
      operationId: 'runtime_agent.conversation.open',
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
});

test('auth projection rejects host pseudo-success flags', async () => {
  const client = createLocalAppClient({
    standardShell: standardShell({
      session: {
        status: async () => ({
          state: 'ready', reasonCode: 'action-executed', retryable: false, operationAllowed: true,
        }),
      },
    }),
  });
  await assert.rejects(
    () => client.auth.status(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});
