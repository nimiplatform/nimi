import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import type { AIConfigCapabilityIntent } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import { createNimiDesktopFirstPartyRuntimeClients } from './desktop-first-party-runtime';
import { createNimiSharedLocalAgentAISurface } from './shared-local-agent-ai-config';

test('Desktop protected Host runtime does not expose an App Product Plane client', () => {
  const calls: CoreUnaryRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      throw new Error(`unexpected Runtime method: ${request.methodId}`);
    },
    async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('unexpected Runtime stream');
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
  });

  assert.equal('localAppProduct' in clients, false);
  assert.equal('aiExecution' in clients, false);
  for (const retiredRawMethod of [
    'listLocalAppAgentReferences',
    'getLocalAppAgentManagerSnapshot',
    'inspectLocalAppAgentMemory',
    'openLocalAppConversation',
    'openLocalAppAgentRealtime',
  ]) {
    assert.equal(retiredRawMethod in clients.accountProduct.agents, false);
    assert.equal(retiredRawMethod in clients.agentPurpose, false);
  }
  assert.equal(calls.length, 0);
});

test('Desktop account product binds AIConfig to one explicit admitted App owner', async () => {
  const calls: CoreUnaryRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      if (request.methodId === '/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig') {
        const body = request.body as { owner?: unknown };
        return { config: { owner: body.owner, capabilities: [] }, revision: '0', effectiveSelections: [] } as Response;
      }
      if (request.methodId === '/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig') {
        const body = request.body as { config?: unknown };
        return { config: body.config, revision: '1', committed: true, reasonCode: 0 } as Response;
      }
      if (request.methodId === '/nimi.runtime.v1.RuntimeAgentService/ListSharedLocalAgentAIConfigOptions') {
        const body = request.body as { query?: { oneofKind?: string } };
        if (body.query?.oneofKind === 'presetVoices') {
          return {
            result: {
              oneofKind: 'presetVoices',
              presetVoices: {
                options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
              },
            },
            truncated: false,
          } as Response;
        }
        return {
          result: { oneofKind: 'localLoadouts', localLoadouts: { options: [] } },
          truncated: false,
        } as Response;
      }
      if (request.methodId === '/nimi.runtime.v1.RuntimeAgentService/GetSharedLocalAgentAIConfig') {
        return {
          revision: '0', effectiveSelections: [],
          participation: [
            { role: 1, capabilityContract: 'text.generate' },
            { role: 2, capabilityContract: 'text.embed' },
            { role: 3, capabilityContract: 'audio.transcribe' },
            { role: 4, capabilityContract: 'audio.synthesize' },
            { role: 6, capabilityContract: 'realtime.interact' },
            { role: 5, capabilityContract: 'image.generate' },
          ],
        } as Response;
      }
      if (request.methodId === '/nimi.runtime.v1.RuntimeAgentService/ReadConversationArtifact') {
        return {
          artifactId: 'artifact-1', data: Uint8Array.from([1, 2, 3]), mimeType: 'image/png', byteLength: '3',
        } as Response;
      }
      throw new Error(`unexpected Runtime method: ${request.methodId}`);
    },
    async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('unexpected Runtime stream');
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
  });

  const managed = clients.accountProduct.appAIConfig('acme.widget');
  const existing = await managed.get();
  assert.equal(existing.config?.owner?.owner.oneofKind, 'app');
  if (existing.config?.owner?.owner.oneofKind === 'app') {
    assert.equal(existing.config.owner.owner.app.appId, 'acme.widget');
  }

  const localIntent: AIConfigCapabilityIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };
  const overwritten = await managed.overwrite({ expectedRevision: '0', capabilities: [localIntent] });
  assert.equal(overwritten.config?.capabilities[0]?.capabilityContract, 'text.generate');
  assert.equal(overwritten.config?.owner?.owner.oneofKind, 'app');
  if (overwritten.config?.owner?.owner.oneofKind === 'app') {
    assert.equal(overwritten.config.owner.owner.app.appId, 'acme.widget');
  }

  const sharedAI = createNimiSharedLocalAgentAISurface({
    runtime: {
      appId: 'nimi.desktop',
      auth: {} as never,
      agent: clients.accountProduct.agents,
    },
    getSubjectUserId: () => 'account-a',
    withScopes: (_scopes, operation) => operation({}),
  });
  const sharedSnapshot = await sharedAI.sharedAIConfig.get();
  assert.deepEqual(sharedSnapshot.participation.map(({ role, capabilityContract }) => [role, capabilityContract]), [
    ['conversation.primary', 'text.generate'],
    ['memory.embedding', 'text.embed'],
    ['conversation.input.voice', 'audio.transcribe'],
    ['conversation.output.voice', 'audio.synthesize'],
    ['conversation.realtime', 'realtime.interact'],
    ['conversation.action.image', 'image.generate'],
  ]);
  assert.deepEqual(await sharedAI.sharedAIConfig.listOptions({
    kind: 'local-loadouts',
    capabilityContract: 'text.generate',
  }), { kind: 'local-loadouts', options: [], truncated: false });
  const presetAbort = new AbortController();
  assert.deepEqual(await sharedAI.sharedAIConfig.listOptions({ kind: 'preset-voices' }, { signal: presetAbort.signal }), {
    kind: 'preset-voices',
    options: [{ voiceId: 'serena', name: 'Serena', supportedLangs: ['zh', 'en'] }],
    truncated: false,
  });
  await assert.rejects(
    () => sharedAI.sharedAIConfig.listOptions({
      kind: 'preset-voices',
      capabilityContract: 'audio.synthesize',
    } as never),
    /unknown fields/u,
  );
  const presetCall = calls.find((call) => (
    call.methodId === '/nimi.runtime.v1.RuntimeAgentService/ListSharedLocalAgentAIConfigOptions'
    && (call.body as { query?: { oneofKind?: string } }).query?.oneofKind === 'presetVoices'
  ));
  assert.equal(presetCall?.signal, presetAbort.signal);
  const conversationArtifact = await clients.accountProduct.agents.readConversationArtifact({
    context: {
      ownerUserId: 'account-a',
      runtimeSourceRef: 'runtime-source-1',
      localAgentRef: 'local-agent-1',
    },
    agentId: 'local-agent-1',
    conversationAnchorId: 'anchor-1',
    artifactId: 'artifact-1',
  });
  assert.deepEqual([...conversationArtifact.data], [1, 2, 3]);

  assert.deepEqual(calls.map((call) => call.methodId), [
    '/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig',
    '/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig',
    '/nimi.runtime.v1.RuntimeAgentService/GetSharedLocalAgentAIConfig',
    '/nimi.runtime.v1.RuntimeAgentService/ListSharedLocalAgentAIConfigOptions',
    '/nimi.runtime.v1.RuntimeAgentService/ListSharedLocalAgentAIConfigOptions',
    '/nimi.runtime.v1.RuntimeAgentService/ReadConversationArtifact',
  ]);
  const artifactCall = calls.at(-1)?.body as { context?: { appId?: string; localAgentRef?: string } };
  assert.equal(artifactCall.context?.appId, 'nimi.desktop');
  assert.equal(artifactCall.context?.localAgentRef, 'local-agent-1');
  for (const call of calls) {
    assert.equal(call.metadata?.appId, undefined, 'protected host owns caller identity');
  }
});

