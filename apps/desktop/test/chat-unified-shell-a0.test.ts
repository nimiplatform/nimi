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

test('A0 ui slice keeps mode-scoped thread state for AI and human', () => {
  const harness = createUiSliceHarness();
  const state = harness.getState();

  assert.equal(state.chatSourceFilter, 'all');
  assert.deepEqual(state.lastSelectedThreadByMode, {
    ai: null,
    human: null,
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
