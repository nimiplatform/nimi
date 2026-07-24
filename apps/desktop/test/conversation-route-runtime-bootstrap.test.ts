import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NimiRuntimeRouteHealthInput,
  NimiRuntimeRouteOptionsSnapshot,
  NimiRuntimeRouteTargetRef,
} from '@nimiplatform/sdk/runtime';
import { createNimiBuiltInChatAIScopeRef } from '@nimiplatform/sdk/ai';
import {
  buildConversationCapabilityProjection,
  createDefaultConversationCapabilitySelectionStore,
  selectionStoreFromAIConfig,
  updateConversationCapabilityTargetRef,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import {
  getProductionConversationCapabilityRouteRuntime as getConversationCapabilityRouteRuntime,
} from '../src/shell/renderer/features/chat/production-conversation-route-runtime-state.js';
import {
  bindDesktopConversationCapabilityRouteRuntime,
  clearDesktopConversationCapabilityRouteRuntime,
  createDesktopConversationCapabilityRouteRuntime,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-conversation-route-runtime.js';

function encodeRouteDescribePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const selectedLocalTargetRef: NimiRuntimeRouteTargetRef = {
  kind: 'local-runtime',
  version: 'v2',
  profileBindingId: 'local-runtime:01KLOCALGEMMA',
};

const selectedLocalReadinessRef: NimiRuntimeRouteTargetRef = {
  kind: 'local-runtime',
  version: 'v2',
  readinessRef: 'runtime-route:local:llama:01KLOCALGEMMA',
};

function createSnapshot(selectedTargetRef: NimiRuntimeRouteTargetRef): NimiRuntimeRouteOptionsSnapshot {
  return {
    capability: 'text.generate',
    selectedTargetRef,
    inventory: {
      capability: 'text.generate',
      targets: [{
        targetRef: selectedTargetRef,
        display: {
          label: 'gemma-4-26B-A4B-it-Q8_0',
          model: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
          provider: 'llama',
          engine: 'llama',
        },
        readiness: {
          status: 'installed',
          endpoint: 'http://127.0.0.1:11434/v1',
        },
        compatibility: {
          capabilities: ['chat', 'text.generate'],
        },
        evidence: {
          source: 'local-runtime',
          localAssetId: '01KLOCALGEMMA',
          resolvedModelId: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:11434/v1',
          runtimeStatus: 'installed',
        },
      }],
    },
  };
}

function resolvedBindingRefForTargetRef(targetRef: NimiRuntimeRouteTargetRef): string {
  return targetRef.kind === 'local-runtime'
    ? `local:text.generate:${encodeURIComponent(targetRef.profileBindingId || targetRef.readinessRef || '')}`
    : `cloud:text.generate:${encodeURIComponent(targetRef.connectorId)}:${encodeURIComponent(targetRef.remoteModelCatalogId)}:${encodeURIComponent(targetRef.providerModelId)}`;
}

function createRouteRuntime(input: {
  readonly selectedTargetRef?: NimiRuntimeRouteTargetRef;
  readonly onHealthInput?: (input: NimiRuntimeRouteHealthInput) => void;
  readonly onScenarioRequest?: (request: Record<string, unknown>) => void;
} = {}) {
  const selectedTargetRef = input.selectedTargetRef || selectedLocalTargetRef;
  const resolvedBindingRef = resolvedBindingRefForTargetRef(selectedTargetRef);
  return createDesktopConversationCapabilityRouteRuntime({
    loadRuntimeRouteOptions: async () => createSnapshot(selectedTargetRef),
    checkRuntimeRouteHealth: async (healthInput) => {
      input.onHealthInput?.(healthInput);
      return {
        provider: 'llama',
        endpoint: null,
        model: String(healthInput.localProviderModel || ''),
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
    getRouteOptionsClient: () => ({}) as never,
    getRuntimeClient: () => ({
      appId: 'nimi.desktop',
      ai: {
        executeScenario: async (request: unknown, options: unknown) => {
          input.onScenarioRequest?.(request as Record<string, unknown>);
          const extensionObserver = (options as {
            responseMetadataObserver?: (metadata: Record<string, string>) => void;
          }).responseMetadataObserver;
          extensionObserver?.({
            'x-nimi-route-describe-result': encodeRouteDescribePayload({
              capability: 'text.generate',
              metadataVersion: 'v1',
              resolvedBindingRef,
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
}

test('desktop bootstrap route runtime resolves local import text routes through runtime describe metadata', async () => {
  const captured: {
    healthInput: NimiRuntimeRouteHealthInput | null;
    scenarioRequest: Record<string, unknown> | null;
  } = {
    healthInput: null,
    scenarioRequest: null,
  };
  const routeRuntime = createRouteRuntime({
    onHealthInput: (input) => {
      captured.healthInput = input;
    },
    onScenarioRequest: (request) => {
      captured.scenarioRequest = request;
    },
  });

  const store = updateConversationCapabilityTargetRef(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    selectedLocalTargetRef,
  );
  const projection = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime,
  });

  assert.equal(projection.supported, true);
  assert.equal(projection.reasonCode, null);
  assert.equal(projection.resolvedBinding?.resolvedBindingRef, 'local:text.generate:local-runtime%3A01KLOCALGEMMA');
  assert.equal(projection.resolvedBinding?.modelId, 'local-import/gemma-4-26B-A4B-it-Q8_0');
  assert.equal(projection.resolvedBinding?.localAssetId, '01KLOCALGEMMA');
  assert.equal(captured.healthInput?.localAssetId, '01KLOCALGEMMA');
  assert.equal(
    (((captured.scenarioRequest?.extensions as unknown[])?.[0] as { namespace?: string } | undefined)?.namespace),
    'nimi.scenario.text_generate.route_describe',
  );
});

test('desktop bootstrap route runtime resolves AIConfig local profileBindingId targetRefs through runtime describe metadata', async () => {
  const routeRuntime = createRouteRuntime();
  const store = selectionStoreFromAIConfig({
    scopeRef: createNimiBuiltInChatAIScopeRef('agent'),
    capabilities: {
      targetRefs: {
        'text.generate': selectedLocalTargetRef,
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime,
  });

  assert.equal(projection.supported, true);
  assert.equal(projection.reasonCode, null);
  assert.equal(projection.resolvedBinding?.localAssetId, '01KLOCALGEMMA');
});

test('desktop bootstrap route runtime resolves AIConfig local readinessRef targetRefs through runtime describe metadata', async () => {
  const routeRuntime = createRouteRuntime({ selectedTargetRef: selectedLocalReadinessRef });
  const store = selectionStoreFromAIConfig({
    scopeRef: createNimiBuiltInChatAIScopeRef('agent'),
    capabilities: {
      targetRefs: {
        'text.generate': selectedLocalReadinessRef,
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });
  const projection = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime,
  });

  assert.equal(projection.supported, true);
  assert.equal(projection.reasonCode, null);
  assert.deepEqual(projection.selectedTargetRef, selectedLocalReadinessRef);
  assert.equal(projection.resolvedBinding?.localAssetId, '01KLOCALGEMMA');
});

test('desktop bootstrap route runtime fails closed when selected local targetRef is not in inventory', async () => {
  const otherLocalTargetRef: NimiRuntimeRouteTargetRef = {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: 'local-runtime:01KLOCALOTHER',
  };
  const routeRuntime = createRouteRuntime({ selectedTargetRef: otherLocalTargetRef });

  await assert.rejects(
    () => routeRuntime.resolve({
      capability: 'text.generate',
      targetRef: selectedLocalTargetRef,
    }),
    /NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED/,
  );
});

test('desktop bootstrap binds and clears the shared conversation route runtime', () => {
  clearDesktopConversationCapabilityRouteRuntime();
  assert.equal(getConversationCapabilityRouteRuntime(), null);

  bindDesktopConversationCapabilityRouteRuntime();
  assert.ok(getConversationCapabilityRouteRuntime());

  clearDesktopConversationCapabilityRouteRuntime();
  assert.equal(getConversationCapabilityRouteRuntime(), null);
});
