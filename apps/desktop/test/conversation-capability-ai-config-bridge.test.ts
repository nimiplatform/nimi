import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiBuiltInChatAIScopeRef } from '@nimiplatform/sdk/ai';
import {
  aiConfigFromSelectionStore,
  createDefaultConversationCapabilitySelectionStore,
  selectionStoreFromAIConfig,
  updateConversationCapabilityBinding,
} from '../src/shell/renderer/features/chat/conversation-capability.js';

test('conversation capability bridge preserves local runtime selections in AIConfig targetRefs', () => {
  const store = updateConversationCapabilityBinding(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    {
      source: 'local',
      connectorId: 'runtime-local',
      model: 'llama-3.1',
      localModelId: 'local-llama',
    },
  );

  const config = aiConfigFromSelectionStore(store, createNimiBuiltInChatAIScopeRef('nimi'));

  assert.deepEqual(config.capabilities.targetRefs['text.generate'], {
    kind: 'local-runtime',
    targetId: 'runtime-local',
    profileId: 'local-llama',
    readinessRef: 'runtime-route:local:runtime-local:local-llama',
  });
});

test('conversation capability bridge hydrates cloud connector targetRefs into selected bindings', () => {
  const store = selectionStoreFromAIConfig({
    scopeRef: createNimiBuiltInChatAIScopeRef('agent'),
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'openrouter',
          providerModelId: 'anthropic/claude-sonnet',
          provider: 'openrouter',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  });

  assert.deepEqual(store.selectedBindings['text.generate'], {
    source: 'cloud',
    connectorId: 'openrouter',
    model: 'anthropic/claude-sonnet',
    provider: 'openrouter',
  });
});
