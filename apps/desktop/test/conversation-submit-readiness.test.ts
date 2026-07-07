import assert from 'node:assert/strict';
import test from 'node:test';
import type { TFunction } from 'i18next';
import type {
  AgentEffectiveCapabilityResolution,
  ConversationCapabilityProjection,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  ensureAgentConversationSubmitRouteReady,
  ensureAiConversationSubmitRouteReady,
  resolveAgentSubmitRouteUnavailableDetails,
} from '../src/shell/renderer/features/chat/conversation-submit-readiness.js';

function createTextProjection(
  overrides: Partial<ConversationCapabilityProjection> = {},
): ConversationCapabilityProjection {
  return {
    capability: 'text.generate',
    selectedTargetRef: null,
    resolvedBinding: null,
    health: null,
    metadata: null,
    supported: false,
    reasonCode: 'selection_missing',
    ...overrides,
  };
}

function createAgentResolution(
  overrides: Partial<AgentEffectiveCapabilityResolution> = {},
): AgentEffectiveCapabilityResolution {
  return {
    ready: false,
    textProjection: null,
    imageProjection: null,
    voiceProjection: null,
    voiceWorkflowProjections: {
      'voice_workflow.voice_clone': null,
      'voice_workflow.voice_design': null,
    },
    voiceWorkflowReadyByCapability: {
      'voice_workflow.voice_clone': false,
      'voice_workflow.voice_design': false,
    },
    imageReady: false,
    voiceReady: false,
    reason: 'projection_unavailable',
    ...overrides,
  };
}

const t = ((_: string, options?: { defaultValue?: string }) => options?.defaultValue || '') as unknown as TFunction;

test('conversation submit readiness: AI submit refreshes text projection before allowing send', async () => {
  let refreshed = false;

  const projection = await ensureAiConversationSubmitRouteReady({
    t,
    deps: {
      refreshConversationCapabilityProjections: async (capabilities) => {
        assert.deepEqual(capabilities, ['text.generate']);
        refreshed = true;
      },
      getTextCapabilityProjection: () => (refreshed
        ? createTextProjection({
          supported: true,
          resolvedBinding: {
            capability: 'text.generate',
            source: 'cloud-connector', targetRef: { kind: 'cloud-connector' as const, version: 'v2' as const, connectorId: 'connector-test', remoteModelCatalogId: 'remote-catalog:connector-test:test-model', providerModelId: 'test-model' }, provider: 'openai',
            connectorId: 'connector-openai',
            model: 'gpt-4.1',
            modelId: 'gpt-4.1',
            resolvedBindingRef: 'binding:text.generate',
          },
          reasonCode: null,
        })
        : createTextProjection()),
    },
  });

  assert.equal(projection.supported, true);
  assert.equal(projection.resolvedBinding?.resolvedBindingRef, 'binding:text.generate');
});

test('conversation submit readiness: AI submit surfaces selection-missing after refreshed projection stays unavailable', async () => {
  await assert.rejects(
    () => ensureAiConversationSubmitRouteReady({
      t,
      deps: {
        refreshConversationCapabilityProjections: async () => undefined,
        getTextCapabilityProjection: () => createTextProjection({
          reasonCode: 'selection_missing',
        }),
      },
    }),
    /Select a Nimi route before sending a message\./,
  );
});

test('conversation submit readiness: agent submit refreshes text projection into a ready resolution', async () => {
  let refreshed = false;
  let resolutionRefreshed = false;

  const resolution = await ensureAgentConversationSubmitRouteReady({
    t,
    deps: {
      refreshConversationCapabilityProjections: async (capabilities) => {
        assert.deepEqual(capabilities, ['text.generate']);
        refreshed = true;
      },
      refreshAgentEffectiveCapabilityResolution: () => {
        resolutionRefreshed = true;
      },
      getTextCapabilityProjection: () => null,
      getAgentResolution: () => (
        refreshed && resolutionRefreshed
          ? createAgentResolution({
            ready: true,
            reason: 'ok',
            textProjection: createTextProjection({
              supported: true,
              resolvedBinding: {
                capability: 'text.generate',
                source: 'local-runtime', targetRef: { kind: 'local-runtime' as const, version: 'v2' as const, profileBindingId: 'local-runtime:test-local' }, provider: 'ollama',
                connectorId: '',
                model: 'qwen3',
                modelId: 'qwen3',
                localAssetId: 'local-qwen3',
                resolvedBindingRef: 'binding:agent:text',
              },
              reasonCode: null,
            }),
          })
          : createAgentResolution()
      ),
    },
  });

  assert.equal(resolution.ready, true);
  assert.equal(resolution.textProjection?.resolvedBinding?.resolvedBindingRef, 'binding:agent:text');
});

