import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_MODES,
  createConversationShellViewModel,
  createReadyConversationSetupState,
  hasConversationSetupBlockingState,
  hasConversationComposer,
  isConversationMode,
  resolveConversationThreadById,
} from '../src/headless.js';

describe('conversation headless contract', () => {
  it('exposes the unified AI/human/agent mode set', () => {
    expect(CONVERSATION_MODES).toEqual(['ai', 'human', 'agent']);
    expect(isConversationMode('ai')).toBe(true);
    expect(isConversationMode('human')).toBe(true);
    expect(isConversationMode('agent')).toBe(true);
    expect(isConversationMode('local')).toBe(false);
  });

  it('treats ready setup state as non-blocking', () => {
    const ready = createReadyConversationSetupState('ai');
    expect(ready).toEqual({
      mode: 'ai',
      status: 'ready',
      issues: [],
      primaryAction: null,
    });
    expect(hasConversationSetupBlockingState(ready)).toBe(false);
    expect(hasConversationSetupBlockingState({
      mode: 'agent',
      status: 'unavailable',
      issues: [{ code: 'agent-contract-unavailable' }],
      primaryAction: null,
    })).toBe(true);
  });

  it('fails closed when the active thread is missing', () => {
    const viewModel = createConversationShellViewModel({
      adapter: {
        mode: 'human',
        setupState: createReadyConversationSetupState('human'),
        threadAdapter: {
          listThreads: () => [{
            id: 'thread-1',
            mode: 'human',
            title: 'Alice',
            previewText: 'Hi',
            createdAt: '2026-04-04T00:00:00.000Z',
            updatedAt: '2026-04-04T00:00:00.000Z',
            unreadCount: 0,
            status: 'active',
          }],
          listMessages: () => [],
        },
        composerAdapter: {
          submit: () => undefined,
          placeholder: 'Reply',
        },
      },
      activeMode: 'human',
      activeThreadId: 'missing-thread',
      modes: [
        { mode: 'ai', label: 'AI', enabled: true },
        { mode: 'human', label: 'Human', enabled: true, badge: 1 },
      ],
    });

    expect(viewModel.activeThreadId).toBe('missing-thread');
    expect(viewModel.selectedThread).toBeNull();
    expect(viewModel.canCompose).toBe(false);
    expect(viewModel.composerPlaceholder).toBeNull();
  });

  it('does not synthesize agent threads or composer state when unavailable', () => {
    const viewModel = createConversationShellViewModel({
      adapter: {
        mode: 'agent',
        setupState: {
          mode: 'agent',
          status: 'unavailable',
          issues: [{ code: 'agent-contract-unavailable' }],
          primaryAction: null,
        },
        threadAdapter: {
          listThreads: () => [],
          listMessages: () => [],
        },
        composerAdapter: null,
      },
      activeThreadId: null,
    });

    expect(viewModel.threads).toEqual([]);
    expect(viewModel.selectedThread).toBeNull();
    expect(viewModel.canCompose).toBe(false);
  });

  it('shows composer only when setup is ready and a thread is selected', () => {
    expect(resolveConversationThreadById([], 'missing')).toBeNull();
    expect(hasConversationComposer({
      setupState: createReadyConversationSetupState('ai'),
      composerAdapter: {
        submit: () => undefined,
      },
      activeThreadId: null,
    })).toBe(false);
    expect(hasConversationComposer({
      setupState: createReadyConversationSetupState('ai'),
      composerAdapter: {
        submit: () => undefined,
      },
      activeThreadId: 'thread-1',
    })).toBe(true);
  });
});
