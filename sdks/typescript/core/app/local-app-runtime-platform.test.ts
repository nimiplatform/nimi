import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenLocalAppSessionRequest,
  OpenLocalAppSessionResponse,
  RenewLocalAppSessionRequest,
} from '../../core-generated/runtime-protobuf/runtime/v1/auth.js';
import {
  ExecutionMode,
  ScenarioJobStatus,
  ScenarioType,
  VoiceAssetStatus,
  VoiceCreationSource,
  VoiceReferenceKind,
  type SubmitScenarioJobRequest,
} from '../../core-generated/runtime-typed-client.js';
import {
  buildNimiRuntimeGenerationSubmitRequest,
  createNimiVideoGenerationScenario,
} from '../../features/generation/index.js';
import { runNimiRuntimeImageGeneration } from '../../features/generation/runtime-image-generation.js';
import { runNimiRuntimeScenarioJob } from '../../runtime/scenario-jobs.js';
import {
  createNimiLocalAppClient,
  createNimiLocalAppRuntimeScenarioJobClient,
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
    ai: {
      text: {
        generateCandidate: touched('ai.text.generateCandidate'),
        streamTurn: touched('ai.text.streamTurn'),
      },
      scenario: { execute: touched('ai.scenario.execute') },
      scenarioJobs: {
        submit: touched('ai.scenarioJobs.submit'),
        get: touched('ai.scenarioJobs.get'),
        subscribe: touched('ai.scenarioJobs.subscribe'),
        cancel: touched('ai.scenarioJobs.cancel'),
      },
      artifacts: {
        read: touched('ai.artifacts.read'),
        upload: touched('ai.artifacts.upload'),
      },
      voiceAssets: { list: touched('ai.voiceAssets.list') },
    },
    aiConfig: { get: touched('aiConfig.get') },
    modelConfig: { localSelections: touched('modelConfig.localSelections') },
    storage: {
      readJson: touched('storage.readJson'),
      writeJson: touched('storage.writeJson'),
      removeJson: touched('storage.removeJson'),
      assets: {
        stat: touched('storage.assets.stat'),
        list: touched('storage.assets.list'),
        write: touched('storage.assets.write'),
        read: touched('storage.assets.read'),
        remove: touched('storage.assets.remove'),
        move: touched('storage.assets.move'),
        adoptArtifact: touched('storage.assets.adoptArtifact'),
      },
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
    'agentConfigure', 'agents', 'ai', 'aiConfig', 'auth', 'conversation', 'currentUser', 'modelConfig', 'realm', 'storage',
  ]);
  assert.equal('permissions' in client, false);
  assert.equal('artifacts' in client, false);
  assert.deepEqual(Object.keys(client.ai).sort(), ['artifacts', 'scenario', 'scenarioJobs', 'text', 'voiceAssets']);
  assert.deepEqual(Object.keys(client.ai.text).sort(), ['generateCandidate', 'streamTurn']);
  assert.deepEqual(Object.keys(client.ai.artifacts).sort(), ['read', 'upload']);
  assert.deepEqual(Object.keys(client.agentConfigure).sort(), ['autonomy', 'presentation', 'sharedAIConfig']);
  assert.deepEqual(Object.keys(client.agentConfigure.sharedAIConfig).sort(), ['get', 'overwrite']);
  assert.deepEqual(Object.keys(client.agentConfigure.autonomy).sort(), ['snapshot', 'update']);
  assert.deepEqual(Object.keys(client.agentConfigure.presentation).sort(), ['commit', 'snapshot']);
  assert.deepEqual(Object.keys(client.storage).sort(), ['assets', 'readJson', 'removeJson', 'writeJson']);
  assert.deepEqual(Object.keys(client.storage.assets).sort(), [
    'adoptArtifact', 'list', 'move', 'read', 'remove', 'stat', 'write',
  ]);
});

