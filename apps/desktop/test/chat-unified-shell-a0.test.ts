import assert from 'node:assert/strict';
import test from 'node:test';

import { createReadyConversationSetupState } from '@nimiplatform/nimi-kit/features/chat/headless';
import { createUiSlice } from '../src/shell/renderer/app-shell/providers/ui-slice';
import type {
  AppStoreSet,
  AppStoreState,
} from '../src/shell/renderer/app-shell/providers/store-types';
import { INITIAL_RUNTIME_FIELDS } from '../src/shell/renderer/app-shell/providers/store-types';
import { resolveAiConversationRouteReadiness } from '../src/shell/renderer/features/chat/chat-ai-route-readiness';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';

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

test('A0 ui slice keeps mode-scoped thread state for AI/human/agent', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  assert.equal(state.chatMode, 'ai');
  assert.equal(state.chatSourceFilter, 'all');
  assert.deepEqual(state.lastSelectedThreadByMode, {
    ai: null,
    human: null,
    agent: null,
  });
  assert.deepEqual(state.selectedTargetBySource, {
    ai: null,
    human: null,
    agent: null,
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
    routeSnapshot: null,
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

test('A0 AI route readiness fails closed while runtime config state is unavailable', () => {
  const result = resolveAiConversationRouteReadiness({
    runtimeConfigState: null,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.setupState.primaryAction?.kind, 'open-settings');
  if (result.setupState.primaryAction?.kind !== 'open-settings') {
    assert.fail('expected unavailable AI readiness to expose an open-settings action');
  }
  assert.equal(result.setupState.primaryAction.targetId, 'runtime-overview');
  assert.deepEqual(result.readyRoutes, []);
});

test('A0 AI route readiness accepts a healthy local chat route without cloud state', () => {
  const state = createDefaultStateV11({});
  state.local.status = 'healthy';
  state.local.models = [{
    localModelId: 'local-qwen',
    engine: 'llama',
    model: 'qwen3',
    endpoint: 'http://127.0.0.1:11434/v1',
    capabilities: ['chat'],
    status: 'active',
  }];

  const result = resolveAiConversationRouteReadiness({
    runtimeConfigState: state,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.localReady, true);
  assert.equal(result.cloudReady, false);
  assert.deepEqual(result.defaultRoute, {
    routeKind: 'local',
    connectorId: null,
    provider: null,
    modelId: null,
  });
});

test('A0 AI route readiness does not silently fall back when a saved cloud route is gone', () => {
  const state = createDefaultStateV11({});
  state.local.status = 'healthy';
  state.local.models = [{
    localModelId: 'local-qwen',
    engine: 'llama',
    model: 'qwen3',
    endpoint: 'http://127.0.0.1:11434/v1',
    capabilities: ['chat'],
    status: 'active',
  }];
  state.connectors = [{
    id: 'connector-openai',
    label: 'OpenAI',
    vendor: 'gpt',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    scope: 'user',
    hasCredential: true,
    isSystemOwned: false,
    models: ['gpt-4.1'],
    modelCapabilities: {
      'gpt-4.1': ['chat'],
    },
    status: 'healthy',
    lastCheckedAt: null,
    lastDetail: '',
  }];

  const result = resolveAiConversationRouteReadiness({
    runtimeConfigState: state,
    routeSnapshot: {
      routeKind: 'cloud',
      connectorId: 'connector-missing',
      provider: 'openai',
      modelId: 'gpt-4.1',
      routeBinding: null,
    },
  });

  assert.equal(result.status, 'setup-required');
  assert.equal(result.defaultRoute, null);
  assert.equal(result.setupState.issues[0]?.code, 'ai-thread-route-unavailable');
  if (result.setupState.primaryAction?.kind !== 'open-settings') {
    assert.fail('expected saved cloud-route recovery to open runtime settings');
  }
  assert.equal(result.setupState.primaryAction.targetId, 'runtime-cloud');
  assert.equal(result.readyRoutes.length, 2);
});

test('A0 AI route readiness requires explicit cloud readiness instead of assuming configured connectors are ready', () => {
  const state = createDefaultStateV11({});
  state.local.status = 'unreachable';
  state.connectors = [{
    id: 'connector-openai',
    label: 'OpenAI',
    vendor: 'gpt',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    scope: 'user',
    hasCredential: true,
    isSystemOwned: false,
    models: ['gpt-4.1'],
    modelCapabilities: {
      'gpt-4.1': ['chat'],
    },
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  }];

  const result = resolveAiConversationRouteReadiness({
    runtimeConfigState: state,
  });

  assert.equal(result.status, 'setup-required');
  assert.equal(result.cloudReady, false);
  assert.equal(result.configuredCloudConnectorCount, 1);
  assert.deepEqual(result.readyRoutes, []);
  if (result.setupState.primaryAction?.kind !== 'open-settings') {
    assert.fail('expected cloud remediation to open runtime settings');
  }
  assert.equal(result.setupState.primaryAction.targetId, 'runtime-cloud');
  assert.deepEqual(
    result.setupState.issues.map((issue) => issue.code),
    ['ai-local-route-unavailable', 'ai-cloud-route-unavailable', 'ai-no-chat-route'],
  );
});
