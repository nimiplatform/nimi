import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_MODES,
  createConversationShellViewModel,
  createReadyConversationSetupState,
  hasConversationSetupBlockingState,
  hasConversationComposer,
  isConversationMode,
  resolveConversationRuntimeRouteSetupStateFromProjection,
  resolveConversationThreadById,
} from '../src/headless.js';

describe('conversation headless contract', () => {
  it('exposes the unified AI/human/agent mode set', () => {
    expect(CONVERSATION_MODES).toEqual(['ai', 'human', 'agent', 'group']);
    expect(isConversationMode('ai')).toBe(true);
    expect(isConversationMode('human')).toBe(true);
    expect(isConversationMode('agent')).toBe(true);
    expect(isConversationMode('group')).toBe(true);
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

  it('maps Runtime route projections to reusable setup state without owning route truth', () => {
    expect(resolveConversationRuntimeRouteSetupStateFromProjection({
      projection: { supported: true, reasonCode: null },
    })).toEqual(createReadyConversationSetupState('ai'));

    expect(resolveConversationRuntimeRouteSetupStateFromProjection({
      projection: { supported: false, reasonCode: 'metadata_missing' },
    })).toEqual({
      mode: 'ai',
      status: 'setup-required',
      issues: [{
        code: 'ai-thread-route-unavailable',
        detail: 'The selected AI route metadata is unavailable. Pick another route.',
      }],
      primaryAction: {
        kind: 'open-settings',
        targetId: 'runtime-overview',
        returnToMode: 'ai',
      },
    });

    expect(resolveConversationRuntimeRouteSetupStateFromProjection({
      mode: 'agent',
      projection: { supported: false, reasonCode: 'host_denied' },
      issueCode: 'agent-contract-unavailable',
      actionTargetId: 'runtime-local',
      returnToMode: 'agent',
      detailByReasonCode: {
        host_denied: 'Runtime host denied this route.',
      },
    })).toEqual({
      mode: 'agent',
      status: 'setup-required',
      issues: [{
        code: 'agent-contract-unavailable',
        detail: 'Runtime host denied this route.',
      }],
      primaryAction: {
        kind: 'open-settings',
        targetId: 'runtime-local',
        returnToMode: 'agent',
      },
    });
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
