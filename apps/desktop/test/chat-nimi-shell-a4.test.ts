import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_NEW_CONVERSATION_TITLE,
  resolveAiConversationActiveThreadId,
  resolveThreadTitleAfterFirstSend,
} from '../src/shell/renderer/features/chat/chat-nimi-thread-model.js';
import {
  resolveAiThinkingSupportFromProjection,
  resolveChatThinkingConfig,
} from '../src/shell/renderer/features/chat/chat-shared-thinking.js';
import {
  buildConversationCapabilityProjection,
  createDefaultConversationCapabilitySelectionStore,
  createNimiConversationAISnapshot,
  type ConversationCapabilityRouteRuntime,
  updateConversationCapabilityTargetRef,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import {
  streamChatAiRuntime,
} from '../src/shell/renderer/features/chat/chat-nimi-runtime.js';
import {
  resolveChatAiConversationRuntimeRequest,
} from '../src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.js';
import {
  clearDesktopTestNimiClientSession,
  createEmptyNimiAIConfig,
  createDesktopTestNimiClientSession,
  getDesktopTestRendererSdk,
  resetRuntimeLocalModelWarmCacheForTests,
} from './chat-agent-local-mode-test-utils.js';

test('chat ai a4: active thread restore prefers explicit selection before last selected', () => {
  const threads = [{
    id: 'thread-a',
    title: 'alpha',
    updatedAtMs: 10,
    lastMessageAtMs: 10,
  }, {
    id: 'thread-b',
    title: 'beta',
    updatedAtMs: 20,
    lastMessageAtMs: 20,
  }];

  assert.equal(resolveAiConversationActiveThreadId({
    threads,
    selectionThreadId: 'thread-a',
    lastSelectedThreadId: 'thread-b',
  }), 'thread-a');

  assert.equal(resolveAiConversationActiveThreadId({
    threads,
    selectionThreadId: 'missing-thread',
    lastSelectedThreadId: 'thread-b',
  }), 'thread-b');

  assert.equal(resolveAiConversationActiveThreadId({
    threads,
    selectionThreadId: 'missing-thread',
    lastSelectedThreadId: 'missing-too',
  }), null);
});

test('chat ai a4: switching thread route truth updates selection-store projection and thinking support', async () => {
  const cloudTargetRef = {
    kind: 'cloud-connector' as const,
    version: 'v2' as const,
    connectorId: 'connector-ollama',
    provider: 'ollama',
    remoteModelCatalogId: 'remote-catalog:connector-ollama:qwen3-cloud',
    providerModelId: 'qwen3-cloud',
  };
  const localTargetRef = {
    kind: 'local-runtime' as const,
    version: 'v2' as const,
    profileBindingId: 'local-runtime:local-model-2',
  };

  const routeRuntime: ConversationCapabilityRouteRuntime = {
    resolve: async ({ targetRef }) => {
      if (targetRef?.kind === 'cloud-connector') {
        return {
          capability: 'text.generate' as const,
          resolvedBindingRef: 'binding-cloud-thread-a',
          source: 'cloud-connector' as const,
          targetRef,
          provider: 'ollama',
          model: targetRef.providerModelId,
          modelId: targetRef.providerModelId,
          providerModelId: targetRef.providerModelId,
          remoteModelCatalogId: targetRef.remoteModelCatalogId,
          connectorId: targetRef.connectorId,
        };
      }
      return {
        capability: 'text.generate' as const,
        resolvedBindingRef: 'binding-local-thread-b',
        source: 'local-runtime' as const,
        targetRef: localTargetRef,
        provider: 'llama',
        model: 'qwen3-local',
        modelId: 'qwen3-local',
        localAssetId: 'local-model-2',
        connectorId: '',
        endpoint: 'http://127.0.0.1:22434',
      };
    },
    checkHealth: async () => ({
      healthy: true,
      status: 'healthy',
      provider: 'test-route',
      detail: 'ready',
      actionHint: 'none',
    }),
    describe: async ({ resolvedBindingRef }) => ({
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef,
      metadataKind: 'text.generate' as const,
      metadata: resolvedBindingRef === 'binding-cloud-thread-a'
        ? {
          supportsThinking: true,
          traceModeSupport: 'separate' as const,
          supportsImageInput: false,
          supportsAudioInput: false,
          supportsVideoInput: false,
          supportsArtifactRefInput: false,
        }
        : {
          supportsThinking: false,
          traceModeSupport: 'none' as const,
          supportsImageInput: false,
          supportsAudioInput: false,
          supportsVideoInput: false,
          supportsArtifactRefInput: false,
        },
    }),
  };

  const threadAStore = updateConversationCapabilityTargetRef(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    cloudTargetRef,
  );
  const projectionA = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: threadAStore,
    routeRuntime,
  });
  assert.deepEqual(threadAStore.targetRefs['text.generate'], cloudTargetRef);
  assert.deepEqual(
    resolveAiThinkingSupportFromProjection(projectionA),
    { supported: true, reason: null },
  );

  const threadBStore = updateConversationCapabilityTargetRef(
    threadAStore,
    'text.generate',
    localTargetRef,
  );
  const projectionB = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: threadBStore,
    routeRuntime,
  });
  assert.deepEqual(threadBStore.targetRefs['text.generate'], localTargetRef);
  assert.deepEqual(
    resolveAiThinkingSupportFromProjection(projectionB),
    { supported: false, reason: 'thinking_unsupported' },
  );
});

