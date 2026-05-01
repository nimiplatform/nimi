import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonicalPublishableWorldPackage } from '../../../../../../../packages/nimi-forge/src/contracts/index.js';

// Mock the platform client matching actual realm() access pattern
const mockWorldControlController = {
  worldControlControllerGetMyAccess: vi.fn(),
  worldControlControllerResolveLanding: vi.fn(),
  worldControlControllerCreateDraft: vi.fn(),
  worldControlControllerGetDraft: vi.fn(),
  worldControlControllerListDrafts: vi.fn(),
  worldControlControllerUpdateDraft: vi.fn(),
  worldControlControllerPublishDraft: vi.fn(),
  worldControlControllerGetState: vi.fn(),
  worldControlControllerCommitState: vi.fn(),
  worldControlControllerListMyWorlds: vi.fn(),
  worldControlControllerListWorldHistory: vi.fn(),
  worldControlControllerAppendWorldHistory: vi.fn(),
  worldControlControllerListWorldLorebooks: vi.fn(),
  worldControlControllerListWorldBindings: vi.fn(),
  worldControlControllerBatchUpsertWorldBindings: vi.fn(),
  worldControlControllerDeleteWorldBinding: vi.fn(),
};

const mockWorldsService = {
  worldControllerGetWorld: vi.fn(),
  worldControllerGetWorldview: vi.fn(),
};

const mockWorldRulesService = {
  worldRulesControllerGetRules: vi.fn(),
  worldRulesControllerCreateRule: vi.fn(),
  worldRulesControllerUpdateRule: vi.fn(),
  worldRulesControllerDeprecateRule: vi.fn(),
  worldRulesControllerArchiveRule: vi.fn(),
};

const mockAgentRulesService = {
  agentRulesControllerListRules: vi.fn(),
  agentRulesControllerCreateRule: vi.fn(),
  agentRulesControllerUpdateRule: vi.fn(),
  agentRulesControllerDeprecateRule: vi.fn(),
  agentRulesControllerArchiveRule: vi.fn(),
};

const mockCreatorService = {
  creatorControllerListAgents: vi.fn(),
  creatorControllerCreateAgent: vi.fn(),
  creatorControllerBatchCreateAgents: vi.fn(),
};

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    realm: {
      services: {
        WorldControlService: mockWorldControlController,
        WorldsService: mockWorldsService,
        WorldRulesService: mockWorldRulesService,
        AgentRulesService: mockAgentRulesService,
        CreatorService: mockCreatorService,
      },
    },
  }),
}));

vi.mock('@renderer/app-shell/providers/app-store.js', () => ({
  useAppStore: {
    getState: () => ({
      auth: {
        user: { id: 'user-1' },
        token: 'access-token-1',
      },
      runtimeDefaults: {
        realm: {
          realmBaseUrl: 'http://localhost:3002',
        },
      },
    }),
  },
}));

const wdc = await import('./world-data-client.js');

const buildDraftPayload = () => ({
  importSource: {
    sourceType: 'TEXT' as const,
    sourceRef: 'manual',
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
    worldState: {
      name: 'Realm',
      description: 'A realm',
    },
  },
  historyDraft: {
    events: {
      primary: [],
      secondary: [],
    },
  },
});

const buildCanonicalPackageFixture = (): CanonicalPublishableWorldPackage => ({
  slug: 'realm',
  meta: {
    sourceTitle: 'Realm',
    sourceMode: 'forge-official' as const,
    generatedBy: 'world-agent-package-factory' as const,
    version: 'forge-ws-1',
  },
  slicePolicy: {
    timeSlice: 'start-1',
    forbiddenTerms: [],
  },
  truth: {
    world: {
      record: {
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
        contentRating: 'UNRATED' as const,
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
        lifecycle: 'ACTIVE' as const,
      },
      rules: [{
        ruleKey: 'axiom:time:flow',
        title: 'Time flows',
        statement: 'Time moves forward.',
        category: 'DEFINITION' as const,
        domain: 'AXIOM' as const,
        hardness: 'HARD' as const,
        scope: 'WORLD' as const,
      }],
      scenes: [],
    },
    agents: {
      blueprints: [],
      relationships: [],
    },
  },
  derivation: {
    inheritanceCandidates: [],
    entryLine: ['official-package-publish'],
  },
  projection: {
    inputs: [{
      id: 'projection-world-1',
      sourceType: 'WORLD_RULE' as const,
      sourceRef: 'axiom:time:flow',
      governingTruthRef: 'world-rule:axiom:time:flow',
      surfaceEligibility: ['runtime', 'creator_inspection', 'public_read', 'compat'],
    }],
  },
  evidence: {
    sourceChunkIds: ['chunk-1'],
    truthBindings: [],
  },
  governance: {
    packageId: 'pkg-world-1',
    packageVersion: 'forge-ws-1',
    sourceTitle: 'Realm',
    sourceMode: 'forge-official' as const,
    generatedBy: 'world-agent-package-factory' as const,
    buildScope: 'forge-authoring' as const,
  },
  compat: {
    worldview: {},
    agentProfiles: [],
    worldLorebooks: [],
    agentLorebooks: [],
  },
  resources: [],
  bindings: [],
  worldDrafts: [],
});

