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
    ai: {
      text: {
        generateCandidate: async () => ({
          text: '{"name":"Lin"}',
          finishReason: 'stop',
          traceId: 'trace-1',
        }),
      },
    },
    aiConfig: {
      get: async () => ({
        owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
        capabilities: [],
      }),
      overwrite: async (capabilities: unknown) => ({
        owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
        capabilities,
      }),
    },
    storage: {
      readJson: async () => ({ value: { version: 1 }, sizeBytes: 13 }),
      writeJson: async (_path: string, value: unknown) => ({ value, sizeBytes: 13 }),
      removeJson: async () => ({ removed: false }),
    },
    realm: {
      worldCore: {
        list: async () => [{ id: 'world-1' }],
        create: async () => ({ id: 'world-1' }),
      },
    },
    conversation: {
      open: async () => ({ conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null }),
      send: async () => ({ messageId: 'message-1' }),
      interruptTurn: async () => ({ messageId: 'interrupt-message-1' }),
      subscribe: async () => ({
        events: { async *[Symbol.asyncIterator]() {} },
        cancel: async () => undefined,
      }),
      snapshot: async () => ({ anchor: { conversationAnchorId: 'anchor-1' } }),
    },
    artifacts: {
      put: async () => ({ artifactId: 'artifact-1' }),
      readBytes: async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' }),
    },
    agentConfigure: {
      configurationSnapshot: async () => ({}),
      updateConfiguration: async () => ({}),
      readinessSnapshot: async () => ({}),
      aiProfilePreview: async () => ({}),
      aiProfileApply: async () => ({}),
      autonomySnapshot: async () => ({}),
      updateAutonomy: async () => ({}),
      presentationSnapshot: async () => ({}),
      commitPresentation: async () => ({}),
    },
    ...overrides,
  };
}

test('local-app client exposes only admitted typed namespaces', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  assert.deepEqual(Object.keys(client).sort(), ['agentConfigure', 'ai', 'aiConfig', 'artifacts', 'auth', 'conversation', 'permissions', 'realm', 'storage']);
  assert.deepEqual(await client.auth.status(), {
    mode: 'local-app',
    state: 'session-bound',
    sessionBound: true,
    reasonCode: 'action-executed',
    actionHint: 'continue_local_app_session',
    retryable: false,
  });
  assert.equal('agent' in client, false);
});

test('App AIConfig carrier fixes owner outside renderer input', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      aiConfig: {
        get: async () => ({
          owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
          capabilities: [],
        }),
        overwrite: async (capabilities: unknown) => {
          calls.push(capabilities);
          return {
            owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
            capabilities,
          };
        },
      },
    }),
  });
  const intent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local' as const, local: {} },
  };
  await assert.doesNotReject(() => client.aiConfig.get());
  const committed = await client.aiConfig.overwrite([intent]);
  assert.deepEqual(calls, [[intent]]);
  assert.equal(committed.owner?.owner.oneofKind, 'app');
  assert.equal('appId' in client.aiConfig, false);
  assert.equal('owner' in client.aiConfig, false);
});

test('App AIConfig carrier rejects owner injection and mismatched projection shape', async () => {
  const client = createLocalAppClient({
    standardShell: standardShell({
      aiConfig: {
        get: async () => ({ owner: {}, capabilities: [] }),
        overwrite: async () => ({ owner: {}, capabilities: [] }),
      },
    }),
  });
  await assert.rejects(() => client.aiConfig.get(), /invalid App AIConfig owner projection/u);
  await assert.rejects(() => client.aiConfig.overwrite([{
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
    owner: { appId: 'forbidden' },
  } as never]), /unsupported fields/u);
});

test('text candidate generation forwards only bounded prompt controls', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      ai: {
        text: {
          generateCandidate: async (input: unknown) => {
            calls.push(input);
            return { text: '  {"name":"Lin"}\n', finishReason: 'stop', traceId: 'trace-1' };
          },
        },
      },
    }),
  });
  assert.deepEqual(await client.ai.text.generateCandidate({
    messages: [
      { role: 'system', text: 'Return JSON.' },
      { role: 'user', text: 'Create one persona.' },
    ],
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 512,
  }), {
    text: '  {"name":"Lin"}\n',
    finishReason: 'stop',
    traceId: 'trace-1',
  });
  assert.deepEqual(calls, [{
    messages: [
      { role: 'system', text: 'Return JSON.' },
      { role: 'user', text: 'Create one persona.' },
    ],
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 512,
  }]);
});