test('chat ai a4: local runtime stream keeps explicit model id when resolved route only has local asset id', async () => {
  resetRuntimeLocalModelWarmCacheForTests();
  clearDesktopTestNimiClientSession();
  const client = await createDesktopTestNimiClientSession({
    appId: 'nimi.desktop.test.chat-ai-local-asset-model',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });
  const requests: Array<{ head?: { modelId?: string; routePolicy?: number } }> = [];
  (client as unknown as { runtime: unknown }).runtime = {
    local: {
      listLocalAssets: async () => ({
        assets: [{
          localAssetId: 'asset-local-chat',
          assetId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:11434/v1',
          status: 2,
        }],
        nextPageToken: '',
      }),
      warmLocalAsset: async () => ({
        asset: {
          localAssetId: 'asset-local-chat',
        },
      }),
    },
    ai: {
      executeScenario: async () => ({}),
      streamScenario: async function* (request: { head?: { modelId?: string; routePolicy?: number } }) {
        requests.push(request);
        yield {
          payload: {
            oneofKind: 'started',
            started: {
              modelResolved: request.head?.modelId || '',
            },
          },
          traceId: 'trace-local-chat',
        };
        yield {
          payload: {
            oneofKind: 'completed',
            completed: {
              finishReason: 1,
            },
          },
        };
      },
    },
  };

  try {
    const executionSnapshot = createNimiConversationAISnapshot({
      createdAtMs: 0,
      config: createEmptyNimiAIConfig(),
      capability: 'text.generate',
      projection: {
        capability: 'text.generate',
        selectedTargetRef: null,
        resolvedBinding: {
          capability: 'text.generate',
          source: 'local-runtime',
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:asset-local-chat',
          },
          connectorId: '',
          provider: 'llama',
          engine: 'llama',
          model: '',
          localAssetId: 'asset-local-chat',
          endpoint: 'http://127.0.0.1:11434/v1',
          localProviderEndpoint: 'http://127.0.0.1:11434/v1',
          resolvedBindingRef: 'local:text.generate:llama:asset-local-chat',
        },
        health: {
          healthy: true,
          status: 'healthy',
          provider: 'llama',
          detail: '',
          actionHint: 'none',
        },
        metadata: {
          capability: 'text.generate',
          metadataVersion: 'v1',
          resolvedBindingRef: 'local:text.generate:llama:asset-local-chat',
          metadataKind: 'text.generate',
          metadata: {
            supportsThinking: false,
            traceModeSupport: 'none',
            supportsImageInput: false,
            supportsAudioInput: false,
            supportsVideoInput: false,
            supportsArtifactRefInput: false,
          },
        },
        supported: true,
        reasonCode: null,
      },
    });

    const result = await streamChatAiRuntime({
      prompt: 'hello',
      threadId: 'thread-local-chat',
      reasoningPreference: 'off',
      executionSnapshot,
    }, { sdk: getDesktopTestRendererSdk() });
    for await (const ignored of result.stream) {
      void ignored;
    }

    assert.equal(requests[0]?.head?.modelId, 'asset-local-chat');
  } finally {
    resetRuntimeLocalModelWarmCacheForTests();
    clearDesktopTestNimiClientSession();
  }
});