const buildReleaseDto = (overrides: Record<string, unknown> = {}) => ({
  id: 'release-1',
  worldId: 'world-1',
  version: 1,
  tag: 'official-forge-ws-1',
  description: 'Official package publish',
  packageVersion: 'forge-ws-1',
  releaseType: 'PUBLISH',
  status: 'PUBLISHED',
  ruleCount: 1,
  ruleChecksum: 'checksum-1',
  worldviewChecksum: 'worldview-checksum-1',
  lorebookChecksum: null,
  sourceProvenance: 'forge-text-source',
  reviewVerdict: 'approved',
  officialOwnerId: 'user-1',
  editorialOperatorId: 'user-1',
  reviewerId: 'user-1',
  publisherId: 'user-1',
  publishActorId: 'user-1',
  supersedesReleaseId: null,
  rollbackFromReleaseId: null,
  diffSummary: {
    previousReleaseId: null,
    rollbackTargetReleaseId: null,
    worldRulesChanged: true,
    worldRuleDelta: 1,
    agentRuleSnapshotsChanged: false,
    agentRuleSnapshotDelta: 0,
    worldviewChanged: true,
    lorebookChanged: false,
    summaryText: 'Initial official publish',
  },
  frozenAt: '2026-04-09T21:40:00.000Z',
  publishedAt: '2026-04-09T21:40:00.000Z',
  createdAt: '2026-04-09T21:40:00.000Z',
  createdBy: 'admin-1',
  ...overrides,
});

