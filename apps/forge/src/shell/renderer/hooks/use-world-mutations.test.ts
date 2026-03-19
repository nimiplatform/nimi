import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockWorldDataClient = vi.hoisted(() => ({
  createWorldDraft: vi.fn(),
  updateWorldDraft: vi.fn(),
  publishWorldDraft: vi.fn(),
  updateWorldMaintenance: vi.fn(),
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
  batchUpsertWorldEvents: vi.fn(),
  batchUpsertWorldMediaBindings: vi.fn(),
  deleteWorldEvent: vi.fn(),
  batchCreateCreatorAgents: vi.fn(),
  listMyWorlds: vi.fn(),
  listWorldDrafts: vi.fn(),
  listWorldEvents: vi.fn(),
  getWorldMaintenance: vi.fn(),
  listWorldLorebooks: vi.fn(),
  listWorldMediaBindings: vi.fn(),
  listWorldMutations: vi.fn(),
  getMyWorldAccess: vi.fn(),
  resolveWorldLanding: vi.fn(),
  getWorldDraft: vi.fn(),
  deleteWorldMediaBinding: vi.fn(),
  listWorldNarrativeContexts: vi.fn(),
  listWorldScenes: vi.fn(),
  listCreatorAgents: vi.fn(),
  createCreatorAgent: vi.fn(),
}));

vi.mock('@renderer/data/world-data-client.js', () => mockWorldDataClient);

import { useWorldMutations } from './use-world-mutations.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useWorldMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all expected mutation objects', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldMutations(), { wrapper });

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
    expect(result.current).toHaveProperty('syncLorebooksMutation');
    expect(result.current).toHaveProperty('syncEventsMutation');
    expect(result.current).toHaveProperty('syncMediaBindingsMutation');
    expect(result.current).toHaveProperty('deleteLorebookMutation');
    expect(result.current).toHaveProperty('deleteEventMutation');
    expect(result.current).toHaveProperty('batchCreateCreatorAgentsMutation');
  });

  it('saveDraftMutation creates a new draft when no draftId', async () => {
    mockWorldDataClient.createWorldDraft.mockResolvedValue({ id: 'new-draft' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldMutations(), { wrapper });

    await act(async () => {
      result.current.saveDraftMutation.mutate({
        sourceType: 'TEXT',
        sourceRef: 'ref1',
        status: 'DRAFT',
        pipelineState: {},
        draftPayload: { content: 'hello' },
      });
    });

    await vi.waitFor(() => expect(result.current.saveDraftMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.createWorldDraft).toHaveBeenCalled();
    expect(mockWorldDataClient.updateWorldDraft).not.toHaveBeenCalled();
  });

  it('saveDraftMutation updates when draftId is provided', async () => {
    mockWorldDataClient.updateWorldDraft.mockResolvedValue({ id: 'existing-draft' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldMutations(), { wrapper });

    await act(async () => {
      result.current.saveDraftMutation.mutate({
        draftId: 'existing-draft',
        sourceType: 'TEXT',
        sourceRef: 'ref1',
        status: 'REVIEW',
        pipelineState: {},
        draftPayload: { content: 'updated' },
      });
    });

    await vi.waitFor(() => expect(result.current.saveDraftMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.updateWorldDraft).toHaveBeenCalledWith('existing-draft', expect.any(Object));
    expect(mockWorldDataClient.createWorldDraft).not.toHaveBeenCalled();
  });

  it('deleteEventMutation calls deleteWorldEvent', async () => {
    mockWorldDataClient.deleteWorldEvent.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldMutations(), { wrapper });

    await act(async () => {
      result.current.deleteEventMutation.mutate({ worldId: 'w1', eventId: 'e1' });
    });

    await vi.waitFor(() => expect(result.current.deleteEventMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.deleteWorldEvent).toHaveBeenCalledWith('w1', 'e1');
  });

  it('saveMaintenanceMutation only forwards worldPatch metadata writes', async () => {
    mockWorldDataClient.updateWorldMaintenance.mockResolvedValue({ worldId: 'w1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldMutations(), { wrapper });

    await act(async () => {
      result.current.saveMaintenanceMutation.mutate({
        worldId: 'w1',
        worldPatch: { name: 'Realm' },
        reason: 'save',
        ifSnapshotVersion: 'snap-1',
      });
    });

    await vi.waitFor(() => expect(result.current.saveMaintenanceMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.updateWorldMaintenance).toHaveBeenCalledWith('w1', {
      worldPatch: { name: 'Realm' },
      reason: 'save',
      ifSnapshotVersion: 'snap-1',
    });
  });

  it('createWorldRuleMutation calls createWorldRule', async () => {
    mockWorldDataClient.createWorldRule.mockResolvedValue({ id: 'wr-1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldMutations(), { wrapper });

    await act(async () => {
      result.current.createWorldRuleMutation.mutate({
        worldId: 'w1',
        payload: { ruleKey: 'axiom:time:flow', title: 'Time flows', statement: 'Time flows forward.' },
      });
    });

    await vi.waitFor(() => expect(result.current.createWorldRuleMutation.isSuccess).toBe(true));
    expect(mockWorldDataClient.createWorldRule).toHaveBeenCalledWith('w1', {
      ruleKey: 'axiom:time:flow',
      title: 'Time flows',
      statement: 'Time flows forward.',
    });
  });

  it('archiveAgentRuleMutation calls archiveAgentRule', async () => {
    mockWorldDataClient.archiveAgentRule.mockResolvedValue({ id: 'ar-1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldMutations(), { wrapper });

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