test('exact WorldCore list/create carrier exposes no Runtime selector or authority material', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      realm: {
        worldCore: {
          list: async (input: unknown) => {
            calls.push(['list', input]);
            return [{ id: 'world-1', core: {}, visibility: 'private' }];
          },
          create: async (input: unknown) => {
            calls.push(['create', input]);
            return { id: 'world-2', core: {}, visibility: 'private' };
          },
        },
      },
    }),
  });
  assert.equal((await client.realm.worldCore.list({ take: 20, visibility: 'private' }))[0]?.id, 'world-1');
  assert.equal((await client.realm.worldCore.create({
    core: {},
    origin: { kind: 'manual' },
    visibility: 'private',
  })).id, 'world-2');
  assert.deepEqual(calls, [
    ['list', { take: 20, visibility: 'private' }],
    ['create', { core: {}, origin: { kind: 'manual' }, visibility: 'private' }],
  ]);
  for (const forbidden of ['methodId', 'realmBaseUrl', 'caller', 'token', 'authorization']) {
    assert.equal(JSON.stringify(calls).includes(forbidden), false);
  }
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
  assert.equal((calls[1] as { permissionId?: string }).permissionId, 'agents.interact');
  assert.equal((calls[1] as { reason?: string }).reason, 'Continue the conversation');
  assert.match((calls[1] as { requestId: string }).requestId, /^[0-9a-f-]{36}$/u);
  assert.equal(JSON.stringify(calls).includes('operationId'), false);
  assert.equal(JSON.stringify(calls).includes('resourceRef'), false);
});

test('permission projection rejects the reserved revoked wire posture', async () => {
  const client = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async ({ permissionId }: { permissionId: string }) => ({
          permissionId,
          state: 'revoked',
          canRequest: false,
          reasonCode: 'LOCAL_APP_PERMISSION_REVOKED',
          agents: [],
        }),
        request: async () => { throw new Error('not used'); },
      },
    }),
  });
  await assert.rejects(
    () => client.permissions.status('agents.interact'),
    /permission state/u,
  );
});

test('Agent capability posture subscription emits the SDK projection and releases its observer', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  const firstPosture = new Promise<Awaited<ReturnType<typeof client.permissions.agentCapabilityPosture>>>((resolve, reject) => {
    const unsubscribe = client.permissions.subscribeAgentCapabilityPosture((posture) => {
      unsubscribe();
      resolve(posture);
    }, reject);
  });
  assert.equal((await firstPosture).configure.reason, 'not_granted');
});

test('agent capability posture exposes admitted configure as unavailable/not_granted', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  const posture = await client.permissions.agentCapabilityPosture();
  assert.deepEqual(posture.configure, {
    permissionId: 'agents.configure',
    posture: 'unavailable',
    reason: 'not_granted',
    agents: [],
  });
  assert.equal(posture.interact.reason, 'not_granted');
  assert.equal(posture.memory.reason, 'reserved_not_admitted');
});

test('agent capability posture keeps unknown distinct from reserved and not-granted', async () => {
  const client = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async ({ permissionId }: { permissionId: string }) => ({
          permissionId,
          state: 'unavailable',
          canRequest: false,
          reasonCode: permissionId === 'agents.interact' ? 'LOCAL_APP_PERMISSION_UNKNOWN' : 'LOCAL_APP_PERMISSION_REQUIRED',
          agents: [],
        }),
        request: async () => ({}),
      },
    }),
  });
  const posture = await client.permissions.agentCapabilityPosture();
  assert.equal(posture.interact.reason, 'unknown');
  assert.equal(posture.configure.reason, 'not_granted');
});

