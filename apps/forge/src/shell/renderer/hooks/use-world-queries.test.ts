import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockWorldDataClient = vi.hoisted(() => ({
  listMyWorlds: vi.fn(),
  listWorldDrafts: vi.fn(),
  listWorldEvents: vi.fn(),
  getWorldMaintenance: vi.fn(),
  listWorldLorebooks: vi.fn(),
  listWorldMediaBindings: vi.fn(),
  listWorldMutations: vi.fn(),
}));

vi.mock('@renderer/data/world-data-client.js', () => mockWorldDataClient);

import { useWorldResourceQueries } from './use-world-queries.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useWorldResourceQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all expected query objects', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: false, worldId: '' }),
      { wrapper },
    );

    expect(result.current).toHaveProperty('draftsQuery');
    expect(result.current).toHaveProperty('worldsQuery');
    expect(result.current).toHaveProperty('maintenanceQuery');
    expect(result.current).toHaveProperty('eventsQuery');
    expect(result.current).toHaveProperty('lorebooksQuery');
    expect(result.current).toHaveProperty('mutationsQuery');
    expect(result.current).toHaveProperty('mediaBindingsQuery');
  });

  it('when enabled=false, queries do not fetch', async () => {
    const wrapper = createWrapper();
    renderHook(
      () => useWorldResourceQueries({ enabled: false, worldId: 'w1' }),
      { wrapper },
    );

    // Give queries a tick to potentially fire
    await new Promise((r) => setTimeout(r, 50));

    expect(mockWorldDataClient.listWorldDrafts).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listMyWorlds).not.toHaveBeenCalled();
    expect(mockWorldDataClient.getWorldMaintenance).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldEvents).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldLorebooks).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldMutations).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldMediaBindings).not.toHaveBeenCalled();
  });

  it('draftsQuery normalizes { items: [...] } payload via toDraftSummaryList', async () => {
    mockWorldDataClient.listWorldDrafts.mockResolvedValue({
      items: [
        {
          id: 'd1',
          targetWorldId: 'w1',
          status: 'DRAFT',
          sourceType: 'TEXT',
          sourceRef: null,
          updatedAt: '2026-01-01T00:00:00Z',
          publishedAt: null,
        },
      ],
    });
    mockWorldDataClient.listMyWorlds.mockResolvedValue({ items: [] });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: true, worldId: '', enableCollections: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.draftsQuery.isSuccess).toBe(true));

    const drafts = result.current.draftsQuery.data;
    expect(drafts).toHaveLength(1);
    expect(drafts![0]).toMatchObject({
      id: 'd1',
      targetWorldId: 'w1',
      status: 'DRAFT',
      sourceType: 'TEXT',
    });
  });

  it('worldsQuery normalizes world summaries', async () => {
    mockWorldDataClient.listMyWorlds.mockResolvedValue({
      items: [
        { id: 'w1', name: 'My World', status: 'ACTIVE', description: 'A test world', updatedAt: '2026-01-01' },
        { id: 'w2', name: 'Another', status: 'DRAFT', description: null, updatedAt: '2026-02-01' },
      ],
    });
    mockWorldDataClient.listWorldDrafts.mockResolvedValue({ items: [] });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: true, worldId: '', enableCollections: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.worldsQuery.isSuccess).toBe(true));

    const worlds = result.current.worldsQuery.data;
    expect(worlds).toHaveLength(2);
    expect(worlds![0]).toMatchObject({ id: 'w1', name: 'My World', status: 'ACTIVE' });
  });

  it('eventsQuery normalizes event summaries with timeline fields', async () => {
    mockWorldDataClient.listWorldEvents.mockResolvedValue({
      items: [
        {
          id: 'e1',
          worldId: 'w1',
          timelineSeq: 1,
          level: 'PRIMARY',
          eventHorizon: 'PAST',
          parentEventId: null,
          title: 'The Great War',
          summary: 'A major conflict',
          cause: null,
          process: null,
          result: null,
          timeRef: null,
          locationRefs: ['loc1'],
          characterRefs: [],
          dependsOnEventIds: [],
          evidenceRefs: [],
          confidence: 0.8,
          needsEvidence: false,
          createdBy: 'user1',
          updatedBy: 'user1',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: true, worldId: 'w1' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.eventsQuery.isSuccess).toBe(true));

    const events = result.current.eventsQuery.data;
    expect(events).toHaveLength(1);
    expect(events![0]).toMatchObject({
      id: 'e1',
      title: 'The Great War',
      timelineSeq: 1,
      level: 'PRIMARY',
      locationRefs: ['loc1'],
    });
  });
});
