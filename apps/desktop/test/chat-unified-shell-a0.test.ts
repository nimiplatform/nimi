import assert from 'node:assert/strict';
import test from 'node:test';

import { createReadyConversationSetupState } from '@nimiplatform/kit/features/chat/headless';
import { createUiSlice } from '../src/shell/renderer/app-shell/providers/ui-slice';
import type {
  AppStoreSet,
  AppStoreState,
} from '../src/shell/renderer/app-shell/providers/store-types';
import { INITIAL_RUNTIME_FIELDS } from '../src/shell/renderer/app-shell/providers/store-types';

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
    ...createUiSlice(set, {
      initialChatThinkingPreference: 'off',
      persistChatThinkingPreference: () => {},
    }),
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
    ai: 'ai:assistant',
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

  state.setNimiConversationSelection({
    threadId: 'ai-thread-1',
  });
  assert.equal(harness.getState().nimiConversationSelection.threadId, 'ai-thread-1');
  assert.equal(harness.getState().lastSelectedThreadByMode.ai, 'ai-thread-1');

  state.setAgentConversationSelection({
    agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    conversationAnchorId: 'anchor-agent-7',
    targetId: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });
  assert.equal(harness.getState().agentConversationSelection.agentHandle, 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(harness.getState().lastSelectedThreadByMode.agent, null);

  state.setChatSetupState('ai', createReadyConversationSetupState('ai'));
  assert.deepEqual(harness.getState().chatSetupState.ai, createReadyConversationSetupState('ai'));
});

test('A0 ui slice stages agent composer prefill as one-shot local UI state', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  assert.equal(state.pendingAgentComposerPrefill, null);

  state.setPendingAgentComposerPrefill({
    agentHandle: ' agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ',
    text: '  他为什么被称为阳明学派思想家与朝廷重臣？  ',
  });

  assert.deepEqual(harness.getState().pendingAgentComposerPrefill, {
    agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    text: '他为什么被称为阳明学派思想家与朝廷重臣？',
    requestId: 1,
  });

  harness.getState().clearPendingAgentComposerPrefill(99);
  assert.equal(harness.getState().pendingAgentComposerPrefill?.requestId, 1);

  harness.getState().clearPendingAgentComposerPrefill(1);
  assert.equal(harness.getState().pendingAgentComposerPrefill, null);
});

test('A0 world navigation opens world detail instead of chat', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  state.setActiveTab('explore');
  state.navigateToWorld(' world-alpha ');

  assert.equal(harness.getState().activeTab, 'world-detail');
  assert.deepEqual(harness.getState().navigationBackStack, [{
    activeTab: 'explore',
    selectedProfileId: null,
    selectedSourceRef: null,
    selectedWorldId: null,
    selectedWorldInitialSubpage: null,
  }]);
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

test('A0 world navigation can request the people archive as the initial detail subpage', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  state.setActiveTab('explore');
  state.navigateToWorld(' world-alpha ', { initialSubpage: 'people-archive' });

  assert.equal(harness.getState().activeTab, 'world-detail');
  assert.equal(harness.getState().selectedWorldId, 'world-alpha');
  assert.equal(harness.getState().selectedWorldInitialSubpage, 'people-archive');
});

test('A0 nested world character detail back returns to the world list origin', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  state.setActiveTab('explore');
  state.navigateToWorld('world-alpha', { initialSubpage: 'people-archive' });
  harness.getState().navigateToSourceDetail({
    kind: 'worldCharacter',
    id: 'character-alpha',
    worldId: 'world-alpha',
    worldEntityRef: { kind: 'worldEntity', worldId: 'world-alpha', entityId: 'entity-alpha' },
    sourceHash: 'a'.repeat(64),
  });

  harness.getState().navigateBack();

  assert.equal(harness.getState().activeTab, 'world-detail');
  assert.equal(harness.getState().selectedWorldId, 'world-alpha');
  assert.equal(harness.getState().selectedWorldInitialSubpage, 'people-archive');
  assert.equal(harness.getState().selectedSourceRef, null);

  harness.getState().navigateBack();

  assert.equal(harness.getState().activeTab, 'explore');
  assert.equal(harness.getState().selectedWorldId, null);
});

test('A0 nested world navigation back restores the exact source detail selection', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();
  const sourceRef = {
    kind: 'personaCharacter' as const,
    id: 'persona-alpha',
    worldId: 'world-alpha',
    ownerAccountId: 'account-alpha',
    sourceHash: 'b'.repeat(64),
  };

  state.setSelectedProfileId('human-profile-alpha');
  state.navigateToSourceDetail(sourceRef);

  assert.equal(harness.getState().activeTab, 'source-detail');
  assert.equal(harness.getState().selectedProfileId, 'human-profile-alpha');
  assert.deepEqual(harness.getState().selectedSourceRef, sourceRef);

  harness.getState().navigateToWorld('world-alpha');

  assert.equal(harness.getState().activeTab, 'world-detail');
  assert.equal(harness.getState().selectedSourceRef, null);

  harness.getState().navigateBack();

  assert.equal(harness.getState().activeTab, 'source-detail');
  assert.equal(harness.getState().selectedProfileId, 'human-profile-alpha');
  assert.deepEqual(harness.getState().selectedSourceRef, sourceRef);
  assert.equal(harness.getState().selectedWorldId, null);
  assert.equal(harness.getState().selectedWorldInitialSubpage, null);
});

test('A0 human profile navigation rejects Runtime LocalAgent references', () => {
  const harness = createUiSliceHarness();
  harness.getState().setActiveTab('explore');

  harness.getState().navigateToProfile('local-agent:account-a:agent-a');
  harness.getState().navigateToProfile({
    kind: 'personaCharacter',
    id: 'persona-a',
    worldId: 'world-a',
    ownerAccountId: 'account-a',
    sourceHash: 'a'.repeat(64),
  } as never);

  assert.equal(harness.getState().activeTab, 'explore');
  assert.equal(harness.getState().selectedProfileId, null);
  assert.deepEqual(harness.getState().navigationBackStack, []);
});

test('A0 Character detail navigation rejects incomplete source refs', () => {
  const harness = createUiSliceHarness();
  harness.getState().setActiveTab('explore');

  harness.getState().navigateToSourceDetail({
    kind: 'worldCharacter',
    id: 'character-alpha',
    worldId: 'world-alpha',
    sourceHash: 'a'.repeat(64),
  } as never);

  assert.equal(harness.getState().activeTab, 'explore');
  assert.equal(harness.getState().selectedSourceRef, null);
  assert.deepEqual(harness.getState().navigationBackStack, []);
});
