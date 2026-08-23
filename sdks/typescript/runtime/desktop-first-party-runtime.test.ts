import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import type { AIConfigCapabilityIntent } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import { createNimiDesktopFirstPartyRuntimeClients } from './desktop-first-party-runtime';
import { createNimiSharedLocalAgentAISurface } from './shared-local-agent-ai-config';

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
            { role: 5, capabilityContract: 'image.generate' },
          ],
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
    ['conversation.action.image', 'image.generate'],
  ]);
  assert.deepEqual(await sharedAI.sharedAIConfig.listOptions({
    kind: 'local-loadouts',
    capabilityContract: 'text.generate',
  }), { kind: 'local-loadouts', options: [], truncated: false });

  assert.deepEqual(calls.map((call) => call.methodId), [
    '/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig',
    '/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig',
    '/nimi.runtime.v1.RuntimeAgentService/GetSharedLocalAgentAIConfig',
    '/nimi.runtime.v1.RuntimeAgentService/ListSharedLocalAgentAIConfigOptions',
  ]);
  for (const call of calls) {
    assert.equal(call.metadata?.appId, undefined, 'protected host owns caller identity');
  }
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

test('Desktop account execution client carries Scenario unary and streams with Scenario jobs', async () => {
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
  });

  await clients.aiExecution.executeScenario({
    head: { appId: 'nimi.desktop', subjectUserId: '', timeoutMs: 0 },
    scenarioType: 1,
    executionMode: 1,
    extensions: [],
  });
  for await (const _event of clients.aiExecution.streamScenario({
    head: { appId: 'nimi.desktop', subjectUserId: '', timeoutMs: 0 },
    scenarioType: 1,
    executionMode: 2,
    extensions: [],
  })) {
    break;
  }

  assert.equal(calls[0]?.methodId, '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario');
  assert.equal(calls[0]?.metadata?.appId, undefined, 'protected host owns caller identity');
  assert.equal(streams[0]?.methodId, '/nimi.runtime.v1.RuntimeAiService/StreamScenario');
  assert.equal(streams[0]?.metadata?.appId, undefined, 'protected host owns caller identity');
});