test('chat ai a4: simple-ai provider runtime request resolves explicit local asset model from route projection', () => {
  assert.deepEqual(
    resolveChatAiConversationRuntimeRequest({
      capability: 'text.generate',
      selectedTargetRef: null,
      resolvedBinding: {
        capability: 'text.generate',
        source: 'local-runtime',
        targetRef: {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-runtime:01KV2PAC69SRGAB30PCZ9ZH8MN',
        },
        connectorId: '',
        provider: 'llama',
        engine: 'llama',
        model: '',
        localAssetId: '01KV2PAC69SRGAB30PCZ9ZH8MN',
        resolvedBindingRef: 'local:text.generate:llama:01KV2PAC69SRGAB30PCZ9ZH8MN',
      },
      health: {
        healthy: true,
        status: 'healthy',
        provider: 'llama',
        detail: '',
        actionHint: 'none',
      },
      metadata: null,
      supported: true,
      reasonCode: null,
    }),
    {
      model: '01KV2PAC69SRGAB30PCZ9ZH8MN',
      route: 'local',
      connectorId: undefined,
    },
  );
});

test('chat ai a4: first successful send replaces placeholder thread title', () => {
  assert.equal(
    resolveThreadTitleAfterFirstSend(AI_NEW_CONVERSATION_TITLE, '  first user message  '),
    'first user message',
  );
  assert.equal(
    resolveThreadTitleAfterFirstSend('Existing title', 'ignored'),
    'Existing title',
  );
});

test('chat ai a4: resolveChatThinkingConfig stays fail-close when thinking is unsupported', () => {
  assert.deepEqual(
    resolveChatThinkingConfig('on', {
      supported: false,
      reason: 'thinking_unsupported',
    }),
    {
      mode: 'off',
      traceMode: 'hide',
    },
  );
});

test('chat ai a4: projection thinking fails close when text metadata is missing', () => {
  assert.deepEqual(
    resolveAiThinkingSupportFromProjection({
      capability: 'text.generate',
      selectedTargetRef: {
        kind: 'cloud-connector',
        version: 'v2',
        connectorId: 'connector-ollama',
        provider: 'ollama',
        remoteModelCatalogId: 'remote-catalog:connector-ollama:qwen3:4b',
        providerModelId: 'qwen3:4b',
      },
      resolvedBinding: {
        capability: 'text.generate',
        source: 'cloud-connector',
        targetRef: {
          kind: 'cloud-connector',
          version: 'v2',
          connectorId: 'connector-ollama',
          remoteModelCatalogId: 'remote-catalog:connector-ollama:qwen3:4b',
          providerModelId: 'qwen3:4b',
          provider: 'ollama',
        },
        resolvedBindingRef: 'cloud:text.generate:connector-ollama:qwen3:4b',
        provider: 'ollama',
        connectorId: 'connector-ollama',
        remoteModelCatalogId: 'remote-catalog:connector-ollama:qwen3:4b',
        providerModelId: 'qwen3:4b',
        model: 'qwen3:4b',
        modelId: 'qwen3:4b',
      },
      health: {
        healthy: true,
        status: 'healthy',
        provider: 'ollama',
        detail: 'ready',
        actionHint: 'none',
      },
      metadata: null,
      supported: false,
      reasonCode: null,
    }),
    {
      supported: false,
      reason: 'metadata_missing',
    },
  );
});
