import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockWorldDataClient = vi.hoisted(() => ({
  FORGE_WORLD_WORKSPACE_TARGET_PATH: 'forge.workspace.world',
  FORGE_WORLD_WORKSPACE_SCHEMA_VERSION: '1',
  createWorldDraft: vi.fn(),
  updateWorldDraft: vi.fn(),
  publishWorldDraft: vi.fn(),
  commitWorldState: vi.fn(),
  listWorldRules: vi.fn(),
  createWorldRule: vi.fn(),
  updateWorldRule: vi.fn(),
  deprecateWorldRule: vi.fn(),
  archiveWorldRule: vi.fn(),
  listAgentRules: vi.fn(),
  createAgentRule: vi.fn(),
  updateAgentRule: vi.fn(),
  deprecateAgentRule: vi.fn(),
  archiveAgentRule: vi.fn(),
  appendWorldHistory: vi.fn(),
  batchUpsertWorldResourceBindings: vi.fn(),
  batchCreateCreatorAgents: vi.fn(),
  listMyWorlds: vi.fn(),
  listWorldDrafts: vi.fn(),
  listWorldHistory: vi.fn(),
  getWorldState: vi.fn(),
  listWorldLorebooks: vi.fn(),
  listWorldResourceBindings: vi.fn(),
  getMyWorldAccess: vi.fn(),
  resolveWorldLanding: vi.fn(),
  getWorldDraft: vi.fn(),
  listCreatorAgents: vi.fn(),
  createCreatorAgent: vi.fn(),
}));

vi.mock('@renderer/data/world-data-client.js', () => mockWorldDataClient);

import { useWorldCommitActions } from './use-world-commit-actions.js';