test('shared LocalAgent AIConfig rejects retired Local loadout references before transport', async () => {
  let overwriteCalls = 0;
  const sharedAI = createNimiSharedLocalAgentAISurface({
    runtime: {
      appId: 'nimi.desktop',
      auth: {} as never,
      agent: {
        async overwriteSharedLocalAgentAIConfig() {
          overwriteCalls += 1;
          throw new Error('transport must not be called');
        },
      },
    },
    getSubjectUserId: () => 'account-a',
    withScopes: (_scopes, operation) => operation({}),
  });

  await assert.rejects(
    () => sharedAI.sharedAIConfig.overwrite({
      expectedRevision: '0',
      capabilities: [{
        capabilityContract: 'text.generate',
        requiredFeatures: [],
        route: { oneofKind: 'local', local: { loadoutRef: 'loadout.legacy' } },
      } as never],
    }),
    /must not contain a Loadout reference/u,
  );
  assert.equal(overwriteCalls, 0);
});

test('shared LocalAgent preset options reject over-bounded Runtime rows', async () => {
  const shared = createNimiSharedLocalAgentAISurface({
    runtime: {
      appId: 'nimi.desktop', auth: {} as never,
      agent: {
        async listSharedLocalAgentAIConfigOptions() {
          return {
            result: {
              oneofKind: 'presetVoices' as const,
              presetVoices: {
                options: Array.from({ length: 101 }, (_, index) => ({
                  voiceId: `voice-${index}`, name: `Voice ${index}`, supportedLangs: ['en'],
                })),
              },
            },
            truncated: true,
          };
        },
      },
    },
    getSubjectUserId: () => 'account-a',
    withScopes: (_scopes, operation) => operation({}),
  });
  await assert.rejects(
    () => shared.sharedAIConfig.listOptions({ kind: 'preset-voices' }),
    /row bound/u,
  );
});

