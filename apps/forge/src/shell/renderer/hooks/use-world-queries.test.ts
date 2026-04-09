import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockWorldDataClient = vi.hoisted(() => ({
  listOfficialFactoryBatchRuns: vi.fn(),
  listMyWorlds: vi.fn(),
  listWorldDrafts: vi.fn(),
  listWorldHistory: vi.fn(),
  listWorldReleases: vi.fn(),
  getWorldState: vi.fn(),
  listWorldLorebooks: vi.fn(),
  listWorldResourceBindings: vi.fn(),
  listWorldTitleLineage: vi.fn(),
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
    mockWorldDataClient.getWorldState.mockResolvedValue({ worldId: 'w1', version: 'state-v1', items: [] });
    mockWorldDataClient.listWorldLorebooks.mockResolvedValue({ worldId: 'w1', items: [] });
    mockWorldDataClient.listWorldResourceBindings.mockResolvedValue({ worldId: 'w1', items: [] });
    mockWorldDataClient.listWorldHistory.mockResolvedValue({ worldId: 'w1', version: 'history-v1', items: [] });
    mockWorldDataClient.listWorldReleases.mockResolvedValue([]);
    mockWorldDataClient.listWorldTitleLineage.mockResolvedValue([]);
    mockWorldDataClient.listOfficialFactoryBatchRuns.mockResolvedValue([]);
  });

  it('returns all expected query objects', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: false, worldId: '' }),
      { wrapper },
    );

    expect(result.current).toHaveProperty('draftsQuery');
    expect(result.current).toHaveProperty('worldsQuery');
    expect(result.current).toHaveProperty('stateQuery');
    expect(result.current).toHaveProperty('historyQuery');
    expect(result.current).toHaveProperty('maintenanceTimeline');
    expect(result.current).toHaveProperty('lorebooksQuery');
    expect(result.current).toHaveProperty('resourceBindingsQuery');
    expect(result.current).toHaveProperty('releasesQuery');
    expect(result.current).toHaveProperty('titleLineageQuery');
    expect(result.current).toHaveProperty('batchRunsQuery');
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
    expect(mockWorldDataClient.getWorldState).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldHistory).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldLorebooks).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldResourceBindings).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldReleases).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listWorldTitleLineage).not.toHaveBeenCalled();
    expect(mockWorldDataClient.listOfficialFactoryBatchRuns).not.toHaveBeenCalled();
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

  it('historyQuery normalizes history summaries with timeline fields', async () => {
    mockWorldDataClient.listWorldHistory.mockResolvedValue({
      worldId: 'w1',
      version: 'history-v1',
      items: [
        {
          id: 'e1',
          eventId: 'evt-1',
          worldId: 'w1',
          title: 'The Great War',
          happenedAt: '2026-01-01T00:00:00Z',
          eventType: 'PRIMARY_PAST',
          summary: 'A major conflict',
          cause: null,
          process: null,
          result: null,
          timeRef: null,
          locationRefs: ['loc1'],
          characterRefs: [],
          dependsOnEventIds: [],
          evidenceRefs: [],
          payload: {
            timelineSeq: 1,
            level: 'PRIMARY',
            eventHorizon: 'PAST',
            parentEventId: null,
            confidence: 0.8,
            needsEvidence: false,
          },
          createdBy: 'user1',
          committedAt: '2026-01-01',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: true, worldId: 'w1' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.historyQuery.isSuccess).toBe(true));

    const history = result.current.historyQuery.data;
    expect(history).toHaveLength(1);
    expect(history![0]).toMatchObject({
      id: 'evt-1',
      title: 'The Great War',
      timelineSeq: 1,
      level: 'PRIMARY',
      locationRefs: ['loc1'],
    });
  });

  it('maintenanceTimeline derives entries from state records and history events', async () => {
    mockWorldDataClient.getWorldState.mockResolvedValue({
      worldId: 'w1',
      version: 'state-v1',
      items: [
        {
          id: 'state-1',
          worldId: 'w1',
          targetPath: 'forge.workspace.world',
          metadata: { reason: 'manual save' },
          createdBy: 'user-1',
          committedAt: '2026-02-02T00:00:00Z',
        },
      ],
    });
    mockWorldDataClient.listWorldHistory.mockResolvedValue({
      worldId: 'w1',
      version: 'history-v1',
      items: [
        {
          id: 'event-row-1',
          eventId: 'evt-1',
          worldId: 'w1',
          title: 'Founding',
          happenedAt: '2026-01-01T00:00:00Z',
          eventType: 'WORLD_EVENT',
          summary: 'The realm begins',
          cause: null,
          process: null,
          result: null,
          timeRef: null,
          locationRefs: [],
          characterRefs: [],
          dependsOnEventIds: [],
          evidenceRefs: [],
          payload: {},
          createdBy: 'user-1',
          committedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: true, worldId: 'w1' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.historyQuery.isSuccess).toBe(true));

    expect(result.current.maintenanceTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'state-1',
          mutationType: 'SETTING_CHANGE',
          targetPath: 'forge.workspace.world',
        }),
        expect.objectContaining({
          id: 'evt-1',
          mutationType: 'EVENT_BATCH_UPSERT',
          title: 'Founding',
        }),
      ]),
    );
  });

  it('releasesQuery and titleLineageQuery expose sorted governed surfaces', async () => {
    mockWorldDataClient.listWorldReleases.mockResolvedValue([
      {
        id: 'release-1',
        worldId: 'w1',
        version: 1,
        releaseType: 'PUBLISH',
        status: 'PUBLISHED',
        ruleCount: 1,
        ruleChecksum: 'checksum-1',
        createdAt: '2026-04-09T00:00:00Z',
        createdBy: 'admin-1',
      },
      {
        id: 'release-2',
        worldId: 'w1',
        version: 2,
        releaseType: 'ROLLBACK',
        status: 'PUBLISHED',
        ruleCount: 1,
        ruleChecksum: 'checksum-2',
        createdAt: '2026-04-10T00:00:00Z',
        createdBy: 'admin-1',
      },
    ]);
    mockWorldDataClient.listWorldTitleLineage.mockResolvedValue([
      {
        id: 'lineage-1',
        worldId: 'w1',
        slug: 'realm',
        sourceTitle: 'Realm Source',
        canonicalTitle: 'Realm',
        titleLineageKey: 'realm:realm',
        packageVersion: 'forge-ws-1',
        releaseId: 'release-1',
        runId: 'run-1',
        itemId: 'item-1',
        recordedBy: 'admin-1',
        reason: 'Older',
        createdAt: '2026-04-09T00:00:00Z',
      },
      {
        id: 'lineage-2',
        worldId: 'w1',
        slug: 'realm',
        sourceTitle: 'Realm Source',
        canonicalTitle: 'Realm',
        titleLineageKey: 'realm:realm',
        packageVersion: 'forge-ws-2',
        releaseId: 'release-2',
        runId: 'run-2',
        itemId: 'item-2',
        recordedBy: 'admin-1',
        reason: 'Newer',
        createdAt: '2026-04-10T00:00:00Z',
      },
    ]);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: true, worldId: 'w1' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.releasesQuery.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.titleLineageQuery.isSuccess).toBe(true));

    expect(result.current.releasesQuery.data?.map((item) => item.id)).toEqual(['release-2', 'release-1']);
    expect(result.current.titleLineageQuery.data?.map((item) => item.id)).toEqual(['lineage-2', 'lineage-1']);
  });

  it('batchRunsQuery exposes sorted official factory runs', async () => {
    mockWorldDataClient.listOfficialFactoryBatchRuns.mockResolvedValue([
      {
        id: 'run-1',
        name: 'Older Run',
        requestedBy: 'admin-1',
        status: 'FAILED',
        pipelineStages: ['validate'],
        retryLimit: 1,
        retryCount: 0,
        batchItemCount: 1,
        successCount: 0,
        failureCount: 1,
        createdAt: '2026-04-09T00:00:00Z',
        updatedAt: '2026-04-09T00:00:00Z',
        items: [],
      },
      {
        id: 'run-2',
        name: 'Newer Run',
        requestedBy: 'admin-1',
        status: 'SUCCEEDED',
        pipelineStages: ['validate'],
        retryLimit: 1,
        retryCount: 0,
        batchItemCount: 1,
        successCount: 1,
        failureCount: 0,
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
        items: [],
      },
    ]);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useWorldResourceQueries({ enabled: true, worldId: 'w1' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.batchRunsQuery.isSuccess).toBe(true));

    expect(result.current.batchRunsQuery.data?.map((item) => item.id)).toEqual(['run-2', 'run-1']);
  });
});
