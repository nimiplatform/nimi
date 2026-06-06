import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  type ConversationCapabilityRouteRuntime,
  updateConversationCapabilityBinding,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import type { NimiRuntimeRouteBinding } from '@nimiplatform/sdk/runtime';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

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

test('chat ai a4: adapter does not persist text.generate route selections into AIConfig truth', () => {
  const adapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-shell-adapter.tsx');
  assert.match(adapterSource, /selectedBinding:\s*null/);
  assert.doesNotMatch(adapterSource, /aiConfig\.capabilities\.selectedBindings\['text\.generate'\]/);
  assert.doesNotMatch(adapterSource, /aiConfig\.capabilities\.targetRefs\['text\.generate'\]/);
  assert.doesNotMatch(adapterSource, /surface\.aiConfig\.update\(/);
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
  const presentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-shell-presentation.tsx');
  const hostActionsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-shell-host-actions.ts');
  const adapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-shell-adapter.tsx');

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
  const cloudBinding: NimiRuntimeRouteBinding = {
    source: 'cloud' as const,
    connectorId: 'connector-ollama',
    provider: 'ollama',
    model: 'qwen3-cloud',
    modelId: 'qwen3-cloud',
  };
  const localBinding: NimiRuntimeRouteBinding = {
    source: 'local' as const,
    connectorId: '',
    model: 'qwen3-local',
    modelId: 'qwen3-local',
    localModelId: 'local-model-2',
    engine: 'llama',
    provider: 'llama',
    endpoint: 'http://127.0.0.1:22434',
  };

  const routeRuntime: ConversationCapabilityRouteRuntime = {
    resolve: async ({ binding }) => {
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
        localModelId: 'local-model-2',
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

test('chat ai a4: no stale local-model preference helper remains in runtime adapter', () => {
  const runtimeSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-nimi-runtime.ts');

  assert.equal(
    /resolvePreferredChatLocalModel/.test(runtimeSource),
    false,
    'chat-nimi-runtime.ts must not keep stale local model preference fallback helpers',
  );
  assert.equal(
    /Fall back to runtime-config state when authoritative health is unavailable/.test(runtimeSource),
    false,
    'chat-nimi-runtime.ts must not retain runtime-config health fallback comments or logic',
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
