import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  RuntimeRouteBinding,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/ai';
import {
  buildConversationCapabilityProjection,
  createDefaultConversationCapabilitySelectionStore,
  getConversationCapabilityRouteRuntime,
  updateConversationCapabilityBinding,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import {
  bindDesktopConversationCapabilityRouteRuntime,
  clearDesktopConversationCapabilityRouteRuntime,
  createDesktopConversationCapabilityRouteRuntime,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-conversation-route-runtime.js';

function encodeRouteDescribePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const selectedLocalBinding: RuntimeRouteBinding = {
  source: 'local',
  connectorId: '',
  model: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
  modelId: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
  modelLabel: 'gemma-4-26B-A4B-it-Q8_0',
  localModelId: '01KLOCALGEMMA',
  engine: 'llama',
  provider: 'llama',
  goRuntimeLocalModelId: '01KLOCALGEMMA',
  goRuntimeStatus: 'installed',
};

function createSnapshot(selected: RuntimeRouteBinding): RuntimeRouteOptionsSnapshot {
  return {
    capability: 'text.generate',
    selected,
    resolvedDefault: selected,
    local: {
      models: [{
        localModelId: '01KLOCALGEMMA',
        label: 'gemma-4-26B-A4B-it-Q8_0',
        engine: 'llama',
        model: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
        modelId: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
        provider: 'llama',
        status: 'installed',
        goRuntimeLocalModelId: '01KLOCALGEMMA',
        goRuntimeStatus: 'installed',
        capabilities: ['chat', 'text.generate'],
      }],
    },
    connectors: [],
  };
}

test('desktop bootstrap route runtime resolves local import text routes through runtime describe metadata', async () => {
  let capturedHealthInput: Record<string, unknown> | null = null;
  let capturedScenarioRequest: Record<string, unknown> | null = null;
  const routeRuntime = createDesktopConversationCapabilityRouteRuntime({
    loadRuntimeRouteOptions: async () => createSnapshot(selectedLocalBinding),
    checkLocalLlmHealth: async (input) => {
      capturedHealthInput = input as Record<string, unknown>;
      return {
        provider: 'llama',
        endpoint: null,
        model: String(input.localProviderModel || ''),
        status: 'healthy',
        detail: '',
        checkedAt: new Date().toISOString(),
      };
    },
    buildRuntimeCallOptions: async () => ({
      idempotencyKey: 'route-describe-idem',
      timeoutMs: 30_000,
      metadata: {
        traceId: 'route-describe-trace',
        callerKind: 'desktop-core' as const,
        callerId: 'core.chat.agent',
        surfaceId: 'desktop.renderer',
      },
    }),
    getRuntimeClient: () => ({
      appId: 'nimi.desktop',
      ai: {
        executeScenario: async (request: unknown, options: unknown) => {
          capturedScenarioRequest = request as Record<string, unknown>;
          const extensionObserver = (options as {
            _responseMetadataObserver?: (metadata: Record<string, string>) => void;
          })._responseMetadataObserver;
          extensionObserver?.({
            'x-nimi-route-describe-result': encodeRouteDescribePayload({
              capability: 'text.generate',
              metadataVersion: 'v1',
              resolvedBindingRef: 'local:text.generate:llama:01KLOCALGEMMA',
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
          return {
            output: {
              output: {
                oneofKind: 'textGenerate',
                textGenerate: { text: '' },
              },
            },
            finishReason: 1,
            routeDecision: 1,
            modelResolved: 'local-import/gemma-4-26B-A4B-it-Q8_0',
            traceId: 'route-describe-response-trace',
            ignoredExtensions: [],
          };
        },
      },
    } as never),
  });

  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    selectedLocalBinding,
  );
  const projection = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime,
  });

  assert.equal(projection.supported, true);
  assert.equal(projection.reasonCode, null);
  assert.equal(projection.resolvedBinding?.resolvedBindingRef, 'local:text.generate:llama:01KLOCALGEMMA');
  assert.equal(projection.resolvedBinding?.modelId, 'local-import/gemma-4-26B-A4B-it-Q8_0');
  const healthInput = capturedHealthInput as Record<string, unknown> | null;
  const scenarioRequest = capturedScenarioRequest as Record<string, unknown> | null;
  assert.ok(healthInput);
  assert.ok(scenarioRequest);
  assert.equal(healthInput.localModelId, '01KLOCALGEMMA');
  assert.equal(healthInput.goRuntimeLocalModelId, '01KLOCALGEMMA');
  assert.equal(
    (((scenarioRequest.extensions as unknown[])?.[0] as { namespace?: string } | undefined)?.namespace),
    'nimi.scenario.text_generate.route_describe',
  );
});

test('desktop bootstrap route runtime does not hydrate a selected local binding from a different local model', async () => {
  const otherLocalBinding: RuntimeRouteBinding = {
    source: 'local',
    connectorId: '',
    model: 'local/local-import/other-model',
    modelId: 'local/local-import/other-model',
    localModelId: '01KLOCALOTHER',
    engine: 'llama',
    provider: 'llama',
    goRuntimeLocalModelId: '01KLOCALOTHER',
    goRuntimeStatus: 'installed',
  };
  const routeRuntime = createDesktopConversationCapabilityRouteRuntime({
    loadRuntimeRouteOptions: async () => createSnapshot(otherLocalBinding),
    checkLocalLlmHealth: async () => ({
      provider: 'llama',
      endpoint: null,
      model: '',
      status: 'healthy',
      detail: '',
      checkedAt: new Date().toISOString(),
    }),
    buildRuntimeCallOptions: async () => ({
      idempotencyKey: 'route-describe-idem',
      timeoutMs: 30_000,
      metadata: {
        traceId: 'route-describe-trace',
        callerKind: 'desktop-core' as const,
        callerId: 'core.chat.agent',
        surfaceId: 'desktop.renderer',
      },
    }),
    getRuntimeClient: () => ({
      appId: 'nimi.desktop',
      ai: {
        executeScenario: async () => ({}) as never,
      },
    } as never),
  });

  const resolved = await routeRuntime.resolve({
    capability: 'text.generate',
    binding: selectedLocalBinding,
  });

  assert.equal(resolved.modelId, 'local-import/gemma-4-26B-A4B-it-Q8_0');
  assert.equal(resolved.localModelId, '01KLOCALGEMMA');
  assert.equal(resolved.goRuntimeLocalModelId, '01KLOCALGEMMA');
});

test('desktop bootstrap binds and clears the shared conversation route runtime', () => {
  clearDesktopConversationCapabilityRouteRuntime();
  assert.equal(getConversationCapabilityRouteRuntime(), null);

  bindDesktopConversationCapabilityRouteRuntime({
    loadRuntimeRouteOptions: async () => createSnapshot(selectedLocalBinding),
    checkLocalLlmHealth: async () => ({
      provider: 'llama',
      endpoint: null,
      model: 'local-import/gemma-4-26B-A4B-it-Q8_0',
      status: 'healthy',
      detail: '',
      checkedAt: new Date().toISOString(),
    }),
    buildRuntimeCallOptions: async () => ({
      idempotencyKey: 'route-describe-idem',
      timeoutMs: 30_000,
      metadata: {
        traceId: 'route-describe-trace',
        callerKind: 'desktop-core' as const,
        callerId: 'core.chat.agent',
        surfaceId: 'desktop.renderer',
      },
    }),
    getRuntimeClient: () => ({
      appId: 'nimi.desktop',
      ai: {
        executeScenario: async () => ({}) as never,
      },
    } as never),
  });
  assert.ok(getConversationCapabilityRouteRuntime());

  clearDesktopConversationCapabilityRouteRuntime();
  assert.equal(getConversationCapabilityRouteRuntime(), null);
});
