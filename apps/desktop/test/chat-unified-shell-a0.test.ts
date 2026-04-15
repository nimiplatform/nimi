import assert from 'node:assert/strict';
import test from 'node:test';

import { createReadyConversationSetupState } from '@nimiplatform/nimi-kit/features/chat/headless';
import { createUiSlice } from '../src/shell/renderer/app-shell/providers/ui-slice';
import type {
  AppStoreSet,
  AppStoreState,
} from '../src/shell/renderer/app-shell/providers/store-types';
import { INITIAL_RUNTIME_FIELDS } from '../src/shell/renderer/app-shell/providers/store-types';
import {
  buildAiConversationRouteOptions,
  buildAiConversationRouteSummary,
  resolveAiConversationSetupStateFromProjection,
} from '../src/shell/renderer/features/chat/chat-ai-route-view';
import type { ConversationCapabilityProjection } from '../src/shell/renderer/features/chat/conversation-capability';
import type { RuntimeRouteOptionsSnapshot } from '@nimiplatform/sdk/mod';

function createUiSliceHarness(): { getState: () => AppStoreState } {
  let state = {
    runtimeFields: { ...INITIAL_RUNTIME_FIELDS },
  } as AppStoreState;

  const set: AppStoreSet = (updater) => {
    const patch = typeof updater === 'function' ? updater(state) : updater;
    state = {
      ...state,
      ...patch,
    };
  };

  state = {
    ...state,
    ...createUiSlice(set),
  } as AppStoreState;

  return {
    getState: () => state,
  };
}

function createProjection(overrides: Partial<ConversationCapabilityProjection>): ConversationCapabilityProjection {
  return {
    capability: 'text.generate',
    selectedBinding: null,
    resolvedBinding: null,
    health: null,
    metadata: null,
    supported: false,
    reasonCode: null,
    ...overrides,
  };
}

test('A0 ui slice keeps mode-scoped thread state for AI/human/agent', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  assert.equal(state.chatMode, 'ai');
  assert.equal(state.chatSourceFilter, 'all');
  assert.deepEqual(state.lastSelectedThreadByMode, {
    ai: null,
    human: null,
    agent: null,
    group: null,
  });
  assert.deepEqual(state.selectedTargetBySource, {
    ai: 'ai:assistant',
    human: null,
    agent: null,
    group: null,
  });

  state.setSelectedChatId('human-thread-1');
  assert.equal(harness.getState().selectedChatId, 'human-thread-1');
  assert.equal(harness.getState().lastSelectedThreadByMode.human, 'human-thread-1');

  state.setChatSourceFilter('human');
  assert.equal(harness.getState().chatSourceFilter, 'human');

  state.setSelectedTargetForSource('human', 'user-7');
  assert.equal(harness.getState().selectedTargetBySource.human, 'user-7');

  state.setChatViewMode('human', 'user-7', 'chat');
  assert.equal(harness.getState().viewModeBySourceTarget['human:user-7'], 'chat');

  state.setAiConversationSelection({
    threadId: 'ai-thread-1',
  });
  assert.equal(harness.getState().aiConversationSelection.threadId, 'ai-thread-1');
  assert.equal(harness.getState().lastSelectedThreadByMode.ai, 'ai-thread-1');

  state.setAgentConversationSelection({
    threadId: 'agent-thread-1',
    agentId: 'agent-7',
    targetId: 'target-1',
  });
  assert.equal(harness.getState().agentConversationSelection.threadId, 'agent-thread-1');
  assert.equal(harness.getState().agentConversationSelection.agentId, 'agent-7');
  assert.equal(harness.getState().lastSelectedThreadByMode.agent, 'agent-thread-1');

  state.setChatSetupState('ai', createReadyConversationSetupState('ai'));
  assert.deepEqual(harness.getState().chatSetupState.ai, createReadyConversationSetupState('ai'));
});

test('A0 AI setup is ready only when text.generate projection is supported', () => {
  const result = resolveAiConversationSetupStateFromProjection(createProjection({
    supported: true,
  }));

  assert.deepEqual(result, createReadyConversationSetupState('ai'));
});

test('A0 AI setup maps selection missing to setup-required without inventing fallback route', () => {
  const result = resolveAiConversationSetupStateFromProjection(createProjection({
    reasonCode: 'selection_missing',
  }));

  assert.equal(result.status, 'setup-required');
  assert.equal(result.issues[0]?.code, 'ai-thread-route-unavailable');
  assert.equal(result.issues[0]?.detail, 'Select an AI route before sending a message.');
});

test('A0 AI setup maps explicit cleared selection to setup-required without inventing fallback route', () => {
  const result = resolveAiConversationSetupStateFromProjection(createProjection({
    reasonCode: 'selection_cleared',
  }));

  assert.equal(result.status, 'setup-required');
  assert.equal(result.issues[0]?.code, 'ai-thread-route-unavailable');
  assert.equal(result.issues[0]?.detail, 'Select an AI route before sending a message.');
});

test('A0 AI route options derive from runtime.route.listOptions snapshot, not runtime-config readiness', () => {
  const snapshot: RuntimeRouteOptionsSnapshot = {
    capability: 'text.generate',
    selected: null,
    local: {
      defaultEndpoint: 'http://127.0.0.1:11434/v1',
      models: [{
        localModelId: 'local-qwen',
        model: 'qwen3',
        modelId: 'qwen3',
        engine: 'llama',
        provider: 'llama',
        capabilities: ['chat'],
        status: 'active',
      }],
    },
    connectors: [{
      id: 'connector-openai',
      label: 'OpenAI',
      provider: 'openai',
      models: ['gpt-4.1'],
      modelCapabilities: {
        'gpt-4.1': ['chat'],
      },
    }],
  };

  const result = buildAiConversationRouteOptions(snapshot);

  assert.deepEqual(result.map((item) => ({
    label: item.label,
    detail: item.detail,
    source: item.binding.source,
    connectorId: item.binding.connectorId,
    model: item.binding.model,
    localModelId: item.binding.localModelId || null,
  })), [
    {
      label: 'Local runtime',
      detail: 'llama · qwen3',
      source: 'local',
      connectorId: '',
      model: 'qwen3',
      localModelId: 'local-qwen',
    },
    {
      label: 'openai',
      detail: 'gpt-4.1',
      source: 'cloud',
      connectorId: 'connector-openai',
      model: 'gpt-4.1',
      localModelId: null,
    },
  ]);
});

test('A0 AI route summary prefers projection resolvedBinding over selectedBinding', () => {
  const summary = buildAiConversationRouteSummary({
    projection: createProjection({
      supported: true,
      selectedBinding: {
        source: 'cloud',
        connectorId: 'connector-openai',
        provider: 'openai',
        model: 'gpt-4.1',
      },
      resolvedBinding: {
        capability: 'text.generate',
        source: 'local',
        connectorId: '',
        provider: 'llama',
        model: 'qwen3',
        modelId: 'qwen3',
        localModelId: 'local-qwen',
        engine: 'llama',
        resolvedBindingRef: 'resolved-local-qwen',
      },
    }),
    selectedBinding: {
      source: 'cloud',
      connectorId: 'connector-openai',
      provider: 'openai',
      model: 'gpt-4.1',
    },
    routeOptions: [],
  });

  assert.deepEqual(summary, {
    label: 'Local runtime',
    detail: 'llama · qwen3',
  });
});
