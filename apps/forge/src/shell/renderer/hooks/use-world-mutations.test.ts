import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockWorldDataClient = vi.hoisted(() => ({
  createWorldDraft: vi.fn(),
  updateWorldDraft: vi.fn(),
  publishWorldDraft: vi.fn(),
  updateWorldMaintenance: vi.fn(),
  batchUpsertWorldEvents: vi.fn(),
  batchUpsertWorldLorebooks: vi.fn(),
  batchUpsertWorldVisualBindings: vi.fn(),
  deleteWorldEvent: vi.fn(),
  deleteWorldLorebook: vi.fn(),
  batchCreateCreatorAgents: vi.fn(),
  listMyWorlds: vi.fn(),
  listWorldDrafts: vi.fn(),
  listWorldEvents: vi.fn(),
  getWorldMaintenance: vi.fn(),
  listWorldLorebooks: vi.fn(),
  listWorldVisualBindings: vi.fn(),
  listWorldMutations: vi.fn(),
  getMyWorldAccess: vi.fn(),
  resolveWorldLanding: vi.fn(),
  getWorldDraft: vi.fn(),
  deleteWorldVisualBinding: vi.fn(),
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
    expect(result.current).toHaveProperty('syncLorebooksMutation');
    expect(result.current).toHaveProperty('syncEventsMutation');
    expect(result.current).toHaveProperty('syncVisualBindingsMutation');
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
});
