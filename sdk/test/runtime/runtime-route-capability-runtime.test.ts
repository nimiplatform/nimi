import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeRouteCapabilityRuntimeWithHost,
  type RuntimeRouteBinding,
  type RuntimeRouteOptionsSnapshot,
} from '../../src/runtime/index.js';

function encodeRouteDescribePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const selectedLocalBinding: RuntimeRouteBinding = {
  source: 'local',
  connectorId: '',
  model: 'local/tester-model',
  modelId: 'local/tester-model',
  localModelId: 'tester-local',
  engine: 'llama',
  provider: 'llama',
};

function createSnapshot(selected: RuntimeRouteBinding): RuntimeRouteOptionsSnapshot {
  return {
    capability: 'text.generate',
    selected,
    local: {
      models: [{
        localModelId: 'tester-local',
        label: 'Tester Local',
        engine: 'llama',
        model: 'local/tester-model',
        modelId: 'local/tester-model',
        provider: 'llama',
        status: 'installed',
        capabilities: ['chat', 'text.generate'],
      }],
    },
    connectors: [],
  };
}

test('runtime route capability host runtime resolves, checks health, and describes through injected host surfaces', async () => {
  const captured = {
    healthModelId: '',
    describeTargetId: '',
    scenarioNamespace: '',
  };
  const routeRuntime = createRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async () => createSnapshot(selectedLocalBinding),
    checkHealth: async (input) => {
      captured.healthModelId = String(input.localModelId || '');
      return {
        provider: 'llama',
        status: 'healthy',
        detail: '',
      };
    },
    describeTargetId: 'tester.route.describe',
    buildDescribeCallOptions: async (input) => {
      captured.describeTargetId = input.targetId;
      return {
        timeoutMs: input.timeoutMs,
        metadata: {
          callerKind: 'third-party-app',
          callerId: 'tester.route.describe',
          surfaceId: 'tester',
        },
      };
    },
    getDescribeHost: () => ({
      appId: 'nimi.tester',
      executeScenario: async (request, options) => {
        captured.scenarioNamespace = String(request.extensions?.[0]?.namespace || '');
        options._responseMetadataObserver?.({
          'x-nimi-route-describe-result': encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v1',
            resolvedBindingRef: 'local:text.generate:llama:tester-local',
            metadataKind: 'text.generate',
            metadata: {
              supportsThinking: true,
              traceModeSupport: 'separate',
              supportsImageInput: false,
              supportsAudioInput: false,
              supportsVideoInput: false,
              supportsArtifactRefInput: false,
            },
          }),
        });
        return {};
      },
    }),
  });

  const resolved = await routeRuntime.resolve({
    capability: 'text.generate',
    binding: selectedLocalBinding,
  });
  const health = await routeRuntime.checkHealth({
    capability: 'text.generate',
    binding: selectedLocalBinding,
  });
  const metadata = await routeRuntime.describe({
    capability: 'text.generate',
    resolvedBindingRef: resolved.resolvedBindingRef,
  });

  assert.equal(resolved.resolvedBindingRef, 'local:text.generate:llama:tester-local');
  assert.equal(health.healthy, true);
  assert.equal(metadata.metadata.supportsThinking, true);
  assert.equal(captured.healthModelId, 'tester-local');
  assert.equal(captured.describeTargetId, 'tester.route.describe');
  assert.equal(captured.scenarioNamespace, 'nimi.scenario.text_generate.route_describe');
});

test('runtime route capability host runtime fails closed when describe has no resolved binding ref cache', async () => {
  const routeRuntime = createRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async () => createSnapshot(selectedLocalBinding),
    checkHealth: async () => ({ status: 'healthy' }),
    describeTargetId: 'tester.route.describe',
    buildDescribeCallOptions: async () => ({}),
    getDescribeHost: () => ({
      appId: 'nimi.tester',
      executeScenario: async () => ({}),
    }),
  });

  await assert.rejects(
    () => routeRuntime.describe({
      capability: 'text.generate',
      resolvedBindingRef: 'missing-ref',
    }),
    /RUNTIME_ROUTE_DESCRIBE_BINDING_REF_MISSING/,
  );
});

test('runtime route capability host runtime describes cloud routes without undefined Struct fields', async () => {
  const cloudBinding: RuntimeRouteBinding = {
    source: 'cloud',
    connectorId: 'tester-cloud',
    provider: 'tester',
    model: 'tester-model',
  };
  const routeRuntime = createRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async () => ({
      capability: 'text.generate',
      selected: cloudBinding,
      local: { models: [] },
      connectors: [{
        id: 'tester-cloud',
        label: 'Tester Cloud',
        provider: 'tester',
        models: ['tester-model'],
        modelCapabilities: { 'tester-model': ['text.generate'] },
      }],
    }),
    checkHealth: async () => ({ status: 'healthy' }),
    describeTargetId: 'tester.route.describe',
    buildDescribeCallOptions: async () => ({}),
    getDescribeHost: () => ({
      appId: 'nimi.tester',
      executeScenario: async (_request, options) => {
        options._responseMetadataObserver?.({
          'x-nimi-route-describe-result': encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v1',
            resolvedBindingRef: 'cloud:text.generate:tester-cloud:tester-model',
            metadataKind: 'text.generate',
            metadata: {
              supportsThinking: false,
              traceModeSupport: 'none',
              supportsImageInput: false,
              supportsAudioInput: false,
              supportsVideoInput: false,
              supportsArtifactRefInput: false,
            },
          }),
        });
        return {};
      },
    }),
  });

  const resolved = await routeRuntime.resolve({
    capability: 'text.generate',
    binding: cloudBinding,
  });
  const metadata = await routeRuntime.describe({
    capability: 'text.generate',
    resolvedBindingRef: resolved.resolvedBindingRef,
  });

  assert.equal(metadata.resolvedBindingRef, 'cloud:text.generate:tester-cloud:tester-model');
});