test('local-app managed assets preserve incremental bodies, cancellation, and exact owner-free inputs', async () => {
  const base = standardShell([]);
  const calls: unknown[] = [];
  const asset = {
    relativePath: 'media/generated.png', mediaType: 'image/png', sizeBytes: 4,
    sha256: `sha256:${'a'.repeat(64)}`,
    createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
  };
  let readCanceled = false;
  const shell: NimiLocalAppStandardShell = {
    ...base,
    storage: {
      ...base.storage,
      assets: {
        async stat(relativePath) { calls.push(['stat', relativePath]); return asset; },
        async list(input) { calls.push(['list', input]); return { assets: [asset], nextCursor: '' }; },
        async write(input) {
          const chunks: number[][] = [];
          if (input.body instanceof Uint8Array) chunks.push([...input.body]);
          else if (typeof Blob !== 'undefined' && input.body instanceof Blob) chunks.push([...new Uint8Array(await input.body.arrayBuffer())]);
          else for await (const chunk of input.body) chunks.push([...chunk]);
          calls.push(['write', { ...input, body: chunks }]);
          return asset;
        },
        async read(input) {
          calls.push(['read', input]);
          return {
            asset,
            range: { offset: 0, length: 4, totalSize: 4 },
            body: (async function* () {
              try { yield Uint8Array.from([1, 2]); yield Uint8Array.from([3, 4]); }
              finally { readCanceled = true; }
            })(),
          };
        },
        async remove(relativePath) { calls.push(['remove', relativePath]); return { removed: true }; },
        async move(input) { calls.push(['move', input]); return { ...asset, relativePath: input.to }; },
        async adoptArtifact(input) { calls.push(['adopt', input]); return { ...asset, relativePath: input.relativePath }; },
      },
    },
  };
  const assets = createNimiLocalAppClient({ standardShell: shell }).storage.assets;
  await assets.write({
    relativePath: asset.relativePath,
    mediaType: 'IMAGE/PNG',
    body: (async function* () { yield Uint8Array.from([1, 2]); yield Uint8Array.from([3, 4]); })(),
  });
  const read = await assets.read({ relativePath: asset.relativePath });
  for await (const chunk of read.body) {
    assert.deepEqual([...chunk], [1, 2]);
    break;
  }
  assert.equal(readCanceled, true);
  assert.deepEqual(await assets.list({ prefix: 'media/' }), { assets: [asset], nextCursor: '' });
  assert.deepEqual(calls.slice(0, 3), [
    ['write', { relativePath: asset.relativePath, mediaType: 'image/png', body: [[1, 2], [3, 4]] }],
    ['read', { relativePath: asset.relativePath }],
    ['list', { prefix: 'media/' }],
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /account|subject|endpoint|proof|providerUrl|data:/iu);
  const unicodePath = '媒体/é.wav';
  const maximumPath = `${'a'.repeat(255)}/${'b'.repeat(255)}/${'c'.repeat(255)}/${'d'.repeat(254)}/e`;
  await assets.stat(unicodePath);
  await assets.stat(maximumPath);
  await assets.list({ prefix: '媒体/', pageSize: 500 });
  assert.deepEqual(calls.slice(-3), [
    ['stat', unicodePath],
    ['stat', maximumPath],
    ['list', { prefix: '媒体/', pageSize: 500 }],
  ]);
  await assert.rejects(() => assets.stat('媒体/e\u0301.wav'), { reasonCode: 'SDK_LOCAL_APP_ASSET_INPUT_INVALID' });
  await assert.rejects(() => assets.stat(`${maximumPath}x`), { reasonCode: 'SDK_LOCAL_APP_ASSET_INPUT_INVALID' });
  await assert.rejects(() => assets.list({ prefix: '媒体/', pageSize: 501 }), { reasonCode: 'SDK_LOCAL_APP_ASSET_INPUT_INVALID' });
  await assert.rejects(
    () => assets.adoptArtifact({ artifactId: 'artifact-1', relativePath: '../escape.png' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_ASSET_INPUT_INVALID',
  );
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

test('Model Config projects bounded read-only machine selections', async () => {
  const base = standardShell([]);
  const shell: NimiLocalAppStandardShell = {
    ...base,
    modelConfig: { localSelections: async () => [{
      capabilityContract: 'text.generate',
      state: 'selected',
      configurationId: null,
      displayName: 'gemma4-26b',
      supportedFeatures: ['input.image'],
      reasons: [],
      effectiveDefaults: { temperature: '0.8', seed: 'random' },
    }] },
  };
  const selections = await createNimiLocalAppClient({ standardShell: shell })
    .modelConfig.localSelections();
  assert.deepEqual(selections, [{
    capabilityContract: 'text.generate',
    state: 'selected',
    configurationId: null,
    displayName: 'gemma4-26b',
    supportedFeatures: ['input.image'],
    reasons: [],
    effectiveDefaults: { temperature: '0.8', seed: 'random' },
  }]);
  assert.doesNotMatch(JSON.stringify(selections), /config-private|binding|asset|path/iu);

  const invalidShell: NimiLocalAppStandardShell = {
    ...base,
    modelConfig: { localSelections: async () => [{
      capabilityContract: 'text.generate',
      state: 'selected',
      configurationId: null,
      displayName: 'gemma4-26b',
      supportedFeatures: [],
      reasons: [],
      effectiveDefaults: { temperature: '界'.repeat(43) },
    }] },
  };
  await assert.rejects(
    () => createNimiLocalAppClient({ standardShell: invalidShell }).modelConfig.localSelections(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
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

test('Local App text stream preserves whitespace-bearing deltas as content', async () => {
  const base = standardShell([]);
  const shell: NimiLocalAppStandardShell = {
    ...base,
    ai: {
      ...base.ai,
      text: {
        ...base.ai.text,
        streamTurn: async () => ({
          events: {
            async *[Symbol.asyncIterator]() {
              yield { type: 'delta', sequence: '1', traceId: 'trace-text', text: 'hello ' };
              yield { type: 'delta', sequence: '2', traceId: 'trace-text', text: '\nworld' };
              yield { type: 'completed', sequence: '3', traceId: 'trace-text', finishReason: 'stop' };
            },
          },
          cancel: async () => undefined,
        }),
      },
    },
  };
  const subscription = await createNimiLocalAppClient({ standardShell: shell }).ai.text.streamTurn({
    messages: [{ role: 'user', text: 'hello' }],
  });
  const events = [];
  for await (const event of subscription) events.push(event);
  assert.deepEqual(events.map((event) => event.type === 'delta' ? event.text : event.finishReason), [
    'hello ', '\nworld', 'stop',
  ]);
});

test('App AIConfig is read-only and rejects binding material in its projection', async () => {
  const portableConfig = {
    owner: { owner: { oneofKind: 'app', app: { appId: 'app.example' } } },
    capabilities: [{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      defaults: {
        fields: { temperature: { kind: { oneofKind: 'numberValue', numberValue: 0.3 } } },
      },
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
    },
  };
  const client = createNimiLocalAppClient({ standardShell: shell });
  assert.deepEqual(await client.aiConfig.get(), portableConfig);
  assert.deepEqual(Object.keys(client.aiConfig), ['get']);

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
    () => client.ai.text.generateCandidate({
      messages: [{ role: 'user', text: 'hello' }], temperature: 0, topP: 0, maxTokens: 0,
      topK: 0, presencePenalty: 0, frequencyPenalty: 0, stop: ['END'], seed: 0,
    }),
    () => client.ai.text.streamTurn({
      messages: [{ role: 'user', text: 'hello' }], temperature: 0, topP: 0, maxTokens: 0,
      topK: 0, presencePenalty: 0, frequencyPenalty: 0, stop: ['END'], seed: 0,
    }),
    () => client.ai.scenario.execute({ type: 'text-embed', inputs: ['hello'] }),
    () => client.ai.scenarioJobs.submit({
      type: 'image-generate', prompt: 'hello', negativePrompt: '', n: 1,
      size: '', aspectRatio: '', quality: '', style: '', seed: 0,
      referenceImages: ['https://example.com/reference.png'],
      mask: 'https://example.com/mask.png', responseFormat: 'b64_json',
    }),
    () => client.ai.scenarioJobs.get('job-1'),
    () => client.ai.scenarioJobs.subscribe('job-1'),
    () => client.ai.scenarioJobs.cancel('job-1'),
    () => client.ai.artifacts.read('artifact-1'),
    () => client.ai.artifacts.upload({ bytes: new Uint8Array([1, 2]), mimeType: 'image/png' }),
    () => client.ai.voiceAssets.list(),
    () => client.aiConfig.get(),
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
    'ai.text.streamTurn',
    'ai.scenario.execute',
    'ai.scenarioJobs.submit',
    'ai.scenarioJobs.get',
    'ai.scenarioJobs.subscribe',
    'ai.scenarioJobs.cancel',
    'ai.artifacts.read',
    'ai.artifacts.upload',
    'ai.voiceAssets.list',
    'aiConfig.get',
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

test('local-app image generation preserves the route-neutral safe integer seed carrier', async () => {
  const calls: string[] = [];
  const jobs = createNimiLocalAppClient({ standardShell: standardShell(calls) }).ai.scenarioJobs;
  const spec = {
    type: 'image-generate' as const,
    prompt: 'hello', negativePrompt: '', size: '', aspectRatio: '', quality: '', style: '',
    referenceImages: [], mask: '', responseFormat: '' as const,
  };
  for (const seed of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(() => jobs.submit({ ...spec, seed }), isTypedOwnerUnavailable);
  }
  assert.deepEqual(calls, ['ai.scenarioJobs.submit', 'ai.scenarioJobs.submit']);
  for (const seed of [Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => jobs.submit({ ...spec, seed }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
    );
  }
  assert.deepEqual(calls, ['ai.scenarioJobs.submit', 'ai.scenarioJobs.submit']);
});

test('local-app artifact upload validates the closed image input and exact custody projection', async () => {
  const calls: unknown[] = [];
  const base = standardShell([]);
  const shell: NimiLocalAppStandardShell = {
    ...base,
    ai: {
      ...base.ai,
      artifacts: {
        ...base.ai.artifacts,
        async upload(input) {
          calls.push(input);
          return { artifactId: 'artifact-upload-1', sizeBytes: 2, mimeType: 'image/png' };
        },
      },
    },
  };
  const client = createNimiLocalAppClient({ standardShell: shell });
  await assert.deepEqual(
    await client.ai.artifacts.upload({ bytes: new Uint8Array([1, 2]), mimeType: 'image/png' }),
    { artifactId: 'artifact-upload-1', sizeBytes: 2, mimeType: 'image/png' },
  );
  assert.deepEqual(calls, [{ bytes: [1, 2], mimeType: 'image/png' }]);
  await assert.rejects(
    () => client.ai.artifacts.upload({ bytes: new Uint8Array([1]), mimeType: 'video/mp4' as never }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
});

test('local-app video jobs admit only the canonical seed range', async () => {
  const calls: unknown[] = [];
  const base = standardShell([]);
  const job = {
    jobId: 'job-video-1', scenarioType: 'video-generate' as const, status: 'submitted' as const,
    progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0,
    reasonCode: '', reasonDetail: '', artifacts: [], traceId: 'trace-video-1',
    createdAt: null, updatedAt: null, transcriptionText: '',
  };
  const client = createNimiLocalAppClient({
    standardShell: {
      ...base,
      ai: {
        ...base.ai,
        scenarioJobs: {
          ...base.ai.scenarioJobs,
          async submit(spec) {
            calls.push(spec);
            return { job };
          },
        },
      },
    },
  });
  const spec = {
    type: 'video-generate' as const,
    prompt: 'draw a moon',
    negativePrompt: '',
    mode: 't2v' as const,
    content: [],
    options: { resolution: '720p', ratio: '16:9', seed: -1 },
  };

  await assert.deepEqual(await client.ai.scenarioJobs.submit(spec), { job });
  assert.deepEqual(calls, [spec]);
  const adapter = createNimiLocalAppRuntimeScenarioJobClient(client.ai);
  await adapter.submitScenarioJob(buildNimiRuntimeGenerationSubmitRequest(
    { appId: 'app.test' },
    {
      scenario: createNimiVideoGenerationScenario({
        kind: 'video', mode: 't2v', prompt: 'draw a moon',
        options: { resolution: '720p', ratio: '16:9', seed: -1 },
      }),
      requestId: 'request-video-seed',
      idempotencyKey: 'idempotency-video-seed',
    },
  ));
  assert.equal((calls[1] as { options: { seed: number } }).options.seed, -1);
  await assert.rejects(
    () => client.ai.scenarioJobs.submit({
      ...spec,
      options: { ...spec.options, seed: 4_294_967_296 },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
});

test('local-app voice creation uses one canonical contract with typed source provenance', async () => {
  const calls: unknown[] = [];
  const base = standardShell([]);
  const job = {
    jobId: 'job-voice-1', scenarioType: 'voice-create' as const, status: 'submitted' as const,
    progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0,
    reasonCode: '', reasonDetail: '', artifacts: [], traceId: 'trace-voice-1',
    createdAt: null, updatedAt: null, transcriptionText: '',
  };
  const asset = {
    voiceAssetId: 'voice-asset-1', creationSource: 'reference-audio' as const, status: 'active' as const,
    createdAt: null, updatedAt: null, expiresAt: null,
  };
  const voiceReference = { kind: 'voice_asset_id' as const, voiceAssetId: asset.voiceAssetId };
  const client = createNimiLocalAppClient({
    standardShell: {
      ...base,
      ai: {
        ...base.ai,
        scenarioJobs: {
          ...base.ai.scenarioJobs,
          async submit(spec) {
            calls.push(spec);
            return { job };
          },
          async get() {
            return {
              job: { ...job, status: 'completed' as const, progressPercent: 100, progressCurrentStep: 1, progressTotalSteps: 1 },
              asset,
              voiceReference,
            };
          },
        },
      },
    },
  });

  const referenceAudioSpec = {
    type: 'voice-create' as const,
    creationSource: 'reference-audio' as const,
    referenceAudio: { type: 'bytes' as const, bytes: [1, 2, 3] },
    referenceAudioMime: 'audio/wav', languageHints: ['en'], preferredName: 'Nimi', text: 'Hello',
  };
  assert.deepEqual(await client.ai.scenarioJobs.submit(referenceAudioSpec), { job });
  assert.deepEqual(await client.ai.scenarioJobs.get(job.jobId), {
    job: { ...job, status: 'completed', progressPercent: 100, progressCurrentStep: 1, progressTotalSteps: 1 },
    asset,
    voiceReference,
  });

  const adapter = createNimiLocalAppRuntimeScenarioJobClient(client.ai);
  const request = (source: SubmitScenarioJobRequest['spec']): SubmitScenarioJobRequest => ({
    head: undefined, scenarioType: ScenarioType.VOICE_CREATE, executionMode: ExecutionMode.ASYNC_JOB,
    spec: source, requestId: 'request-voice', idempotencyKey: 'idempotency-voice', labels: {}, extensions: [],
  });
  await adapter.submitScenarioJob(request({
    spec: {
      oneofKind: 'voiceCreate',
      voiceCreate: {
        targetModelId: '',
        source: {
          oneofKind: 'referenceAudio',
          referenceAudio: {
            referenceAudioBytes: Uint8Array.from([4, 5]), referenceAudioUri: '', referenceAudioMime: 'audio/wav',
            languageHints: ['zh'], preferredName: 'Reference', text: 'Preview',
          },
        },
      },
    },
  }));
  await adapter.submitScenarioJob(request({
    spec: {
      oneofKind: 'voiceCreate',
      voiceCreate: {
        targetModelId: '',
        source: {
          oneofKind: 'textDescription',
          textDescription: { instructionText: 'Warm and calm', previewText: 'Hello', language: 'en', preferredName: 'Designed' },
        },
      },
    },
  }));

  assert.deepEqual(calls, [
    referenceAudioSpec,
    {
      type: 'voice-create', creationSource: 'reference-audio',
      referenceAudio: { type: 'bytes', bytes: [4, 5] }, referenceAudioMime: 'audio/wav',
      languageHints: ['zh'], preferredName: 'Reference', text: 'Preview',
    },
    {
      type: 'voice-create', creationSource: 'text-description',
      instructionText: 'Warm and calm', previewText: 'Hello', language: 'en', preferredName: 'Designed',
    },
  ]);

  for (const invalid of [
    { ...referenceAudioSpec, referenceAudioMime: '' },
    { ...referenceAudioSpec, languageHints: [''] },
  ]) {
    await assert.rejects(
      () => client.ai.scenarioJobs.submit(invalid),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
    );
  }
  await assert.rejects(
    () => adapter.submitScenarioJob(request({
      spec: {
        oneofKind: 'voiceCreate',
        voiceCreate: { targetModelId: '', source: undefined as never },
      },
    })),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  await assert.rejects(
    () => adapter.submitScenarioJob(request({
      spec: {
        oneofKind: 'voiceCreate',
        voiceCreate: {
          targetModelId: 'caller-selected-model',
          source: {
            oneofKind: 'textDescription',
            textDescription: { instructionText: 'Warm', previewText: '', language: '', preferredName: '' },
          },
        },
      },
    })),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  assert.equal(calls.length, 3);
});

test('local-app voice runner preserves the trimmed terminal result and consumes one carrier Get', async () => {
  const base = standardShell([]);
  let localGets = 0;
  const submittedJob = {
    jobId: 'job-voice-terminal', scenarioType: 'voice-create' as const, status: 'submitted' as const,
    progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 1,
    reasonCode: '', reasonDetail: '', artifacts: [], traceId: 'trace-voice-terminal',
    createdAt: { seconds: '10', nanos: 1 }, updatedAt: { seconds: '10', nanos: 1 }, transcriptionText: '',
  };
  const completedJob = {
    ...submittedJob,
    status: 'completed' as const,
    progressPercent: 100,
    progressCurrentStep: 1,
    updatedAt: { seconds: '20', nanos: 2 },
  };
  const asset = {
    voiceAssetId: 'voice-asset-terminal', creationSource: 'text-description' as const, status: 'active' as const,
    createdAt: { seconds: '20', nanos: 2 }, updatedAt: { seconds: '20', nanos: 2 }, expiresAt: null,
  };
  const voiceReference = { kind: 'voice_asset_id' as const, voiceAssetId: asset.voiceAssetId };
  const shell: NimiLocalAppStandardShell = {
    ...base,
    ai: {
      ...base.ai,
      scenarioJobs: {
        ...base.ai.scenarioJobs,
        async submit() { return { job: submittedJob }; },
        async get() {
          localGets += 1;
          return { job: completedJob, asset, voiceReference };
        },
        async subscribe() {
          return {
            events: (async function* () {
              yield {
                eventType: 'completed' as const,
                sequence: '1',
                traceId: completedJob.traceId,
                timestamp: completedJob.updatedAt,
                job: completedJob,
              };
            })(),
            async cancel() {},
          };
        },
      },
    },
  };
  const local = createNimiLocalAppClient({ standardShell: shell });
  const adapter = createNimiLocalAppRuntimeScenarioJobClient(local.ai);
  const result = await runNimiRuntimeScenarioJob({
    ai: adapter,
    request: {
      head: undefined,
      scenarioType: ScenarioType.VOICE_CREATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      spec: {
        spec: {
          oneofKind: 'voiceCreate',
          voiceCreate: {
            targetModelId: '',
            source: {
              oneofKind: 'textDescription',
              textDescription: {
                instructionText: 'Warm and calm',
                previewText: 'Hello',
                language: 'en',
                preferredName: 'Designed',
              },
            },
          },
        },
      },
      requestId: 'request-voice-terminal',
      idempotencyKey: 'idempotency-voice-terminal',
      labels: {},
      extensions: [],
    },
  });

  assert.equal(result.job.status, ScenarioJobStatus.COMPLETED);
  assert.deepEqual(result.asset, {
    voiceAssetId: asset.voiceAssetId,
    status: VoiceAssetStatus.ACTIVE,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    expiresAt: undefined,
    creationSource: VoiceCreationSource.TEXT_DESCRIPTION,
  });
  assert.deepEqual(result.voiceReference, {
    kind: VoiceReferenceKind.VOICE_ASSET,
    reference: { oneofKind: 'voiceAssetId', voiceAssetId: asset.voiceAssetId },
  });
  assert.deepEqual(result.artifacts, []);
  assert.equal(localGets, 1);

});

test('local-app Scenario Job adapter runs the unchanged SDK image runner without reading artifact bytes', async () => {
  const calls: unknown[] = [];
  const base = standardShell([]);
  const job = {
    jobId: 'job-1', scenarioType: 'image-generate' as const, status: 'completed' as const,
    progressPercent: 100, progressCurrentStep: 1, progressTotalSteps: 1,
    reasonCode: '', reasonDetail: '', traceId: 'trace-1',
    artifacts: [{
      artifactId: 'artifact-1', mimeType: 'image/png', bytes: [], sizeBytes: 2,
      sha256: 'sha256', durationMs: 0, width: 1, height: 1, sampleRateHz: 0, channels: 0,
    }],
    createdAt: null, updatedAt: null, transcriptionText: '',
  };
  const shell: NimiLocalAppStandardShell = {
    ...base,
    ai: {
      ...base.ai,
      scenarioJobs: {
        async submit(spec) { calls.push(['submit', spec]); return { job }; },
        async get(jobId) { calls.push(['get', jobId]); return { job, asset: null, voiceReference: null }; },
        async subscribe(jobId) {
          calls.push(['subscribe', jobId]);
          return {
            events: (async function* () {
              yield { eventType: 'completed', sequence: '1', traceId: 'trace-1', timestamp: null, job };
            })(),
            async cancel() { calls.push(['stream.cancel']); },
          };
        },
        async cancel(jobId, reason) { calls.push(['cancel', jobId, reason]); return { job }; },
      },
      artifacts: {
        ...base.ai.artifacts,
        async read(artifactId) {
          calls.push(['artifact.read', artifactId]);
          return { bytes: [1, 2], mimeType: 'image/png', sizeBytes: 2 };
        },
      },
    },
  };
  const local = createNimiLocalAppClient({ standardShell: shell });
  const adapter = createNimiLocalAppRuntimeScenarioJobClient(local.ai);
  const result = await runNimiRuntimeImageGeneration({
    runtime: adapter,
    head: { appId: 'app.test' },
    prompt: 'draw a moon',
    seed: -2_147_483_648,
    requestId: 'request-1',
    idempotencyKey: 'idempotency-1',
  });

  assert.equal(result.job.jobId, 'job-1');
  assert.deepEqual([...result.artifacts[0]!.bytes], []);
  assert.deepEqual(calls[0], ['submit', {
    type: 'image-generate', prompt: 'draw a moon', negativePrompt: '',
    size: '', aspectRatio: '', quality: '', style: '',
    seed: -2_147_483_648,
    referenceImages: [], mask: '', responseFormat: '',
  }]);
  assert.deepEqual(calls.slice(1), [
    ['subscribe', 'job-1'],
    ['get', 'job-1'],
    ['get', 'job-1'],
  ]);
  assert.equal(JSON.stringify(calls).includes('app.test'), false);
  assert.equal(JSON.stringify(calls).includes('idempotency-1'), false);
});

test('local-app client rejects the retired host namespace instead of decoding it', () => {
  const shell = standardShell([]) as NimiLocalAppStandardShell & Record<string, unknown>;
  shell.permission = { status: async () => ({}), request: async () => ({}) };
  assert.throws(
    () => createNimiLocalAppClient({ standardShell: shell }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_CARRIER_REQUIRED',
  );
});