describe('world-data-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('getMyWorldAccess normalizes hasActiveAccess from backend', async () => {
    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: true, canCreateWorld: true });
    const result = await wdc.getMyWorldAccess();
    expect(result).toEqual({
      hasAccess: true,
      canCreateWorld: true,
      canMaintainWorld: false,
      records: [],
    });
  });

  it('getMyWorldAccess normalizes hasActiveAccess false', async () => {
    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: false });
    const result = await wdc.getMyWorldAccess();
    expect(result).toEqual({
      hasAccess: false,
      canCreateWorld: false,
      canMaintainWorld: false,
      records: [],
    });
  });

  it('getMyWorldAccess rejects legacy or invalid contract shapes', async () => {
    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue('unexpected');
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasAccess: true });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasCreatorAccess: true });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: 'true' });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: 1 });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: {} });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');
  });

  it('resolveWorldLanding', async () => {
    mockWorldControlController.worldControlControllerResolveLanding.mockResolvedValue({ target: 'CREATE' });
    await expect(wdc.resolveWorldLanding()).resolves.toEqual({
      target: 'CREATE',
      worldId: null,
      reason: undefined,
    });
    expect(mockWorldControlController.worldControlControllerResolveLanding).toHaveBeenCalledOnce();
  });

  it('createWorldDraft passes payload', async () => {
    const body = {
      sourceType: 'TEXT' as const,
      sourceRef: 'manual',
      draftPayload: buildDraftPayload(),
    };
    await wdc.createWorldDraft(body);
    expect(mockWorldControlController.worldControlControllerCreateDraft).toHaveBeenCalledWith(body);
  });

  it('createWorldDraft forwards explicit future historical events', async () => {
    await wdc.createWorldDraft({
      sourceType: 'TEXT',
      sourceRef: 'manual',
      draftPayload: {
        ...buildDraftPayload(),
        historyDraft: {
          events: {
            primary: [],
            secondary: [],
            futureHistorical: [{ eventType: 'world.future', title: 'Future', happenedAt: '2026-03-24T00:00:00.000Z' }],
          },
        },
      },
    });

    expect(mockWorldControlController.worldControlControllerCreateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draftPayload: expect.objectContaining({
          historyDraft: expect.objectContaining({
            events: expect.objectContaining({
              futureHistorical: [
                expect.objectContaining({
                  eventType: 'world.future',
                  title: 'Future',
                  happenedAt: '2026-03-24T00:00:00.000Z',
                }),
              ],
            }),
          }),
        }),
      }),
    );
  });

  it('getWorldDraft passes draftId', async () => {
    await wdc.getWorldDraft('d1');
    expect(mockWorldControlController.worldControlControllerGetDraft).toHaveBeenCalledWith('d1');
  });

  it('listWorldDrafts', async () => {
    mockWorldControlController.worldControlControllerListDrafts.mockResolvedValue({ items: [] });
    const result = await wdc.listWorldDrafts();
    expect(result).toEqual({ items: [] });
  });

  it('updateWorldDraft passes draftId and patch', async () => {
    await wdc.updateWorldDraft('d1', { status: 'REVIEW' });
    expect(mockWorldControlController.worldControlControllerUpdateDraft).toHaveBeenCalledWith('d1', { status: 'REVIEW' });
  });

  it('publishWorldDraft passes draftId and empty payload', async () => {
    await wdc.publishWorldDraft('d1');
    expect(mockWorldControlController.worldControlControllerPublishDraft).toHaveBeenCalledWith('d1', {});
  });

  it('publishWorldPackage sends bearer-authenticated admin publish request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        slug: 'realm',
        worldId: 'world-1',
        worldName: 'Realm',
        packageVersion: 'forge-ws-1',
        mode: 'upsert-sync',
        actionCount: 8,
        publishedBy: 'admin-1',
        release: buildReleaseDto(),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      wdc.publishWorldPackage({
        package: buildCanonicalPackageFixture(),
        governance: {
          officialOwnerId: 'user-1',
          editorialOperatorId: 'user-1',
          reviewerId: 'user-1',
          publisherId: 'user-1',
          publishActorId: 'user-1',
          sourceProvenance: 'forge-text-source',
          reviewVerdict: 'approved',
          releaseTag: 'official-forge-ws-1',
          releaseSummary: 'Official package publish',
          changeSummary: 'Initial official publish',
        },
      }),
    ).resolves.toMatchObject({
      worldId: 'world-1',
      release: expect.objectContaining({
        id: 'release-1',
        version: 1,
        status: 'PUBLISHED',
      }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/api/admin/worlds/packages/publish',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-1',
        }),
      }),
    );
  });

  it('publishWorldPackage fails close on non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'Invalid forge package payload' }),
    }));

    await expect(
      wdc.publishWorldPackage({
        package: buildCanonicalPackageFixture(),
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
    ).rejects.toThrow('Invalid forge package payload');
  });

  it('listWorldReleases normalizes governed release history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([
        buildReleaseDto(),
        buildReleaseDto({
          id: 'release-2',
          version: 2,
          releaseType: 'ROLLBACK',
          sourceProvenance: 'release-rollback',
          rollbackFromReleaseId: 'release-1',
        }),
      ]),
    }));

    await expect(wdc.listWorldReleases('world-1')).resolves.toMatchObject([
      expect.objectContaining({ id: 'release-1', releaseType: 'PUBLISH' }),
      expect.objectContaining({ id: 'release-2', releaseType: 'ROLLBACK', rollbackFromReleaseId: 'release-1' }),
    ]);
  });

  it('rollbackWorldRelease posts governance payload and returns the new release', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        worldId: 'world-1',
        rollbackTargetReleaseId: 'release-1',
        release: buildReleaseDto({
          id: 'release-2',
          version: 2,
          tag: 'rollback-v1',
          releaseType: 'ROLLBACK',
          sourceProvenance: 'release-rollback',
          rollbackFromReleaseId: 'release-1',
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(wdc.rollbackWorldRelease('world-1', 'release-1', {
      governance: {
        officialOwnerId: 'user-1',
        editorialOperatorId: 'user-1',
        reviewerId: 'user-1',
        publisherId: 'user-1',
        publishActorId: 'user-1',
        sourceProvenance: 'release-rollback',
        reviewVerdict: 'approved',
      },
    })).resolves.toMatchObject({
      worldId: 'world-1',
      rollbackTargetReleaseId: 'release-1',
      release: expect.objectContaining({ id: 'release-2', releaseType: 'ROLLBACK' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/api/admin/worlds/world-1/releases/release-1/rollback',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-1',
        }),
      }),
    );
  });

  it('listWorldTitleLineage normalizes tracked title lineage rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([
        {
          id: 'lineage-1',
          worldId: 'world-1',
          slug: 'realm',
          sourceTitle: 'Realm Source',
          canonicalTitle: 'Realm',
          titleLineageKey: 'realm:realm',
          packageVersion: 'forge-ws-1',
          releaseId: 'release-1',
          runId: 'run-1',
          itemId: 'item-1',
          recordedBy: 'admin-1',
          reason: 'Initial official publish',
          createdAt: '2026-04-09T21:40:00.000Z',
        },
      ]),
    }));

    await expect(wdc.listWorldTitleLineage('world-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'lineage-1',
        canonicalTitle: 'Realm',
        packageVersion: 'forge-ws-1',
      }),
    ]);
  });

  it('listOfficialFactoryBatchRuns normalizes tracked operations state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([
        {
          id: 'run-1',
          name: 'Official Batch',
          requestKey: 'request-1',
          requestedBy: 'admin-1',
          status: 'RUNNING',
          pipelineStages: ['ingest', 'validate', 'publish'],
          retryLimit: 2,
          retryCount: 1,
          batchItemCount: 1,
          successCount: 0,
          failureCount: 0,
          qualityGateStatus: 'WARN',
          qualityGateSummary: {
            status: 'WARN',
            score: 0.86,
            findingCount: 1,
            findings: ['missing-cover'],
          },
          lastError: null,
          lastReleaseId: null,
          executionNotes: 'In progress',
          startedAt: '2026-04-09T22:00:00.000Z',
          finishedAt: null,
          createdAt: '2026-04-09T22:00:00.000Z',
          updatedAt: '2026-04-09T22:10:00.000Z',
          items: [
            {
              id: 'item-1',
              runId: 'run-1',
              worldId: 'world-1',
              slug: 'realm',
              sourceTitle: 'Realm Source',
              canonicalTitle: 'Realm',
              titleLineageKey: 'realm:realm',
              sourceMode: 'forge-official',
              status: 'RUNNING',
              packageVersion: 'forge-ws-1',
              releaseId: null,
              releaseVersion: null,
              qualityGateStatus: 'WARN',
              qualityGateSummary: {
                status: 'WARN',
                findingCount: 1,
                findings: ['missing-cover'],
              },
              retryCount: 1,
              lastError: null,
              startedAt: '2026-04-09T22:00:00.000Z',
              finishedAt: null,
              createdAt: '2026-04-09T22:00:00.000Z',
              updatedAt: '2026-04-09T22:10:00.000Z',
            },
          ],
        },
      ]),
    }));

    await expect(wdc.listOfficialFactoryBatchRuns()).resolves.toEqual([
      expect.objectContaining({
        id: 'run-1',
        status: 'RUNNING',
        items: [
          expect.objectContaining({
            id: 'item-1',
            titleLineageKey: 'realm:realm',
            qualityGateStatus: 'WARN',
          }),
        ],
      }),
    ]);
  });

  it('createOfficialFactoryBatchRun posts canonical batch run input', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        id: 'run-1',
        name: 'Official Batch',
        requestKey: 'request-1',
        requestedBy: 'admin-1',
        status: 'QUEUED',
        pipelineStages: ['ingest', 'validate'],
        retryLimit: 2,
        retryCount: 0,
        batchItemCount: 1,
        successCount: 0,
        failureCount: 0,
        qualityGateStatus: 'PASS',
        qualityGateSummary: { status: 'PASS', findingCount: 0, findings: [] },
        lastError: null,
        lastReleaseId: null,
        executionNotes: 'Queued',
        startedAt: null,
        finishedAt: null,
        createdAt: '2026-04-09T22:00:00.000Z',
        updatedAt: '2026-04-09T22:00:00.000Z',
        items: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      wdc.createOfficialFactoryBatchRun({
        name: 'Official Batch',
        requestKey: 'request-1',
        pipelineStages: ['ingest', 'validate'],
        retryLimit: 2,
        items: [{ slug: 'realm', sourceTitle: 'Realm Source', canonicalTitle: 'Realm', sourceMode: 'forge-official' }],
      }),
    ).resolves.toMatchObject({
      id: 'run-1',
      status: 'QUEUED',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/api/admin/worlds/operations/batch-runs',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('reportOfficialFactoryBatchItemFailure posts failure details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        id: 'run-1',
        name: 'Official Batch',
        requestKey: 'request-1',
        requestedBy: 'admin-1',
        status: 'FAILED',
        pipelineStages: ['validate'],
        retryLimit: 2,
        retryCount: 0,
        batchItemCount: 1,
        successCount: 0,
        failureCount: 1,
        qualityGateStatus: 'FAIL',
        qualityGateSummary: { status: 'FAIL', findingCount: 1, findings: ['contract-mismatch'] },
        lastError: 'publish failed',
        lastReleaseId: null,
        executionNotes: 'Failed',
        startedAt: '2026-04-09T22:00:00.000Z',
        finishedAt: '2026-04-09T22:01:00.000Z',
        createdAt: '2026-04-09T22:00:00.000Z',
        updatedAt: '2026-04-09T22:01:00.000Z',
        items: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      wdc.reportOfficialFactoryBatchItemFailure('run-1', 'item-1', {
        reason: 'publish failed',
        qualityGate: { status: 'FAIL', findingCount: 1, findings: ['contract-mismatch'] },
      }),
    ).resolves.toMatchObject({
      id: 'run-1',
      status: 'FAILED',
      failureCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/api/admin/worlds/operations/batch-runs/run-1/items/item-1/fail',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

});