function buildDraftPayload() {
  return {
    importSource: {
      sourceType: 'TEXT' as const,
      sourceRef: 'ref1',
      sourceText: 'seed text',
    },
    truthDraft: {
      worldRules: [{
        ruleKey: 'axiom:time:flow',
        title: 'Time flows',
        statement: 'Time moves forward.',
        category: 'DEFINITION',
        domain: 'AXIOM',
        hardness: 'HARD',
        priority: 100,
        provenance: 'CREATOR',
        scope: 'WORLD',
      }],
      agentRules: [],
    },
    stateDraft: {
      worldState: { name: 'Realm' },
    },
    historyDraft: {
      events: { primary: [], secondary: [] },
    },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useWorldCommitActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all expected mutation objects', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    expect(result.current).toHaveProperty('saveDraftMutation');
    expect(result.current).toHaveProperty('publishDraftMutation');
    expect(result.current).toHaveProperty('saveMaintenanceMutation');
    expect(result.current).toHaveProperty('listWorldRulesMutation');
    expect(result.current).toHaveProperty('createWorldRuleMutation');
    expect(result.current).toHaveProperty('updateWorldRuleMutation');
    expect(result.current).toHaveProperty('deprecateWorldRuleMutation');
    expect(result.current).toHaveProperty('archiveWorldRuleMutation');
    expect(result.current).toHaveProperty('listAgentRulesMutation');
    expect(result.current).toHaveProperty('createAgentRuleMutation');
    expect(result.current).toHaveProperty('updateAgentRuleMutation');
    expect(result.current).toHaveProperty('deprecateAgentRuleMutation');
    expect(result.current).toHaveProperty('archiveAgentRuleMutation');
    expect(result.current).toHaveProperty('syncEventsMutation');
    expect(result.current).toHaveProperty('syncResourceBindingsMutation');
    expect(result.current).toHaveProperty('deleteEventMutation');
    expect(result.current).toHaveProperty('batchCreateCreatorAgentsMutation');
  });

  it('saveDraftMutation creates a new draft when no draftId', async () => {
    mockWorldDataClient.createWorldDraft.mockResolvedValue({ id: 'new-draft' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await act(async () => {
      result.current.saveDraftMutation.mutate({
        sourceType: 'TEXT',
        sourceRef: 'ref1',
        status: 'DRAFT',
        draftPayload: buildDraftPayload(),
      });
    });

    await vi.waitFor(() => expect(result.current.saveDraftMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.createWorldDraft).toHaveBeenCalled();
    expect(mockWorldDataClient.updateWorldDraft).not.toHaveBeenCalled();
  });

  it('saveDraftMutation updates when draftId is provided', async () => {
    mockWorldDataClient.updateWorldDraft.mockResolvedValue({ id: 'existing-draft' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await act(async () => {
      result.current.saveDraftMutation.mutate({
        draftId: 'existing-draft',
        sourceType: 'TEXT',
        sourceRef: 'ref1',
        status: 'REVIEW',
        draftPayload: buildDraftPayload(),
      });
    });

    await vi.waitFor(() => expect(result.current.saveDraftMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.updateWorldDraft).toHaveBeenCalledWith('existing-draft', expect.any(Object));
    expect(mockWorldDataClient.createWorldDraft).not.toHaveBeenCalled();
  });

  it('deleteEventMutation fails close because world history is append-only', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await expect(result.current.deleteEventMutation.mutateAsync()).rejects.toThrow(
      /WORLD_HISTORY_APPEND_ONLY/,
    );
  });

  it('syncResourceBindingsMutation calls batchUpsertWorldResourceBindings', async () => {
    mockWorldDataClient.batchUpsertWorldResourceBindings.mockResolvedValue({
      worldId: 'w1',
      items: [],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await expect(
      result.current.syncResourceBindingsMutation.mutateAsync({
        worldId: 'w1',
        bindingUpserts: [{
          targetType: 'WORLD',
          targetId: 'w1',
          slot: 'WORLD_ICON',
          resource: {
            resourceType: 'IMAGE',
            storageRef: 'https://cdn.example/icon.png',
          },
        }],
        reason: 'sync',
        sessionId: 'ws-1',
      }),
    ).resolves.toEqual({
      worldId: 'w1',
      items: [],
    });

    expect(mockWorldDataClient.batchUpsertWorldResourceBindings).toHaveBeenCalledWith('w1', {
      bindingUpserts: [{
        targetType: 'WORLD',
        targetId: 'w1',
        slot: 'WORLD_ICON',
        resource: {
          resourceType: 'IMAGE',
          storageRef: 'https://cdn.example/icon.png',
        },
      }],
    });
  });

  it('saveMaintenanceMutation only forwards canonical state writes', async () => {
    mockWorldDataClient.commitWorldState.mockResolvedValue({
      worldId: 'w1',
      version: 'state-v2',
      items: [],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await act(async () => {
      result.current.saveMaintenanceMutation.mutate({
        worldId: 'w1',
        worldState: { name: 'Realm' },
        reason: 'save',
        sessionId: 'ws-1',
        ifSnapshotVersion: 'snap-1',
      });
    });

    await vi.waitFor(() => expect(result.current.saveMaintenanceMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.commitWorldState).toHaveBeenCalledWith('w1', {
      writes: [{
        scope: 'WORLD',
        scopeKey: 'w1',
        targetPath: mockWorldDataClient.FORGE_WORLD_WORKSPACE_TARGET_PATH,
        payload: { name: 'Realm' },
        metadata: { owner: 'forge-maintenance' },
      }],
      reason: 'save',
      sessionId: 'ws-1',
      ifSnapshotVersion: 'snap-1',
    });
  });

  it('createWorldRuleMutation calls createWorldRule', async () => {
    mockWorldDataClient.createWorldRule.mockResolvedValue({ id: 'wr-1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await act(async () => {
      result.current.createWorldRuleMutation.mutate({
        worldId: 'w1',
        payload: {
          ruleKey: 'axiom:time:flow',
          title: 'Time flows',
          statement: 'Time flows forward.',
          category: 'DEFINITION',
          domain: 'AXIOM',
          hardness: 'HARD',
          priority: 100,
          provenance: 'CREATOR',
          scope: 'WORLD',
        },
      });
    });

    await vi.waitFor(() => expect(result.current.createWorldRuleMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.createWorldRule).toHaveBeenCalledWith('w1', {
      ruleKey: 'axiom:time:flow',
      title: 'Time flows',
      statement: 'Time flows forward.',
      category: 'DEFINITION',
      domain: 'AXIOM',
      hardness: 'HARD',
      priority: 100,
      provenance: 'CREATOR',
      scope: 'WORLD',
    });
  });

  it('archiveAgentRuleMutation calls archiveAgentRule', async () => {
    mockWorldDataClient.archiveAgentRule.mockResolvedValue({ id: 'ar-1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await act(async () => {
      result.current.archiveAgentRuleMutation.mutate({
        worldId: 'w1',
        agentId: 'a1',
        ruleId: 'r1',
      });
    });

    await vi.waitFor(() => expect(result.current.archiveAgentRuleMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.archiveAgentRule).toHaveBeenCalledWith('w1', 'a1', 'r1');
  });
});
