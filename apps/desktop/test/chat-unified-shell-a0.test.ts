import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { createReadyConversationSetupState } from '@nimiplatform/kit/features/chat/headless';
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
} from '../src/shell/renderer/features/chat/chat-nimi-route-view';
import type { ConversationCapabilityProjection } from '../src/shell/renderer/features/chat/conversation-capability';
import type { NimiRuntimeRouteOptionsSnapshot } from '@nimiplatform/sdk/runtime';

const chatNimiRouteViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/chat/chat-nimi-route-view.ts'),
  'utf8',
);

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
    selectedTargetRef: null,
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

  state.setNimiConversationSelection({
    threadId: 'ai-thread-1',
  });
  assert.equal(harness.getState().nimiConversationSelection.threadId, 'ai-thread-1');
  assert.equal(harness.getState().lastSelectedThreadByMode.ai, 'ai-thread-1');

  state.setAgentConversationSelection({
    localAgentRef: 'local-agent:user-1:agent-7',
    targetId: 'local-agent:user-1:agent-7',
  });
  assert.equal(harness.getState().agentConversationSelection.localAgentRef, 'local-agent:user-1:agent-7');
  assert.equal(harness.getState().lastSelectedThreadByMode.agent, null);

  state.setChatSetupState('ai', createReadyConversationSetupState('ai'));
  assert.deepEqual(harness.getState().chatSetupState.ai, createReadyConversationSetupState('ai'));
});

test('A0 world navigation opens world detail instead of chat', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  state.setActiveTab('explore');
  state.navigateToWorld(' world-alpha ');

  assert.equal(harness.getState().activeTab, 'world-detail');
  assert.equal(harness.getState().previousTab, 'explore');
  assert.equal(harness.getState().runtimeFields.worldId, 'world-alpha');
});

test('A0 world navigation can request the relationship explorer as the initial detail subpage', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  state.setActiveTab('explore');
  state.navigateToWorld(' world-alpha ', { initialSubpage: 'relationship-explorer' });

  assert.equal(harness.getState().activeTab, 'world-detail');
  assert.equal(harness.getState().selectedWorldId, 'world-alpha');
  assert.equal(harness.getState().selectedWorldInitialSubpage, 'relationship-explorer');

  harness.getState().navigateToWorld('world-beta');

  assert.equal(harness.getState().selectedWorldId, 'world-beta');
  assert.equal(harness.getState().selectedWorldInitialSubpage, null);
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

test('A0 AI route options derive from runtime.route.listOptions inventory', () => {
  const snapshot: NimiRuntimeRouteOptionsSnapshot = {
    capability: 'text.generate',
    selectedTargetRef: null,
    inventory: {
      capability: 'text.generate',
      targets: [{
        targetRef: { kind: 'local-runtime', version: 'v2', profileBindingId: 'local-runtime:local-qwen' },
        display: { label: 'Local runtime', provider: 'llama', model: 'qwen3', engine: 'llama' },
        readiness: { status: 'ready' },
        compatibility: { capabilities: ['chat'] },
        evidence: { source: 'local-runtime', localAssetId: 'local-qwen', resolvedModelId: 'qwen3', engine: 'llama' },
      }, {
        targetRef: {
          kind: 'cloud-connector',
          version: 'v2',
          connectorId: 'connector-openai',
          remoteModelCatalogId: 'remote-catalog:connector-openai:gpt-4.1',
          providerModelId: 'gpt-4.1',
          provider: 'openai',
        },
        display: { label: 'openai', provider: 'openai', model: 'gpt-4.1' },
        readiness: { status: 'ready' },
        compatibility: { capabilities: ['chat'] },
        evidence: {
          source: 'cloud-connector',
          connectorId: 'connector-openai',
          remoteModelCatalogId: 'remote-catalog:connector-openai:gpt-4.1',
          providerModelId: 'gpt-4.1',
          provider: 'openai',
        },
      }],
    },
  };

  const result = buildAiConversationRouteOptions(snapshot);

  assert.deepEqual(result.map((item) => ({
    label: item.label,
    detail: item.detail,
    source: item.targetRef.kind,
    key: item.key,
  })), [
    {
      label: 'Local runtime',
      detail: 'llama / qwen3 / llama',
      source: 'local-runtime',
      key: 'local-runtime|v2|local-runtime:local-qwen|',
    },
    {
      label: 'openai',
      detail: 'openai / gpt-4.1',
      source: 'cloud-connector',
      key: 'cloud-connector|v2|connector-openai|remote-catalog:connector-openai:gpt-4.1|gpt-4.1',
    },
  ]);
});

test('A0 AI route options consume SDK target inventory projections', () => {
  assert.match(chatNimiRouteViewSource, /isNimiRuntimeTargetInventoryItemSelectable/);
  assert.match(chatNimiRouteViewSource, /nimiRuntimeRouteTargetRefsMatch/);
  assert.doesNotMatch(chatNimiRouteViewSource, /nimiRuntimeRouteLocalOptionToBinding/);
  assert.doesNotMatch(chatNimiRouteViewSource, /nimiRuntimeRouteBindingsMatch/);
  assert.match(chatNimiRouteViewSource, /from '@nimiplatform\/sdk\/runtime'/);
  assert.doesNotMatch(chatNimiRouteViewSource, /source:\s*'local',\s*connectorId:\s*''/);
});

test('A0 AI route summary prefers projection resolvedBinding over selectedTargetRef', () => {
  const summary = buildAiConversationRouteSummary({
    projection: createProjection({
      supported: true,
      selectedTargetRef: {
        kind: 'cloud-connector',
        version: 'v2',
        connectorId: 'connector-openai',
        remoteModelCatalogId: 'remote-catalog:connector-openai:gpt-4.1',
        providerModelId: 'gpt-4.1',
        provider: 'openai',
      },
      resolvedBinding: {
        capability: 'text.generate',
        source: 'local-runtime',
        targetRef: { kind: 'local-runtime', version: 'v2', profileBindingId: 'local-runtime:local-qwen' },
        connectorId: '',
        provider: 'llama',
        model: 'qwen3',
        modelId: 'qwen3',
        localAssetId: 'local-qwen',
        engine: 'llama',
        resolvedBindingRef: 'resolved-local-qwen',
      },
    }),
    selectedTargetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: 'connector-openai',
      remoteModelCatalogId: 'remote-catalog:connector-openai:gpt-4.1',
      providerModelId: 'gpt-4.1',
      provider: 'openai',
    },
    routeOptions: [],
  });

  assert.deepEqual(summary, {
    label: 'Local runtime',
    detail: 'llama / qwen3',
  });
});