test('local-app configure is requestable while reserved permission IDs are not', async () => {
  let requestCalls = 0;
  const client = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async ({ permissionId }: { permissionId: string }) => ({
          permissionId,
          state: 'unavailable',
          canRequest: false,
          reasonCode: 'LOCAL_APP_PERMISSION_DENIED',
          agents: [],
        }),
        request: async ({ permissionId }: { permissionId: string }) => {
          requestCalls += 1;
          return {
            permissionId,
            state: 'unavailable',
            canRequest: false,
            reasonCode: 'LOCAL_APP_PERMISSION_DENIED',
            agents: [],
          };
        },
      },
    }),
  });

  assert.deepEqual(await client.permissions.status('agents.voice'), {
    permissionId: 'agents.voice',
    posture: 'unavailable',
    canRequest: false,
    agents: [],
    detail: 'LOCAL_APP_PERMISSION_DENIED',
  });
  assert.deepEqual(await client.permissions.request({
    permissionId: 'agents.configure',
    reason: 'Configure this Agent',
  }), {
    permissionId: 'agents.configure',
    posture: 'unavailable',
    canRequest: false,
    agents: [],
    detail: 'LOCAL_APP_PERMISSION_DENIED',
  });
  assert.equal(requestCalls, 1);

  await assert.rejects(
    () => client.permissions.request({
      permissionId: 'agents.voice',
      reason: 'Use Agent voice',
    }),
    (error: unknown) => {
      const typed = error as { reasonCode?: string; actionHint?: string; message?: string };
      return typed.reasonCode === 'SDK_PERMISSION_NOT_ADMITTED'
        && typed.actionHint === 'wait_for_permission_admission'
        && String(typed.message).includes('agents.voice');
    },
  );
  assert.equal(requestCalls, 1);
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
          agents: [{
            agentHandle: 'opaque-runtime-handle',
            displayName: 'Owned Agent',
            avatarUrl: 'https://assets.example.test/owned-agent.png',
          }],
        }),
        request: async () => ({}),
      },
    }),
  });
  assert.deepEqual(await client.permissions.status('agents.interact'), {
    permissionId: 'agents.interact',
    posture: 'granted',
    canRequest: false,
    agents: [{
      agentHandle: 'opaque-runtime-handle',
      displayName: 'Owned Agent',
      avatarUrl: 'https://assets.example.test/owned-agent.png',
    }],
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
      { agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent', avatarUrl: null },
      { agentHandle: 'opaque-runtime-handle', displayName: 'Other Agent', avatarUrl: null },
    ],
    [{ agentHandle: ' opaque-runtime-handle', displayName: 'Owned Agent', avatarUrl: null }],
    [{ agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent', avatarUrl: null, selectorHandle: 'legacy' }],
    [{ agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent', avatarUrl: 'http://assets.example.test/owned-agent.png' }],
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
          agents: [{ agentHandle: 'opaque-runtime-handle', displayName: 'Owned Agent', avatarUrl: null }],
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
        interruptTurn: unavailable,
        subscribe: unavailable,
        snapshot: unavailable,
      },
    }),
  });
  const operations = [
    () => client.conversation.open({ agentHandle: handle }),
    () => client.conversation.send({
      agentHandle: handle,
      conversationAnchorId: 'anchor-1',
      requestId: 'request-1',
      text: 'hello',
      attachments: [],
    }),
    () => client.conversation.interruptTurn({ agentHandle: handle, conversationAnchorId: 'anchor-1' }),
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
  assert.deepEqual(calls[0], { agentHandle: handle });
  assert.equal(calls.length, 5);
});

