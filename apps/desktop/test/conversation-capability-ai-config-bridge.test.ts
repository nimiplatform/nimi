import assert from 'node:assert/strict';
import test from 'node:test';

import { projectNimiRuntimeLocalAgentAIScopeRef } from '@nimiplatform/sdk/ai';
import {
  aiConfigFromSelectionStore,
  createDefaultConversationCapabilitySelectionStore,
  selectionStoreFromAIConfig,
  updateConversationCapabilityTargetRef,
} from '../src/shell/renderer/features/chat/conversation-capability.js';

test('conversation capability bridge preserves local runtime targetRefs in AIConfig', () => {
  const store = updateConversationCapabilityTargetRef(
    createDefaultConversationCapabilitySelectionStore(),
    'text.generate',
    {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:local-llama',
    },
  );

  const config = aiConfigFromSelectionStore(
    store,
    projectNimiRuntimeLocalAgentAIScopeRef('runtime.local-agent-subsystem'),
  );

  assert.deepEqual(config.capabilities.targetRefs['text.generate'], {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: 'local-runtime:local-llama',
  });
});

test('conversation capability bridge hydrates cloud connector targetRefs into route targetRefs', () => {
  const store = selectionStoreFromAIConfig({
    scopeRef: projectNimiRuntimeLocalAgentAIScopeRef('local-agent:test'),
    capabilities: {
      logicalModelIds: { 'text.generate': 'anthropic/claude-sonnet' },
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'openrouter',
          remoteModelCatalogId: 'remote-catalog:openrouter:anthropic/claude-sonnet',
          providerModelId: 'anthropic/claude-sonnet',
          provider: 'openrouter',
        },
      },
      selectedComponents: {},
      selectedParams: {},
    },
    profileOrigin: null,
  });

  assert.deepEqual(store.targetRefs['text.generate'], {
    kind: 'cloud-connector',
    version: 'v2',
    connectorId: 'openrouter',
    remoteModelCatalogId: 'remote-catalog:openrouter:anthropic/claude-sonnet',
    providerModelId: 'anthropic/claude-sonnet',
    provider: 'openrouter',
  });
});

test('conversation capability bridge hydrates local runtime readiness refs', () => {
  const store = selectionStoreFromAIConfig({
    scopeRef: projectNimiRuntimeLocalAgentAIScopeRef('local-agent:test'),
    capabilities: {
      logicalModelIds: { 'text.generate': 'local/llama' },
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          readinessRef: 'readiness:llama:01KTEX08DS2GR9HJ1X3R459P1B',
        },
      },
      selectedComponents: {},
      selectedParams: {},
    },
    profileOrigin: null,
  });

  assert.deepEqual(store.targetRefs['text.generate'], {
    kind: 'local-runtime',
    version: 'v2',
    readinessRef: 'readiness:llama:01KTEX08DS2GR9HJ1X3R459P1B',
  });
});
