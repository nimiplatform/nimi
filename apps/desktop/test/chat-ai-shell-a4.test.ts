import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  invokeChatAiRuntime,
} from '../src/shell/renderer/features/chat/chat-ai-runtime.js';
import {
  AI_NEW_CONVERSATION_TITLE,
  resolveAiConversationActiveThreadId,
  resolveThreadTitleAfterFirstSend,
} from '../src/shell/renderer/features/chat/chat-ai-thread-model.js';
import {
  resolveAiThinkingSupportFromProjection,
  resolveChatThinkingConfig,
} from '../src/shell/renderer/features/chat/chat-thinking.js';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';
import type { RuntimeFieldMap } from '../src/shell/renderer/app-shell/providers/store-types.js';
import { useAppStore } from '../src/shell/renderer/app-shell/providers/app-store.js';
import {
  aiConfigFromSelectionStore,
  buildConversationCapabilityProjection,
  createAISnapshot,
  createDefaultConversationCapabilitySelectionStore,
  setConversationCapabilityRouteRuntime,
  updateConversationCapabilityBinding,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';

type CapturedInvokeInput = {
  modId: string;
  provider: string;
  localProviderModel?: string;
  localProviderEndpoint?: string;
  connectorId?: string;
};

function createRuntimeFields(overrides: Partial<RuntimeFieldMap> = {}): RuntimeFieldMap {
  return {
    targetType: '',
    targetAccountId: '',
    agentId: '',
    targetId: '',
    worldId: '',
    provider: '',
    runtimeModelType: 'chat',
    localProviderEndpoint: '',
    localProviderModel: '',
    localOpenAiEndpoint: '',
    connectorId: '',
    mode: 'STORY',
    turnIndex: 1,
    userConfirmedUpload: false,
    ...overrides,
  };
}

function createRuntimeConfigState(): RuntimeConfigStateV11 {
  return {
    version: 11,
    initializedByV11: true,
    activePage: 'overview',
    diagnosticsCollapsed: false,
    selectedSource: 'local',
    activeCapability: 'chat',
    uiMode: 'simple',
    local: {
      endpoint: 'http://127.0.0.1:11434',
      models: [{
        localModelId: 'local-chat-1',
        engine: 'llama',
        model: 'qwen3',
        endpoint: 'http://127.0.0.1:11434',
        capabilities: ['chat'],
        status: 'active',
      }],
      nodeMatrix: [],
      status: 'healthy',
      lastCheckedAt: null,
      lastDetail: '',
    },
    connectors: [{
      id: 'connector-openai',
      label: 'OpenAI',
      vendor: 'gpt',
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      scope: 'user',
      hasCredential: true,
      isSystemOwned: false,
      models: ['gpt-5.4-mini'],
      modelCapabilities: {
        'gpt-5.4-mini': ['chat'],
      },
      status: 'healthy',
      lastCheckedAt: null,
      lastDetail: '',
    }],
    selectedConnectorId: 'connector-openai',
  };
}

function resetConversationCapabilityTestState(): void {
  setConversationCapabilityRouteRuntime(null);
  useAppStore.getState().setConversationCapabilityProjections({});
  useAppStore.getState().setAIConfig(createEmptyAIConfig());
}

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

test('chat ai a4: active thread restore prefers explicit selection before last selected', () => {
  const threads = [{
    id: 'thread-a',
    title: 'alpha',
    updatedAtMs: 10,
    lastMessageAtMs: 10,
    archivedAtMs: null,
  }, {
    id: 'thread-b',
    title: 'beta',
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    archivedAtMs: null,
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

test('chat ai a4: adapter reads text.generate binding from AIConfig as primary route truth', () => {
  const adapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');
  // Readiness derives from selectedBinding, not routeSnapshot
  assert.match(adapterSource, /selectedBinding:\s*selectedTextBinding/);
  assert.match(adapterSource, /aiConfig\.capabilities\.selectedBindings\['text\.generate'\]/);
  assert.match(adapterSource, /const selectedTextBinding = hasExplicitTextGenerateSelection/);
  assert.equal(
    /if\s*\(!projectionSupported\s*\|\|\s*!activeThreadId\)/.test(adapterSource),
    false,
    'ai provider must not require an existing activeThreadId before first submit',
  );
  // Adapter must NOT sync routeSnapshot → binding
  assert.equal(
    /setConversationCapabilityBinding\('text\.generate', desiredBinding\)/.test(adapterSource),
    false,
    'adapter must not write desiredBinding derived from routeSnapshot',
  );
  assert.equal(
    /normalizeRuntimeRouteBindingSelectionKey/.test(adapterSource),
    false,
    'normalizeRuntimeRouteBindingSelectionKey must be removed from adapter',
  );
});

test('chat ai a4: composer submit is fire-and-forget and host actions project the user message before route gating', () => {
  const presentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-presentation.tsx');
  const hostActionsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-host-actions.ts');
  const adapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-shell-adapter.tsx');

  assert.match(presentationSource, /submit:\s*\(composerInput: ChatComposerSubmitInput<unknown>\)\s*=>\s*\{/);
  assert.match(presentationSource, /void input\.handleSubmit\(composerInput\.text\)\.catch\(\(\) => undefined\);/);
  assert.match(presentationSource, /return Promise\.resolve\(\);/);
  assert.match(adapterSource, /const optimisticWaiting = submittingThreadId === activeThreadId/);
  assert.match(adapterSource, /optimisticWaiting=\{optimisticWaiting\}/);
  assert.match(adapterSource, /waitingLabel=\{t\('Chat\.nimiSending'/);
  assert.match(adapterSource, /submittingThreadId === activeThreadId\s*&& \(!streamState \|\| streamState\.phase === 'idle'\)/);

  const optimisticProjectionIndex = hostActionsSource.indexOf(
    "messages: replaceMessage(replaceMessage(base.messages, userMessage), assistantPlaceholder),",
  );
  const routeGateIndex = hostActionsSource.indexOf('await ensureAiConversationSubmitRouteReady');
  assert.notEqual(optimisticProjectionIndex, -1);
  assert.notEqual(routeGateIndex, -1);
  assert.ok(
    optimisticProjectionIndex < routeGateIndex,
    'AI host must project the optimistic user message before submit-time route gating',
  );
});

test('chat ai a4: switching thread route truth updates selection-store projection and thinking support', async () => {
  const cloudBinding = {
    source: 'cloud' as const,
    connectorId: 'connector-ollama',
    provider: 'ollama',
    model: 'qwen3-cloud',
    modelId: 'qwen3-cloud',
  };
  const localBinding = {
    source: 'local' as const,
    connectorId: '',
    model: 'qwen3-local',
    modelId: 'qwen3-local',
    localModelId: 'local-chat-2',
    engine: 'llama',
    provider: 'llama',
    endpoint: 'http://127.0.0.1:22434',
  };

  const routeRuntime = {
    resolve: async ({ binding }: { binding?: Record<string, unknown> }) => {
      const source = String(binding?.source || '').trim();
      if (source === 'cloud') {
        return {
          capability: 'text.generate' as const,
          resolvedBindingRef: 'binding-cloud-thread-a',
          source: 'cloud' as const,
          provider: 'ollama',
          model: 'qwen3-cloud',
          modelId: 'qwen3-cloud',
          connectorId: 'connector-ollama',
        };
      }
      return {
        capability: 'text.generate' as const,
        resolvedBindingRef: 'binding-local-thread-b',
        source: 'local' as const,
        provider: 'llama',
        model: 'qwen3-local',
        modelId: 'qwen3-local',
        localModelId: 'local-chat-2',
        connectorId: '',
        endpoint: 'http://127.0.0.1:22434',
      };
    },
    checkHealth: async () => ({
      healthy: true,
      status: 'healthy',
      detail: 'ready',
    }),
    describe: async ({ resolvedBindingRef }: { resolvedBindingRef: string }) => ({
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

  const threadAStore = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    cloudBinding,
  );
  const projectionA = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: threadAStore,
    routeRuntime,
  });
  assert.equal(threadAStore.selectedBindings['text.generate']?.source, 'cloud');
  assert.deepEqual(
    resolveAiThinkingSupportFromProjection(projectionA),
    { supported: true, reason: null },
  );

  const threadBStore = updateConversationCapabilityBinding(
    threadAStore,
    'text.generate',
    localBinding,
  );
  const projectionB = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore: threadBStore,
    routeRuntime,
  });
  assert.equal(threadBStore.selectedBindings['text.generate']?.source, 'local');
  assert.deepEqual(
    resolveAiThinkingSupportFromProjection(projectionB),
    { supported: false, reason: 'thinking_unsupported' },
  );
});

test('chat ai a4: invoke runtime uses desktop-owned core caller and local route defaults', async () => {
  const state = createRuntimeConfigState();
  let capturedInput: CapturedInvokeInput | null = null;
  const selectionStore = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    { source: 'local', connectorId: '', model: 'qwen3' },
  );
  useAppStore.getState().setAIConfig(aiConfigFromSelectionStore(selectionStore));
  const routeRuntime = {
    resolve: async () => ({
      capability: 'text.generate' as const,
      resolvedBindingRef: 'local:llama:qwen3',
      source: 'local' as const,
      provider: 'llama',
      model: 'qwen3',
      modelId: 'qwen3',
      localModelId: 'local-chat-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434',
      localProviderEndpoint: 'http://127.0.0.1:11434',
      localOpenAiEndpoint: 'http://127.0.0.1:11434',
    }),
    checkHealth: async () => ({
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    }),
    describe: async () => ({
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:llama:qwen3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    }),
  };
  setConversationCapabilityRouteRuntime(routeRuntime);
  const projection = await buildConversationCapabilityProjection({
    capability: 'text.generate',
    selectionStore,
    routeRuntime,
  });
  const executionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'text.generate',
    projection,
  });
  useAppStore.getState().setConversationCapabilityProjections({ 'text.generate': projection });

  try {
    useAppStore.getState().setConversationCapabilityProjections({});
    const result = await invokeChatAiRuntime({
      prompt: 'hello',
      threadId: 'thread-local',
      reasoningPreference: 'off',
      executionSnapshot,
      runtimeConfigState: state,
      runtimeFields: createRuntimeFields(),
    }, {
      invokeModLlmImpl: async (input) => {
        capturedInput = input as CapturedInvokeInput;
        return {
          text: 'hi',
          traceId: 'trace-local',
          promptTraceId: 'prompt-local',
        };
      },
    });

    assert.equal(result.text, 'hi');
    if (!capturedInput) {
      throw new Error('expected local invoke input');
    }
    const localInput = capturedInput as CapturedInvokeInput;
    assert.equal(localInput.modId, 'core.chat-ai');
    assert.equal(localInput.provider, 'llama');
    assert.equal(localInput.localProviderModel, 'qwen3');
    assert.equal(localInput.localProviderEndpoint, 'http://127.0.0.1:11434');
  } finally {
    resetConversationCapabilityTestState();
  }
});

test('chat ai a4: no stale local-model preference helper remains in runtime adapter', () => {
  const runtimeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-ai-runtime.ts');

  assert.equal(
    /resolvePreferredChatLocalModel/.test(runtimeSource),
    false,
    'chat-ai-runtime.ts must not keep stale local model preference fallback helpers',
  );
  assert.equal(
    /Fall back to runtime-config state when authoritative health is unavailable/.test(runtimeSource),
    false,
    'chat-ai-runtime.ts must not retain runtime-config health fallback comments or logic',
  );
});

test('chat ai a4: invoke runtime fails close when projection is unavailable', async () => {
  const state = createRuntimeConfigState();
  useAppStore.getState().setConversationCapabilityProjections({
    'text.generate': {
      capability: 'text.generate',
      selectedBinding: null,
      resolvedBinding: null,
      health: null,
      metadata: null,
      supported: false,
      reasonCode: 'selection_missing',
    },
  });

  try {
    await assert.rejects(
      () => invokeChatAiRuntime({
        prompt: 'hello cloud',
        threadId: 'thread-cloud',
        reasoningPreference: 'off',
        executionSnapshot: null,
        runtimeConfigState: state,
        runtimeFields: createRuntimeFields(),
      }, {
        invokeModLlmImpl: async () => ({
          text: 'hello back',
          traceId: 'trace-cloud',
          promptTraceId: 'prompt-cloud',
        }),
      }),
      /text\.generate execution snapshot/,
    );
  } finally {
    resetConversationCapabilityTestState();
  }
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
      selectedBinding: {
        source: 'cloud',
        connectorId: 'connector-ollama',
        provider: 'ollama',
        model: 'qwen3:4b',
        modelId: 'qwen3:4b',
      },
    resolvedBinding: {
      capability: 'text.generate',
      source: 'cloud',
      provider: 'ollama',
      connectorId: 'connector-ollama',
      model: 'qwen3:4b',
      modelId: 'qwen3:4b',
    },
    health: {
      healthy: true,
      status: 'healthy',
      detail: 'ready',
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
