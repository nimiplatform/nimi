import assert from 'node:assert/strict';
import test from 'node:test';
import type { TFunction } from 'i18next';
import type {
  AgentEffectiveCapabilityResolution,
  ConversationCapabilityProjection,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import {
  ensureAgentConversationSubmitRouteReady,
  ensureAiConversationSubmitRouteReady,
} from '../src/shell/renderer/features/chat/conversation-submit-readiness.js';

function createTextProjection(
  overrides: Partial<ConversationCapabilityProjection> = {},
): ConversationCapabilityProjection {
  return {
    capability: 'text.generate',
    selectedBinding: null,
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
      'voice_workflow.tts_v2v': null,
      'voice_workflow.tts_t2v': null,
    },
    voiceWorkflowReadyByCapability: {
      'voice_workflow.tts_v2v': false,
      'voice_workflow.tts_t2v': false,
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
            source: 'cloud',
            provider: 'openai',
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
      getAgentResolution: () => (
        refreshed && resolutionRefreshed
          ? createAgentResolution({
            ready: true,
            reason: 'ok',
            textProjection: createTextProjection({
              supported: true,
              resolvedBinding: {
                capability: 'text.generate',
                source: 'local',
                provider: 'ollama',
                connectorId: '',
                model: 'qwen3',
                modelId: 'qwen3',
                localModelId: 'local-qwen3',
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

test('conversation submit readiness: agent submit still fails after refresh when text route is unavailable', async () => {
  await assert.rejects(
    () => ensureAgentConversationSubmitRouteReady({
      t,
      deps: {
        refreshConversationCapabilityProjections: async () => undefined,
        refreshAgentEffectiveCapabilityResolution: () => undefined,
        getAgentResolution: () => createAgentResolution(),
      },
    }),
    /Choose a ready AI route before sending a message\./,
  );
});
