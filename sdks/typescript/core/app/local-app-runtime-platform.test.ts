import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenLocalAppSessionRequest,
  OpenLocalAppSessionResponse,
  RenewLocalAppSessionRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/auth.js';
import {
  createNimiLocalAppClient,
  type NimiLocalAppAgentHandle,
  type NimiLocalAppStandardShell,
} from './local-app-runtime-platform.js';

function standardShell(operationCalls: string[]): NimiLocalAppStandardShell {
  const touched = (name: string) => async (): Promise<never> => {
    operationCalls.push(name);
    throw Object.assign(new Error(`owner adapter unavailable: ${name}`), {
      reasonCode: 'local-app-owner-unavailable',
      retryable: false,
    });
  };
  return {
    session: {
      async status() {
        return {
          state: 'runtime-unavailable', reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE', retryable: true,
          currentUser: {
            state: 'unavailable', value: null,
            reasonCode: 'current-user-display-unavailable', retryable: true,
          },
        };
      },
    },
    ai: { text: { generateCandidate: touched('ai.text.generateCandidate') } },
    aiConfig: { get: touched('aiConfig.get'), overwrite: touched('aiConfig.overwrite') },
    storage: {
      readJson: touched('storage.readJson'),
      writeJson: touched('storage.writeJson'),
      removeJson: touched('storage.removeJson'),
    },
    realm: { worldCore: { list: touched('realm.worldCore.list'), create: touched('realm.worldCore.create') } },
    agents: { listReferences: touched('agents.listReferences') },
    conversation: {
      open: touched('conversation.open'),
      send: touched('conversation.send'),
      interruptTurn: touched('conversation.interruptTurn'),
      subscribe: touched('conversation.subscribe'),
      snapshot: touched('conversation.snapshot'),
    },
    agentConfigure: {
      sharedAIConfig: {
        get: touched('agentConfigure.sharedAIConfig.get'),
        overwrite: touched('agentConfigure.sharedAIConfig.overwrite'),
      },
      autonomy: {
        snapshot: touched('agentConfigure.autonomy.snapshot'),
        update: touched('agentConfigure.autonomy.update'),
      },
      presentation: {
        snapshot: touched('agentConfigure.presentation.snapshot'),
        commit: touched('agentConfigure.presentation.commit'),
      },
    },
  };
}

function isTypedOwnerUnavailable(error: unknown): boolean {
  return (error as { reasonCode?: string }).reasonCode === 'local-app-owner-unavailable';
}

test('generated local-app session wire projection is posture-only', () => {
  assert.deepEqual(Object.keys(OpenLocalAppSessionRequest.create()), []);
  assert.deepEqual(Object.keys(RenewLocalAppSessionRequest.create()), []);
  assert.deepEqual(Object.keys(OpenLocalAppSessionResponse.create()).sort(), [
    'currentUserReasonCode', 'reasonCode', 'state',
  ]);
  const projectionSource = JSON.stringify(OpenLocalAppSessionResponse.create()).toLowerCase();
  for (const forbidden of ['subject', 'account', 'snapshot', 'generation', 'credential', 'peerproof']) {
    assert.equal(projectionSource.includes(forbidden), false);
  }
});

test('local-app client hard-cuts the access workflow namespace', () => {
  const client = createNimiLocalAppClient({ standardShell: standardShell([]) });
  assert.deepEqual(Object.keys(client).sort(), [
    'agentConfigure', 'agents', 'ai', 'aiConfig', 'auth', 'conversation', 'currentUser', 'realm', 'storage',
  ]);
  assert.equal('permissions' in client, false);
  assert.equal('artifacts' in client, false);
  assert.deepEqual(Object.keys(client.agentConfigure).sort(), ['autonomy', 'presentation', 'sharedAIConfig']);
  assert.deepEqual(Object.keys(client.agentConfigure.sharedAIConfig).sort(), ['get', 'overwrite']);
  assert.deepEqual(Object.keys(client.agentConfigure.autonomy).sort(), ['snapshot', 'update']);
  assert.deepEqual(Object.keys(client.agentConfigure.presentation).sort(), ['commit', 'snapshot']);
});

test('local-app auth remains a separate availability projection', async () => {
  const client = createNimiLocalAppClient({ standardShell: standardShell([]) });
  assert.deepEqual(await client.auth.status(), {
    mode: 'local-app',
    state: 'unavailable',
    sessionBound: false,
    reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
    actionHint: 'start_fixed_runtime_service',
    retryable: true,
  });
});

