import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RoutePolicy,
  RuntimeAgentAIConfigReadinessState,
  type RuntimeAgentAIConfig,
  type RuntimeAgentAIConfigReadinessSnapshot,
} from '../core-generated/runtime-typed-client.js';
import {
  createNimiRuntimeAgentModelSettingsModule,
  createNimiRuntimeAgentModelSettingsScopeRef,
} from './runtime-agent-model-settings.js';

const identity = {
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'realm-agent:source-1',
  localAgentRef: 'local-agent:runtime-model-settings-1',
};

function config(revision = '9007199254740993'): RuntimeAgentAIConfig {
  return {
    agentInstanceId: identity.localAgentRef,
    revision,
    intents: [
      { capability: 'text.generate', modelId: 'local/text', routePolicy: RoutePolicy.LOCAL, connectorId: '', voiceReferenceRef: '', imagePolicyRef: '', provider: '' },
      { capability: 'text.embed', modelId: 'local/embed', routePolicy: RoutePolicy.LOCAL, connectorId: '', voiceReferenceRef: '', imagePolicyRef: '', provider: '' },
      { capability: 'audio.transcribe', modelId: 'local/stt', routePolicy: RoutePolicy.LOCAL, connectorId: '', voiceReferenceRef: '', imagePolicyRef: '', provider: '' },
    ],
    updatedByAppId: 'desktop.app',
  };
}

function readiness(revision = '9007199254740993'): RuntimeAgentAIConfigReadinessSnapshot {
  return {
    agentInstanceId: identity.localAgentRef,
    configRevision: revision,
    capabilities: [
      { capability: 'text.generate', state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY, reasonCode: '' },
      { capability: 'text.embed', state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY, reasonCode: '' },
      { capability: 'audio.transcribe', state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED, reasonCode: '' },
    ],
  };
}

const withScopes = async <T>(_scopes: readonly string[], operation: (options: {}) => Promise<T>): Promise<T> => operation({});

test('first-party model settings projects canonical scope, dynamic audio.transcribe, routes, readiness, and decimal revision', async () => {
  const module = createNimiRuntimeAgentModelSettingsModule({
    runtime: {
      appId: 'desktop.app',
      auth: {},
      agent: {
        getRuntimeAgentAIConfig: async () => ({ config: config() }),
        upsertRuntimeAgentAIConfig: async () => ({ config: config() }),
        getRuntimeAgentAIConfigReadiness: async () => ({ snapshot: readiness() }),
      },
    },
    getSubjectUserId: () => 'owner-1',
    withScopes,
  });
  const projection = await module.snapshot(identity);
  assert.deepEqual(projection.scopeRef, createNimiRuntimeAgentModelSettingsScopeRef(identity.localAgentRef));
  assert.deepEqual(projection.capabilities, ['text.generate', 'text.embed', 'audio.transcribe']);
  assert.equal(projection.routeIntents.find((intent) => intent.capability === 'audio.transcribe')?.model, 'local/stt');
  assert.equal(projection.readiness.find((item) => item.capability === 'audio.transcribe')?.state, 'blocked');
  assert.equal(projection.configurationRevision, '9007199254740993');
});

test('first-party model settings update resolves only after Runtime commit and matching readiness', async () => {
  let resolveCommit!: (value: { config: RuntimeAgentAIConfig }) => void;
  let resolveReadiness!: (value: { snapshot: RuntimeAgentAIConfigReadinessSnapshot }) => void;
  const commit = new Promise<{ config: RuntimeAgentAIConfig }>((resolve) => { resolveCommit = resolve; });
  const ready = new Promise<{ snapshot: RuntimeAgentAIConfigReadinessSnapshot }>((resolve) => { resolveReadiness = resolve; });
  const calls: unknown[] = [];
  const module = createNimiRuntimeAgentModelSettingsModule({
    runtime: {
      appId: 'desktop.app',
      auth: {},
      agent: {
        getRuntimeAgentAIConfig: async () => ({ config: config('1') }),
        upsertRuntimeAgentAIConfig: async (request) => { calls.push(request); return commit; },
        getRuntimeAgentAIConfigReadiness: async () => ready,
      },
    },
    getSubjectUserId: () => 'owner-1',
    withScopes,
  });
  let settled = false;
  const pending = module.update({
    ...identity,
    expectedConfigurationRevision: '9007199254740992',
    routeIntents: [
      { capability: 'text.generate', provider: '', model: 'local/text', routePolicy: 'local' },
      { capability: 'text.embed', provider: '', model: 'local/embed', routePolicy: 'local' },
      { capability: 'audio.transcribe', provider: '', model: 'local/stt', routePolicy: 'local' },
    ],
  }).finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveCommit({ config: config() });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  resolveReadiness({ snapshot: readiness() });
  const projection = await pending;
  assert.equal(projection.configurationRevision, '9007199254740993');
  assert.equal((calls[0] as { expectedRevision?: string }).expectedRevision, '9007199254740992');
});
