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

  assert.equal(state.chatSourceFilter, 'all');
  assert.deepEqual(state.lastSelectedThreadByMode, {
    ai: null,
    human: null,
    agent: null,
  });
  state.setLastSelectedThreadForMode('human', 'human-thread-1');
  assert.equal(harness.getState().lastSelectedThreadByMode.human, 'human-thread-1');

  state.setChatSourceFilter('human');
  assert.equal(harness.getState().chatSourceFilter, 'human');

  state.setChatViewMode('human', 'user-7', 'chat');
  assert.equal(harness.getState().viewModeBySourceTarget['human:user-7'], 'chat');

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

test('A0 ui slice stages agent composer prefill by character source key', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  state.setPendingAgentComposerPrefill({
    sourceKey: ' worldCharacter:world-1:source-1:entity-1:hash ',
    text: '  他为什么被称为边塞诗人、七绝圣手？  ',
  });

  assert.deepEqual(harness.getState().pendingAgentComposerPrefill, {
    sourceKey: 'worldCharacter:world-1:source-1:entity-1:hash',
    text: '他为什么被称为边塞诗人、七绝圣手？',
    requestId: 1,
  });

  harness.getState().setPendingAgentComposerPrefill({ text: 'no routing key at all' });
  assert.equal(harness.getState().pendingAgentComposerPrefill, null);
});