test('Current User failure is isolated from the ready App session', async () => {
  const base = standardShell([]);
  const shell: NimiLocalAppStandardShell = {
    ...base,
    session: { status: async () => ({
      state: 'ready', reasonCode: 'action-executed', retryable: false,
      currentUser: {
        state: 'unavailable', value: null,
        reasonCode: 'current-user-display-unavailable', retryable: true,
      },
    }) },
  };
  const client = createNimiLocalAppClient({ standardShell: shell });
  assert.equal((await client.auth.status()).state, 'session-bound');
  await assert.rejects(
    () => client.currentUser.get(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_CURRENT_USER_UNAVAILABLE',
  );
});

test('Current User projects exactly three display-safe fields', async () => {
  const base = standardShell([]);
  const shell: NimiLocalAppStandardShell = {
    ...base,
    session: { status: async () => ({
      state: 'ready', reasonCode: 'action-executed', retryable: false,
      currentUser: {
        state: 'ready',
        value: { handle: 'halliday', displayName: 'Halliday', avatarUrl: null },
        reasonCode: 'action-executed', retryable: false,
      },
    }) },
  };
  const client = createNimiLocalAppClient({ standardShell: shell });
  assert.deepEqual(await client.currentUser.get(), {
    handle: 'halliday', displayName: 'Halliday', avatarUrl: null,
  });
});

test('Agent reference list projects every item as exactly three display-safe fields', async () => {
  const base = standardShell([]);
  const shell: NimiLocalAppStandardShell = {
    ...base,
    agents: { listReferences: async () => [
      { agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', displayName: 'Alpha', avatarUrl: null },
      { agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', displayName: 'Beta', avatarUrl: 'https://cdn.nimi.ai/beta.webp' },
    ] },
  };
  const references = await createNimiLocalAppClient({ standardShell: shell }).agents.listReferences();
  assert.deepEqual(references.map((reference) => Object.keys(reference).sort()), [
    ['agentHandle', 'avatarUrl', 'displayName'],
    ['agentHandle', 'avatarUrl', 'displayName'],
  ]);
  assert.equal(JSON.stringify(references).includes('localAgentId'), false);

  for (const malformed of [
    [{ agentHandle: 'raw-agent-id', displayName: 'Alpha', avatarUrl: null }],
    [{ agentHandle: 'agent_ref_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', displayName: 'Alpha', avatarUrl: 'https://cdn.nimi.ai/a?token=private' }],
    [{ agentHandle: 'agent_ref_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', displayName: 'Alpha', avatarUrl: null, accountId: 'private' }],
  ]) {
    const invalid: NimiLocalAppStandardShell = { ...base, agents: { listReferences: async () => malformed } };
    await assert.rejects(
      () => createNimiLocalAppClient({ standardShell: invalid }).agents.listReferences(),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
    );
  }
});

test('Agent conversation projects only the exact typed union and bounded snapshot', async () => {
  const base = standardShell([]);
  const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as NimiLocalAppAgentHandle;
  const calls: unknown[] = [];
  const shell: NimiLocalAppStandardShell = {
    ...base,
    conversation: {
      async open(input) {
        calls.push(['open', input]);
        return { conversationAnchorId: 'agent_anchor_01J', activeTurnId: null };
      },
      async send(input) {
        calls.push(['send', input]);
        return { turnId: 'agent_turn_01J' };
      },
      async interruptTurn(input) {
        calls.push(['interrupt', input]);
        return { turnId: 'agent_turn_01J' };
      },
      async subscribe(input) {
        calls.push(['subscribe', input]);
        return {
          events: (async function* () {
            yield {
              type: 'turn-accepted', conversationAnchorId: 'agent_anchor_01J',
              sequence: '1', turnId: 'agent_turn_01J', requestId: 'request-1',
            };
            yield {
              type: 'message-committed', conversationAnchorId: 'agent_anchor_01J',
              sequence: '4', turnId: 'agent_turn_01J', messageId: 'message-1', text: 'hello',
            };
            yield {
              type: 'turn-completed', conversationAnchorId: 'agent_anchor_01J',
              sequence: '6', turnId: 'agent_turn_01J', terminalReason: 'stop',
            };
          })(),
          async cancel() { calls.push(['cancel']); },
        };
      },
      async snapshot(input) {
        calls.push(['snapshot', input]);
        return {
          conversationAnchorId: 'agent_anchor_01J', activeTurnId: null,
          messages: [
            { turnId: 'agent_turn_01J', role: 'user', text: 'hello' },
            { turnId: 'agent_turn_01J', role: 'assistant', text: 'hello back' },
          ],
          truncatedBefore: false,
        };
      },
    },
  };
  const conversation = createNimiLocalAppClient({ standardShell: shell }).conversation;
  assert.deepEqual(await conversation.open({ agentHandle: handle }), {
    conversationAnchorId: 'agent_anchor_01J', activeTurnId: null,
  });
  assert.deepEqual(await conversation.send({
    agentHandle: handle, conversationAnchorId: 'agent_anchor_01J', requestId: 'request-1', text: 'hello',
  }), { turnId: 'agent_turn_01J' });
  const subscription = await conversation.subscribe({ agentHandle: handle, conversationAnchorId: 'agent_anchor_01J' });
  const events = [];
  for await (const event of subscription) events.push(event);
  assert.deepEqual(events.map((event) => event.type), [
    'turn-accepted', 'message-committed', 'turn-completed',
  ]);
  assert.equal(JSON.stringify(events).includes('payload'), false);
  assert.equal(JSON.stringify(events).includes('messageType'), false);
  assert.deepEqual(await conversation.snapshot({ agentHandle: handle, conversationAnchorId: 'agent_anchor_01J' }), {
    conversationAnchorId: 'agent_anchor_01J', activeTurnId: null,
    messages: [
      { turnId: 'agent_turn_01J', role: 'user', text: 'hello' },
      { turnId: 'agent_turn_01J', role: 'assistant', text: 'hello back' },
    ],
    truncatedBefore: false,
  });
  assert.equal(JSON.stringify(calls).includes('localAgentId'), false);
  assert.equal(JSON.stringify(calls).includes('attachments'), false);

  const invalid: NimiLocalAppStandardShell = {
    ...base,
    conversation: {
      ...base.conversation,
      subscribe: async () => ({
        events: (async function* () {
          yield {
            eventType: 1, messageType: 'runtime.agent.turn.completed', payload: {},
            conversationAnchorId: 'agent_anchor_01J', sequence: '1', turnId: 'agent_turn_01J',
          };
        })(),
        cancel: async () => undefined,
      }),
    },
  };
  const invalidSubscription = await createNimiLocalAppClient({ standardShell: invalid }).conversation.subscribe({
    agentHandle: handle, conversationAnchorId: 'agent_anchor_01J',
  });
  await assert.rejects(
    async () => { for await (const _event of invalidSubscription) { /* fail closed */ } },
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('App AIConfig accepts only portable intent and rejects binding material in input or projection', async () => {
  const calls: unknown[] = [];
  const portableConfig = {
    owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
    capabilities: [{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      route: {
        oneofKind: 'cloud',
        cloud: {
          implementation: {
            implementationId: 'cloud.text.example',
            driverId: 'cloud.example',
            driverDialect: 'v1',
          },
          providerModelTarget: { fields: {} },
        },
      },
    }],
  } as const;
  const base = standardShell([]);
  const shell: NimiLocalAppStandardShell = {
    ...base,
    aiConfig: {
      get: async () => portableConfig,
      overwrite: async (capabilities) => {
        calls.push(capabilities);
        return { ...portableConfig, capabilities };
      },
    },
  };
  const client = createNimiLocalAppClient({ standardShell: shell });
  assert.deepEqual(await client.aiConfig.get(), portableConfig);
  assert.deepEqual(await client.aiConfig.overwrite(portableConfig.capabilities), portableConfig);
  assert.equal(JSON.stringify(calls).includes('connectorGrant'), false);

  await assert.rejects(
    () => client.aiConfig.overwrite([{
      ...portableConfig.capabilities[0],
      route: {
        oneofKind: 'cloud',
        cloud: { ...portableConfig.capabilities[0].route.cloud, connectorGrantId: 'grant-forged' },
      },
    }] as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
  );
  assert.equal(calls.length, 1);

  const bindingProjection: NimiLocalAppStandardShell = {
    ...base,
    aiConfig: {
      ...base.aiConfig,
      get: async () => ({
        ...portableConfig,
        capabilities: [{
          ...portableConfig.capabilities[0],
          route: {
            oneofKind: 'cloud',
            cloud: { ...portableConfig.capabilities[0].route.cloud, connectorGrantId: 'grant-private' },
          },
        }],
      }),
    },
  };
  await assert.rejects(
    () => createNimiLocalAppClient({ standardShell: bindingProjection }).aiConfig.get(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('WorldCore list accepts the exact owner DTO and rejects raw or credential-adjacent projections', async () => {
  const world = {
    id: 'world-1', schemaVersion: '1', contentRevision: 1, contentHash: 'hash',
    origin: { kind: 'manual' }, visibility: 'private',
    core: {
      identity: {}, presentation: {}, ontology: {}, timeModel: {}, timeline: {},
      entities: [], relationships: [], systems: [], scenes: [], assets: {}, authoring: {},
    },
    createdAt: '2026-08-06T00:00:00Z', updatedAt: '2026-08-06T00:00:00Z',
  };
  const base = standardShell([]);
  const exact: NimiLocalAppStandardShell = {
    ...base,
    realm: { worldCore: { ...base.realm.worldCore, list: async () => [world] } },
  };
  const listed = await createNimiLocalAppClient({ standardShell: exact }).realm.worldCore.list();
  assert.equal(listed[0]?.id, 'world-1');

  for (const malformed of [
    { ...world, rawBody: '{}' },
    { ...world, core: { ...world.core, authorization: 'Bearer private' } },
  ]) {
    const shell: NimiLocalAppStandardShell = {
      ...base,
      realm: { worldCore: { ...base.realm.worldCore, list: async () => [malformed] } },
    };
    await assert.rejects(
      () => createNimiLocalAppClient({ standardShell: shell }).realm.worldCore.list(),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
    );
  }
});

test('canonical protected operations reach typed ingress and preserve owner-unavailable', async () => {
  const calls: string[] = [];
  const client = createNimiLocalAppClient({ standardShell: standardShell(calls) });
  const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as NimiLocalAppAgentHandle;
  const operations: Array<() => Promise<unknown>> = [
    () => client.ai.text.generateCandidate({ messages: [{ role: 'user', text: 'hello' }], temperature: 0, topP: 1, maxTokens: 1 }),
    () => client.aiConfig.get(),
    () => client.aiConfig.overwrite([]),
    () => client.storage.readJson('settings.json'),
    () => client.storage.writeJson('settings.json', {}),
    () => client.storage.removeJson('settings.json'),
    () => client.realm.worldCore.list(),
    () => client.realm.worldCore.create({ core: {}, origin: { kind: 'manual' } } as never),
    () => client.agents.listReferences(),
    () => client.conversation.open({ agentHandle: handle }),
    () => client.conversation.send({ agentHandle: handle, conversationAnchorId: 'anchor', requestId: 'request', text: 'hello' }),
    () => client.conversation.interruptTurn({ agentHandle: handle, conversationAnchorId: 'anchor' }),
    () => client.conversation.subscribe({ agentHandle: handle, conversationAnchorId: 'anchor' }),
    () => client.conversation.snapshot({ agentHandle: handle, conversationAnchorId: 'anchor' }),
    () => client.agentConfigure.sharedAIConfig.get(),
    () => client.agentConfigure.sharedAIConfig.overwrite([]),
    () => client.agentConfigure.autonomy.snapshot({ agentHandle: handle }),
    () => client.agentConfigure.autonomy.update({
      agentHandle: handle,
      expectedAutonomyRevision: '1',
      intent: { enabled: true },
    }),
    () => client.agentConfigure.presentation.snapshot({ agentHandle: handle }),
    () => client.agentConfigure.presentation.commit({
      agentHandle: handle,
      expectedPresentationRevision: '0',
      intent: {
        backendKind: 'vrm',
        avatarAssetRef: '',
        expressionProfileRef: '',
        idlePreset: '',
        interactionPolicyRef: '',
        defaultVoiceReference: '',
        avatarAutoplay: false,
        backgroundAssetRef: '',
      },
      importedAssets: [],
    }),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, isTypedOwnerUnavailable);
  }
  assert.deepEqual(calls, [
    'ai.text.generateCandidate',
    'aiConfig.get',
    'aiConfig.overwrite',
    'storage.readJson',
    'storage.writeJson',
    'storage.removeJson',
    'realm.worldCore.list',
    'realm.worldCore.create',
    'agents.listReferences',
    'conversation.open',
    'conversation.send',
    'conversation.interruptTurn',
    'conversation.subscribe',
    'conversation.snapshot',
    'agentConfigure.sharedAIConfig.get',
    'agentConfigure.sharedAIConfig.overwrite',
    'agentConfigure.autonomy.snapshot',
    'agentConfigure.autonomy.update',
    'agentConfigure.presentation.snapshot',
    'agentConfigure.presentation.commit',
  ]);

  assert.equal(calls.length, operations.length);
});

test('local-app client rejects the retired host namespace instead of decoding it', () => {
  const shell = standardShell([]) as NimiLocalAppStandardShell & Record<string, unknown>;
  shell.permission = { status: async () => ({}), request: async () => ({}) };
  assert.throws(
    () => createNimiLocalAppClient({ standardShell: shell }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_CARRIER_REQUIRED',
  );
});