test('conversation submit readiness: agent submit rebuilds from fresh text projection when resolution is stale', async () => {
  let refreshed = false;
  let resolutionRefreshed = false;
  const freshTextProjection = createTextProjection({
    supported: true,
    resolvedBinding: {
      capability: 'text.generate',
      source: 'local-runtime', targetRef: { kind: 'local-runtime' as const, version: 'v2' as const, profileBindingId: 'local-runtime:test-local' }, provider: 'llama',
      connectorId: '',
      model: 'gemma',
      modelId: 'gemma',
      localAssetId: 'local-gemma',
      resolvedBindingRef: 'binding:fresh-agent:text',
    },
    reasonCode: null,
  });

  const resolution = await ensureAgentConversationSubmitRouteReady({
    t,
    deps: {
      refreshConversationCapabilityProjections: async (capabilities) => {
        assert.deepEqual(capabilities, ['text.generate']);
        refreshed = true;
      },
      refreshAgentEffectiveCapabilityResolution: () => {
        resolutionRefreshed = true;
      },
      getTextCapabilityProjection: () => (refreshed ? freshTextProjection : null),
      getAgentResolution: () => (
        resolutionRefreshed
          ? createAgentResolution({
            ready: false,
            reason: 'route_unresolved',
            textProjection: createTextProjection({
              supported: true,
              resolvedBinding: null,
              reasonCode: 'binding_unresolved',
            }),
          })
          : createAgentResolution()
      ),
    },
  });

  assert.equal(resolution.ready, true);
  assert.equal(resolution.textProjection?.resolvedBinding?.resolvedBindingRef, 'binding:fresh-agent:text');
});

test('conversation submit readiness: agent submit still fails after refresh when text route is unavailable', async () => {
  await assert.rejects(
    () => ensureAgentConversationSubmitRouteReady({
      t,
      deps: {
        refreshConversationCapabilityProjections: async () => undefined,
        refreshAgentEffectiveCapabilityResolution: () => undefined,
        getTextCapabilityProjection: () => null,
        getAgentResolution: () => createAgentResolution(),
      },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'AI_INPUT_INVALID');
      assert.match(String((error as Error).message), /A local or cloud runtime route is required before sending a message\./);
      return true;
    },
  );
});

test('conversation submit readiness: agent submit preserves unhealthy route issue details', async () => {
  const unhealthyProjection = createTextProjection({
    selectedTargetRef: {
      kind: 'local-runtime' as const,
      version: 'v2' as const,
      profileBindingId: 'local-runtime:unhealthy',
    },
    resolvedBinding: {
      capability: 'text.generate',
      source: 'local-runtime',
      targetRef: {
        kind: 'local-runtime' as const,
        version: 'v2' as const,
        profileBindingId: 'local-runtime:unhealthy',
      },
      provider: 'llama',
      connectorId: '',
      model: 'gemma',
      modelId: 'gemma',
      localAssetId: 'local-gemma',
      resolvedBindingRef: 'binding:agent:unhealthy',
    },
    health: {
      healthy: false,
      status: 'unhealthy',
      provider: 'llama',
      detail: 'health check failed',
      actionHint: 'repair local model',
    },
    reasonCode: 'route_unhealthy',
  });

  await assert.rejects(
    () => ensureAgentConversationSubmitRouteReady({
      t,
      deps: {
        refreshConversationCapabilityProjections: async () => undefined,
        refreshAgentEffectiveCapabilityResolution: () => undefined,
        getTextCapabilityProjection: () => unhealthyProjection,
        getAgentResolution: () => createAgentResolution({
          ready: false,
          reason: 'route_unresolved',
          textProjection: unhealthyProjection,
        }),
      },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'AI_PROVIDER_UNAVAILABLE');
      assert.equal((error as { actionHint?: string }).actionHint, 'repair_runtime_route_binding');
      assert.match(String((error as Error).message), /failed its latest health check/);
      return true;
    },
  );
});

test('conversation submit readiness: route issue details distinguish selection, not-ready, and host-denied states', () => {
  assert.deepEqual(resolveAgentSubmitRouteUnavailableDetails(t, createTextProjection({
    reasonCode: 'selection_missing',
  })), {
    message: 'Choose a local or cloud runtime route before sending a message.',
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'select_runtime_route_binding',
  });
  assert.deepEqual(resolveAgentSubmitRouteUnavailableDetails(t, createTextProjection({
    reasonCode: 'route_not_ready',
  })), {
    message: 'The selected runtime route is not ready yet. Finish setup or warm the local model before sending.',
    reasonCode: ReasonCode.AI_MODEL_NOT_READY,
    actionHint: 'warm_runtime_route_binding',
  });
  assert.deepEqual(resolveAgentSubmitRouteUnavailableDetails(t, createTextProjection({
    reasonCode: 'host_denied',
  })), {
    message: 'This device is not allowed to use the selected Runtime route for this conversation.',
    reasonCode: ReasonCode.ACTION_PERMISSION_DENIED,
    actionHint: 'request_runtime_route_permission',
  });
});
