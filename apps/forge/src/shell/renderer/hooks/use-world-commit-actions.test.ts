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
  publishWorldPackage: vi.fn(),
  createOfficialFactoryBatchRun: vi.fn(),
  retryOfficialFactoryBatchRun: vi.fn(),
  reportOfficialFactoryBatchItemFailure: vi.fn(),
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
    expect(result.current).toHaveProperty('publishPackageMutation');
    expect(result.current).toHaveProperty('createBatchRunMutation');
    expect(result.current).toHaveProperty('reportBatchItemFailureMutation');
    expect(result.current).toHaveProperty('retryBatchRunMutation');
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

  it('publishPackageMutation calls publishWorldPackage', async () => {
    mockWorldDataClient.publishWorldPackage.mockResolvedValue({
      slug: 'realm',
      worldId: 'world-1',
      worldName: 'Realm',
      packageVersion: 'forge-ws-1',
      mode: 'upsert-sync',
      actionCount: 8,
      publishedBy: 'admin-1',
      release: {
        id: 'release-1',
        worldId: 'world-1',
        version: 1,
        releaseType: 'PUBLISH',
        status: 'PUBLISHED',
        ruleCount: 1,
        ruleChecksum: 'checksum-1',
        createdAt: '2026-04-09T21:40:00.000Z',
        createdBy: 'admin-1',
      },
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await expect(
      result.current.publishPackageMutation.mutateAsync({
        package: {
          slug: 'realm',
          meta: {
            sourceTitle: 'Realm',
            sourceMode: 'forge-official',
            generatedBy: 'world-agent-package-factory',
            version: 'forge-ws-1',
          },
          slicePolicy: {
            timeSlice: 'start-1',
            forbiddenTerms: [],
          },
          world: {
            id: 'world-1',
            creatorId: 'user-1',
            name: 'Realm',
            tagline: 'Tag',
            motto: null,
            overview: null,
            description: 'Desc',
            genre: 'fantasy',
            themes: ['fantasy'],
            era: null,
            contentRating: 'UNRATED',
            type: 'CREATOR',
            status: 'ACTIVE',
            nativeCreationState: 'OPEN',
            nativeAgentLimit: 0,
            transitInLimit: 16,
            lorebookEntryLimit: 0,
            level: 1,
            scoreQ: 0,
            scoreC: 0,
            scoreA: 0,
            scoreE: 0,
            scoreEwma: 0,
          },
          worldviewMetadata: {
            id: 'wv-1',
            worldId: 'world-1',
            version: 1,
            lifecycle: 'ACTIVE',
          },
          worldRules: [{
            ruleKey: 'axiom:time:flow',
            title: 'Time flows',
            statement: 'Time moves forward.',
            category: 'DEFINITION',
            domain: 'AXIOM',
            hardness: 'HARD',
            scope: 'WORLD',
          }],
          agentBlueprints: [],
          agentRelationships: [],
          scenes: [],
          worldLorebooks: [],
          agentLorebooks: [],
          resources: [],
          bindings: [],
          worldDrafts: [],
        },
        governance: {
          officialOwnerId: 'user-1',
          editorialOperatorId: 'user-1',
          reviewerId: 'user-1',
          publisherId: 'user-1',
          publishActorId: 'user-1',
          sourceProvenance: 'forge-text-source',
          reviewVerdict: 'approved',
        },
      }),
    ).resolves.toMatchObject({
      worldId: 'world-1',
    });

    expect(mockWorldDataClient.publishWorldPackage).toHaveBeenCalledWith(expect.objectContaining({
      package: expect.objectContaining({
        slug: 'realm',
      }),
    }));
  });

  it('createBatchRunMutation calls createOfficialFactoryBatchRun', async () => {
    mockWorldDataClient.createOfficialFactoryBatchRun.mockResolvedValue({
      id: 'run-1',
      name: 'Batch 1',
      requestedBy: 'admin-1',
      status: 'QUEUED',
      pipelineStages: ['ingest', 'validate'],
      retryLimit: 1,
      retryCount: 0,
      batchItemCount: 1,
      successCount: 0,
      failureCount: 0,
      createdAt: '2026-04-09T22:00:00.000Z',
      updatedAt: '2026-04-09T22:00:00.000Z',
      items: [],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await expect(
      result.current.createBatchRunMutation.mutateAsync({
        name: 'Batch 1',
        pipelineStages: ['ingest', 'validate'],
        items: [{ slug: 'realm', sourceTitle: 'Realm Source', canonicalTitle: 'Realm', sourceMode: 'forge-official' }],
      }),
    ).resolves.toMatchObject({
      id: 'run-1',
      status: 'QUEUED',
    });

    expect(mockWorldDataClient.createOfficialFactoryBatchRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Batch 1',
        pipelineStages: ['ingest', 'validate'],
      }),
    );
  });

  it('reportBatchItemFailureMutation calls reportOfficialFactoryBatchItemFailure', async () => {
    mockWorldDataClient.reportOfficialFactoryBatchItemFailure.mockResolvedValue({
      id: 'run-1',
      failureCount: 1,
      items: [],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await expect(
      result.current.reportBatchItemFailureMutation.mutateAsync({
        runId: 'run-1',
        itemId: 'item-1',
        payload: { reason: 'publish failed' },
      }),
    ).resolves.toMatchObject({
      id: 'run-1',
      failureCount: 1,
    });

    expect(mockWorldDataClient.reportOfficialFactoryBatchItemFailure).toHaveBeenCalledWith(
      'run-1',
      'item-1',
      { reason: 'publish failed' },
    );
  });

  it('retryBatchRunMutation calls retryOfficialFactoryBatchRun', async () => {
    mockWorldDataClient.retryOfficialFactoryBatchRun.mockResolvedValue({
      id: 'run-1',
      retryCount: 1,
      items: [],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useWorldCommitActions(), { wrapper });

    await expect(
      result.current.retryBatchRunMutation.mutateAsync({
        runId: 'run-1',
        reason: 'retry from create page',
      }),
    ).resolves.toMatchObject({
      id: 'run-1',
      retryCount: 1,
    });

    expect(mockWorldDataClient.retryOfficialFactoryBatchRun).toHaveBeenCalledWith(
      'run-1',
      { reason: 'retry from create page' },
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
          bindingKind: 'PRESENTATION',
          bindingPoint: 'WORLD_ICON',
          hostId: 'w1',
          hostType: 'WORLD',
          objectId: 'resource-icon-1',
          objectType: 'RESOURCE',
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
        bindingKind: 'PRESENTATION',
        bindingPoint: 'WORLD_ICON',
        hostId: 'w1',
        hostType: 'WORLD',
        objectId: 'resource-icon-1',
        objectType: 'RESOURCE',
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
