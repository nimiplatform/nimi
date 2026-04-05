import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeChatAiRuntime } from '../src/shell/renderer/features/chat/chat-ai-runtime.js';
import {
  AI_NEW_CONVERSATION_TITLE,
  resolveAiConversationActiveThreadId,
  resolveThreadTitleAfterFirstSend,
  toAiRouteSnapshotFromResolvedRoute,
} from '../src/shell/renderer/features/chat/chat-ai-thread-model.js';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';
import type { RuntimeFieldMap } from '../src/shell/renderer/app-shell/providers/store-types.js';

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

test('chat ai a4: active thread restore prefers explicit selection before last selected', () => {
  const threads = [{
    id: 'thread-a',
    title: 'alpha',
    updatedAtMs: 10,
    lastMessageAtMs: 10,
    archivedAtMs: null,
    routeSnapshot: {
      routeKind: 'local' as const,
      connectorId: null,
      provider: null,
      modelId: null,
      routeBinding: null,
    },
  }, {
    id: 'thread-b',
    title: 'beta',
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    archivedAtMs: null,
    routeSnapshot: {
      routeKind: 'local' as const,
      connectorId: null,
      provider: null,
      modelId: null,
      routeBinding: null,
    },
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

test('chat ai a4: readiness route snapshots enrich cloud model ids from healthy connectors', () => {
  const state = createRuntimeConfigState();
  const routeSnapshot = toAiRouteSnapshotFromResolvedRoute({
    routeKind: 'cloud',
    connectorId: 'connector-openai',
    provider: 'openai',
    modelId: null,
  }, state, null);

  assert.deepEqual(routeSnapshot, {
    routeKind: 'cloud',
    connectorId: 'connector-openai',
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    routeBinding: null,
  });
});

test('chat ai a4: invoke runtime uses desktop-owned core caller and local route defaults', async () => {
  const state = createRuntimeConfigState();
  let capturedInput: CapturedInvokeInput | null = null;

  const result = await invokeChatAiRuntime({
    routeSnapshot: {
      routeKind: 'local',
      connectorId: null,
      provider: null,
      modelId: null,
      routeBinding: null,
    },
    prompt: 'hello',
    threadId: 'thread-local',
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
});

test('chat ai a4: invoke runtime hydrates cloud model ids from connector state when snapshot omits model', async () => {
  const state = createRuntimeConfigState();
  let capturedInput: CapturedInvokeInput | null = null;

  await invokeChatAiRuntime({
    routeSnapshot: {
      routeKind: 'cloud',
      connectorId: 'connector-openai',
      provider: 'openai',
      modelId: null,
      routeBinding: null,
    },
    prompt: 'hello cloud',
    threadId: 'thread-cloud',
    runtimeConfigState: state,
    runtimeFields: createRuntimeFields(),
  }, {
    invokeModLlmImpl: async (input) => {
      capturedInput = input as CapturedInvokeInput;
      return {
        text: 'hello back',
        traceId: 'trace-cloud',
        promptTraceId: 'prompt-cloud',
      };
    },
  });

  if (!capturedInput) {
    throw new Error('expected cloud invoke input');
  }
  const cloudInput = capturedInput as CapturedInvokeInput;
  assert.equal(cloudInput.modId, 'core.chat-ai');
  assert.equal(cloudInput.provider, 'openai');
  assert.equal(cloudInput.connectorId, 'connector-openai');
  assert.equal(cloudInput.localProviderModel, 'gpt-5.4-mini');
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