test('Desktop account-product raw shared overwrite rejects retired Local loadout references', async () => {
  const calls: CoreUnaryRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      throw new Error('transport must not be called');
    },
    async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('unexpected Runtime stream');
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
  });

  await assert.rejects(
    () => clients.accountProduct.agents.overwriteSharedLocalAgentAIConfig({
      expectedRevision: '0',
      capabilities: [{
        capabilityContract: 'text.generate',
        requiredFeatures: [],
        route: { oneofKind: 'local', local: { loadoutRef: 'loadout.legacy' } },
      } as never],
    } as never),
    /must not contain a Loadout reference/u,
  );
  assert.equal(calls.length, 0);
});

test('Desktop account product imports only a portable Profile document and lists the catalog', async () => {
  const calls: CoreUnaryRequest[] = [];
  const artifactJson = JSON.stringify({
    profileId: 'profile.portable',
    title: 'Portable',
    capabilities: { 'text.generate': { route: 'local' } },
  });
  const invalidArtifactJson = JSON.stringify({
    profileId: 'profile.invalid',
    title: 'Invalid',
    capabilities: { 'text.generate': { route: 'local', defaults: { token: 'private' } } },
  });
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      const body = request.body as { profileJson?: Uint8Array };
      const profileJson = body.profileJson ?? new TextEncoder().encode(artifactJson);
      if (request.methodId.endsWith('/ImportPortableAIProfile')) {
        return { profile: { profileId: 'profile.portable', title: 'Portable', profileJson } } as Response;
      }
      if (request.methodId.endsWith('/ListPortableAIProfiles')) {
        return { profiles: [
          { profileId: 'profile.invalid', title: 'Invalid', profileJson: new TextEncoder().encode(invalidArtifactJson) },
          { profileId: 'profile.portable', title: 'Portable', profileJson },
        ] } as Response;
      }
      throw new Error(`unexpected Runtime method: ${request.methodId}`);
    },
    async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('unexpected Runtime stream');
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
    getSubjectUserId: () => 'account-a',
  });

  const imported = await clients.accountProduct.profiles.import(artifactJson);
  const listed = await clients.accountProduct.profiles.list();
  assert.equal(imported.source.profileId, 'profile.portable');
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.artifactJson, artifactJson);
  assert.deepEqual(calls.map((call) => call.methodId), [
    '/nimi.runtime.v1.RuntimeAgentService/ImportPortableAIProfile',
    '/nimi.runtime.v1.RuntimeAgentService/ListPortableAIProfiles',
  ]);
  for (const call of calls) {
    const context = (call.body as { context?: { appId?: string; subjectUserId?: string; ownerUserId?: string } }).context;
    assert.deepEqual(context, {
      appId: 'nimi.desktop',
      subjectUserId: 'account-a',
      ownerUserId: 'account-a',
      runtimeSourceRef: '',
      localAgentRef: '',
    });
  }
});

test('Desktop protected Host runtime exposes only the typed external-AI-host model facade', async () => {
  const calls: CoreUnaryRequest[] = [];
  const streams: CoreStreamRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      return {} as Response;
    },
    async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
      streams.push(request);
      yield {} as Response;
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
    getSubjectUserId: () => 'account-a',
  });

  assert.equal('aiExecution' in clients, false);
  assert.deepEqual(Object.keys(clients.externalAIHost), ['createTextModel']);
  const model = clients.externalAIHost.createTextModel();
  assert.equal(model.model.modelId, 'text.generate');
  assert.deepEqual(Object.keys(model).sort(), ['generateText', 'model', 'streamText']);
  assert.equal(calls.length, 0);
  assert.equal(streams.length, 0);

  await assert.rejects(() => model.generateText({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  }));
  const executeCall = calls.find((call) => call.methodId === '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario');
  assert.equal((executeCall?.body as { head?: { subjectUserId?: string } })?.head?.subjectUserId, 'account-a');
});