test('conversation subscription validates events and cancels exactly once', async () => {
  const handle = 'lash_runtime_materialized' as NimiLocalAppAgentHandle;
  let cancelCount = 0;
  const client = createLocalAppClient({
    standardShell: standardShell({
      conversation: {
        open: async () => ({ conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null }),
        send: async () => ({ messageId: 'message-1' }),
        interruptTurn: async () => ({ messageId: 'interrupt-message-1' }),
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
  assert.deepEqual(await client.conversation.open({ agentHandle: handle }), {
    conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null,
  });
  assert.deepEqual(await client.conversation.interruptTurn({
    agentHandle: handle,
    conversationAnchorId: 'anchor-1',
  }), { messageId: 'interrupt-message-1' });
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

test('conversation send forwards one exact artifact attachment and admits attachment-only turns', async () => {
  const handle = 'lash_runtime_materialized' as NimiLocalAppAgentHandle;
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      conversation: {
        open: async () => ({ conversationAnchorId: 'anchor-1', activeTurnId: null, activeStreamId: null }),
        send: async (input: unknown) => {
          calls.push(input);
          return { messageId: 'message-1' };
        },
        interruptTurn: async () => ({ messageId: 'interrupt-message-1' }),
        subscribe: async () => ({
          events: { async *[Symbol.asyncIterator]() {} },
          cancel: async () => undefined,
        }),
        snapshot: async () => ({ anchor: { conversationAnchorId: 'anchor-1' } }),
      },
    }),
  });
  const sent = await client.conversation.send({
    agentHandle: handle,
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
    text: '',
    attachments: [{ artifactId: 'artifact_01J', displayName: ' photo.png ' }],
  });
  assert.deepEqual(sent, { messageId: 'message-1' });
  assert.deepEqual(calls, [{
    agentHandle: handle,
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
    text: '',
    attachments: [{ artifactId: 'artifact_01J', displayName: 'photo.png' }],
  }]);
  assert.equal(JSON.stringify(calls).includes('mimeType'), false);
});

test('conversation send fails closed on attachment shape violations and empty input', async () => {
  const handle = 'lash_runtime_materialized' as NimiLocalAppAgentHandle;
  const client = createLocalAppClient({ standardShell: standardShell() });
  const base = {
    agentHandle: handle,
    conversationAnchorId: 'anchor-1',
    requestId: 'request-1',
  };
  const invalid = [
    { ...base, text: '', attachments: [] },
    { ...base, text: 'hello', attachments: [{ artifactId: 'a' }, { artifactId: 'b' }] },
    { ...base, text: 'hello', attachments: [{ artifactId: '' }] },
    { ...base, text: 'hello', attachments: [{ artifactId: '  ' }] },
    { ...base, text: 'hello', attachments: [{ displayName: 'photo.png' }] },
    { ...base, text: 'hello', attachments: [{ artifactId: 'a', mimeType: 'image/png' }] },
    { ...base, text: 'hello', attachments: [{ artifactId: 'a', displayName: 7 }] },
    { ...base, text: 'hello', attachments: 'artifact_01J' },
  ];
  for (const input of invalid) {
    await assert.rejects(
      () => client.conversation.send(input as never),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
    );
  }
});

test('artifacts putArtifact uploads bounded bytes and projects the exact artifact id', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      artifacts: {
        put: async (input: unknown) => {
          calls.push(input);
          return { artifactId: 'artifact_01J' };
        },
        readBytes: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
      },
    }),
  });
  const data = new Uint8Array([137, 80, 78, 71]);
  const result = await client.artifacts.putArtifact({
    mimeType: 'image/png',
    displayName: 'photo.png',
    data,
  });
  assert.deepEqual(result, { artifactId: 'artifact_01J' });
  assert.equal(calls.length, 1);
  const forwarded = calls[0] as { mimeType?: unknown; displayName?: unknown; data?: unknown };
  assert.equal(forwarded.mimeType, 'image/png');
  assert.equal(forwarded.displayName, 'photo.png');
  assert.ok(forwarded.data instanceof Uint8Array);
  assert.deepEqual([...(forwarded.data as Uint8Array)], [137, 80, 78, 71]);
});

test('artifacts putArtifact fails closed on unbounded or malformed input', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
  const invalid = [
    { mimeType: '', displayName: 'photo.png', data: new Uint8Array([1]) },
    { mimeType: ' image/png', displayName: 'photo.png', data: new Uint8Array([1]) },
    { mimeType: 'image/png', displayName: 'photo.png ', data: new Uint8Array([1]) },
    { mimeType: 'image/png', displayName: 'photo.png', data: new Uint8Array(0) },
    { mimeType: 'image/png', displayName: 'photo.png', data: oversized },
    { mimeType: 'image/png', displayName: 'photo.png', data: [1, 2, 3] },
  ];
  for (const input of invalid) {
    await assert.rejects(
      () => client.artifacts.putArtifact(input as never),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
    );
  }
  await assert.rejects(
    () => client.artifacts.putArtifact({
      mimeType: 'image/png',
      displayName: 'photo.png',
      data: new Uint8Array([1]),
      artifactId: 'forged',
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
});

test('artifacts readArtifactBytes projects bounded bytes and fails closed on malformed projections', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      artifacts: {
        put: async () => ({ artifactId: 'artifact-1' }),
        readBytes: async (input: unknown) => {
          calls.push(input);
          return { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' };
        },
      },
    }),
  });
  const result = await client.artifacts.readArtifactBytes({ artifactId: 'artifact_01J' });
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual([...result.bytes], [137, 80, 78, 71]);
  assert.deepEqual(calls, [{ artifactId: 'artifact_01J' }]);

  await assert.rejects(
    () => client.artifacts.readArtifactBytes({ artifactId: '  ' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  await assert.rejects(
    () => client.artifacts.readArtifactBytes({ artifactId: 'artifact_01J', ownerUserId: 'forged' } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );

  const malformed = createLocalAppClient({
    standardShell: standardShell({
      artifacts: {
        put: async () => ({ artifactId: 'artifact-1' }),
        readBytes: async () => ({ bytes: [1, 2, 3], mimeType: 'image/png' }),
      },
    }),
  });
  await assert.rejects(
    () => malformed.artifacts.readArtifactBytes({ artifactId: 'artifact_01J' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});
