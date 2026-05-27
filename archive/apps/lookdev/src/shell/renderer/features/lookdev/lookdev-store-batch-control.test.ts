import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { generateLookdevItem } from './lookdev-processing.js';
import { useLookdevStore } from './lookdev-store.js';
import { createConfirmedWorldStylePack, createDefaultPolicySnapshot, type LookdevBatch, type LookdevCaptureState, type LookdevItem } from './types.js';
import { createWorldStyleSession } from './world-style-session.js';
import { getLookdevLegacyWorkspaceStorageKey, getLookdevWorkspaceStorageKeyForUser } from './lookdev-workspace-storage.js';

const generationTarget = {
  key: 'image.generate::cloud::image-connector::image-model::',
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'image-connector',
  connectorLabel: 'Image Connector',
  endpoint: 'https://image.example.com/v1',
  provider: 'openai',
  modelId: 'image-model',
  modelLabel: 'Image Model',
  capability: 'image.generate' as const,
};

const dialogueTarget = {
  key: 'text.generate::cloud::text-connector::text-model::',
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'text-connector',
  connectorLabel: 'Text Connector',
  endpoint: 'https://text.example.com/v1',
  provider: 'openai',
  modelId: 'text-model',
  modelLabel: 'Text Model',
  capability: 'text.generate' as const,
};

const evaluationTarget = {
  key: 'text.generate.vision::cloud::vision-connector::vision-model::',
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'vision-connector',
  connectorLabel: 'Vision Connector',
  endpoint: 'https://vision.example.com/v1',
  provider: 'openai',
  modelId: 'vision-model',
  modelLabel: 'Vision Model',
  capability: 'text.generate.vision' as const,
};

const mockRuntime = {
  media: {
    image: {
      generate: vi.fn(),
    },
  },
  ai: {
    text: {
      generate: vi.fn(),
    },
  },
};

const {
  getLookdevAgentAuthoringContext,
  getAgentPortraitBinding,
  createLookdevImageUpload,
  finalizeLookdevResource,
  upsertAgentPortraitBinding,
} = vi.hoisted(() => ({
  getLookdevAgentAuthoringContext: vi.fn(async () => ({
    detail: {
      description: 'Long coat, measured posture.',
      scenario: 'anchor',
      greeting: null,
    },
    truthBundle: null,
    fullTruthReadable: false,
  })),
  getAgentPortraitBinding: vi.fn(async () => null),
  createLookdevImageUpload: vi.fn(async () => ({
    uploadUrl: 'https://upload.example.com/resource-1',
    resourceId: 'resource-1',
  })),
  finalizeLookdevResource: vi.fn(async () => ({ id: 'resource-1' })),
  upsertAgentPortraitBinding: vi.fn(async () => ({})),
}));

vi.mock('@renderer/data/lookdev-data-client.js', () => ({
  getLookdevAgentAuthoringContext,
  getAgentPortraitBinding,
  createLookdevImageUpload,
  finalizeLookdevResource,
  upsertAgentPortraitBinding,
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: mockRuntime,
  }),
}));

describe('lookdev store batch control and workspace', () => {
  const worldId = 'w1';
  const worldStylePack = createConfirmedWorldStylePack(worldId, 'Aurora Harbor', 'en');

  function makeCaptureState(overrides: Partial<LookdevCaptureState> = {}): LookdevCaptureState {
    return {
      agentId: 'a1',
      worldId: 'w1',
      displayName: 'Iris',
      sourceConfidence: 'derived_from_agent_truth',
      captureMode: 'capture',
      synthesisMode: 'interactive',
      seedSignature: 'seed-a1',
      currentBrief: 'A steady harbor scout with a readable silhouette.',
      sourceSummary: 'Derived from Realm truth and the Aurora Harbor lane.',
      feelingAnchor: {
        coreVibe: 'steady vigilance',
        tonePhrases: ['salt-worn', 'clean'],
        avoidVibe: ['dramatic chaos'],
      },
      workingMemory: {
        effectiveIntentSummary: 'Keep the role readable and production-ready.',
        preserveFocus: ['clean silhouette'],
        adjustFocus: ['coat layering'],
        negativeConstraints: ['extreme close-up'],
      },
      visualIntent: {
        visualRole: 'Wind scout',
        silhouette: 'clean silhouette',
        outfit: 'long coat',
        hairstyle: 'shoulder-length hair',
        palettePrimary: 'teal',
        artStyle: worldStylePack.artStyle,
        mustKeepTraits: ['Long coat'],
        forbiddenTraits: ['extreme close-up'],
        detailBudget: 'hero',
        backgroundWeight: 'supporting',
      },
      messages: [],
      lastTextTraceId: 'trace-capture',
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeItem(overrides: Partial<LookdevItem> = {}): LookdevItem {
    return {
      itemId: 'i1',
      batchId: 'b1',
      agentId: 'a1',
      agentHandle: 'iris',
      agentDisplayName: 'Iris',
      agentConcept: 'Wind scout',
      agentDescription: 'Long coat, measured posture.',
      importance: 'PRIMARY',
      captureMode: 'capture',
      captureStateSnapshot: makeCaptureState(),
      portraitBrief: {
        agentId: 'a1',
        worldId: 'w1',
        displayName: 'Iris',
        visualRole: 'Wind scout',
        silhouette: 'clean silhouette',
        outfit: 'long coat',
        hairstyle: 'shoulder-length hair',
        palettePrimary: 'teal',
        artStyle: worldStylePack.artStyle,
        mustKeepTraits: ['Long coat'],
        forbiddenTraits: ['extreme close-up'],
        sourceConfidence: 'derived_from_agent_truth',
        updatedAt: '2026-03-28T00:00:00.000Z',
      },
      worldId: 'w1',
      status: 'pending',
      attemptCount: 0,
      currentImage: null,
      currentEvaluation: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      correctionHints: [],
      existingPortraitUrl: null,
      referenceImageUrl: null,
      committedAt: null,
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeBatch(overrides: Partial<LookdevBatch> = {}): LookdevBatch {
    const items = overrides.items ?? [makeItem()];
    return {
      batchId: 'b1',
      name: 'Store batch',
      status: 'paused',
      selectionSnapshot: {
        selectionSource: 'explicit_selection',
        agentIds: items.map((item) => item.agentId),
        captureSelectionAgentIds: items.filter((item) => item.captureMode === 'capture').map((item) => item.agentId),
        worldId: 'w1',
      },
      worldStylePackSnapshot: worldStylePack,
      policySnapshot: createDefaultPolicySnapshot({
        generationTarget,
        evaluationTarget,
      }),
      totalItems: items.length,
      captureSelectedItems: items.filter((item) => item.captureMode === 'capture').length,
      passedItems: 0,
      failedItems: 0,
      committedItems: 0,
      commitFailedItems: 0,
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      processingCompletedAt: null,
      commitCompletedAt: null,
      selectedItemId: items[0]?.itemId || null,
      auditTrail: [],
      items,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useLookdevStore.getState().clearHydratedWorkspace();
    useLookdevStore.getState().hydrateForUser('u1');
    useAppStore.setState({
      runtimeProbe: {
        realmConfigured: true,
        realmAuthenticated: true,
        textDefaultTargetKey: dialogueTarget.key,
        textConnectorId: dialogueTarget.connectorId,
        textModelId: dialogueTarget.modelId,
        imageDefaultTargetKey: 'image.generate::cloud::image-connector::image-model::',
        imageConnectorId: generationTarget.connectorId,
        imageModelId: generationTarget.modelId,
        visionDefaultTargetKey: 'text.generate.vision::cloud::vision-connector::vision-model::',
        visionConnectorId: evaluationTarget.connectorId,
        visionModelId: evaluationTarget.modelId,
        textTargets: [dialogueTarget],
        imageTargets: [generationTarget],
        visionTargets: [evaluationTarget],
        issues: [],
      },
    });
    mockRuntime.media.image.generate.mockResolvedValue({
      artifacts: [{
        uri: 'https://images.example.com/portrait.png',
        mimeType: 'image/png',
        artifactId: 'artifact-1',
      }],
      trace: { traceId: 'trace-1' },
    });
    mockRuntime.ai.text.generate.mockResolvedValue({
      text: JSON.stringify({
        passed: true,
        score: 88,
        checks: [
          { key: 'fullBody', passed: true },
          { key: 'fixedFocalLength', passed: true },
          { key: 'subjectClarity', passed: true },
          { key: 'stablePose', passed: true },
          { key: 'backgroundSubordinate', passed: true },
          { key: 'lowOcclusion', passed: true },
        ],
        summary: 'Good anchor portrait.',
        failureReasons: [],
      }),
      finishReason: 'stop',
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://images.example.com/')) {
        return new Response(Uint8Array.from([105, 109, 97, 103, 101]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response(null, { status: 200 });
    }));
  });

  it('updates the selected item in batch detail state', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        items: [
          makeItem({ itemId: 'i1', agentId: 'a1' }),
          makeItem({ itemId: 'i2', agentId: 'a2', agentDisplayName: 'Nora' }),
        ],
      })],
    });

    useLookdevStore.getState().selectItem('b1', 'i2');

    expect(useLookdevStore.getState().batches[0]?.selectedItemId).toBe('i2');
  });

  it('persists world style sessions alongside packs and briefs', () => {
    const session = createWorldStyleSession('w1', 'Aurora Harbor', 'en', [
      { displayName: 'Iris', concept: 'Anchor scout', importance: 'PRIMARY' },
    ]);
    useLookdevStore.getState().saveCaptureState(makeCaptureState());

    useLookdevStore.getState().saveWorldStyleSession(session);

    const persisted = localStorage.getItem(getLookdevWorkspaceStorageKeyForUser('u1'));
    expect(persisted).toContain('"worldStyleSessions"');
    expect(persisted).toContain('"captureStates"');
    expect(persisted).toContain('"Aurora Harbor"');
  });

  it('drops legacy persisted batches that do not carry capture-state snapshots', async () => {
    localStorage.clear();
    useLookdevStore.setState({
      batches: [],
      worldStyleSessions: {},
      worldStylePacks: {},
      portraitBriefs: {},
    });

    localStorage.setItem(getLookdevLegacyWorkspaceStorageKey(), JSON.stringify({
      state: {
        batches: [
          makeBatch({
            batchId: 'legacy-batch',
            name: 'test',
            items: [
              {
                ...makeItem(),
                itemId: 'legacy-item',
                captureStateSnapshot: undefined as unknown as LookdevItem['captureStateSnapshot'],
              },
            ],
          }),
          makeBatch({
            batchId: 'current-batch',
            name: 'test2',
          }),
        ],
        worldStyleSessions: {},
        worldStylePacks: {},
        captureStates: {},
        portraitBriefs: {},
      },
      version: 1,
    }));

    useLookdevStore.getState().hydrateForUser('u1');

    expect(useLookdevStore.getState().batches.map((batch) => batch.name)).toEqual(['test2']);
  });

  it('fails closed when generated artifacts omit mimeType', async () => {
    mockRuntime.media.image.generate.mockResolvedValueOnce({
      artifacts: [{
        uri: 'https://images.example.com/portrait.png',
        artifactId: 'artifact-missing-mime',
      }],
      trace: { traceId: 'trace-missing-mime' },
    });

    await expect(generateLookdevItem({
      runtime: mockRuntime as never,
      item: makeItem(),
      policy: createDefaultPolicySnapshot({
        generationTarget,
        evaluationTarget,
      }),
      worldStylePackSnapshot: worldStylePack,
    })).rejects.toThrow('LOOKDEV_IMAGE_MIME_TYPE_REQUIRED');
  });

  it('creates a batch when selected agents only have limited authoring detail', async () => {
    getLookdevAgentAuthoringContext.mockResolvedValueOnce({
      detail: {
        description: '',
        scenario: '',
        greeting: null,
      },
      truthBundle: null,
      fullTruthReadable: false,
    });

    for (const agent of [{ id: 'a1', worldId: 'w1', displayName: '接待员', concept: '接待员', importance: 'PRIMARY' }]) {
      useLookdevStore.getState().saveCaptureState(makeCaptureState({
        agentId: agent.id,
        worldId: agent.worldId,
        displayName: agent.displayName,
        captureMode: 'capture',
        synthesisMode: 'interactive',
        seedSignature: `${agent.worldId}::${agent.id}::capture`,
        currentBrief: `${agent.displayName} stays readable inside the ${worldStylePack.name} lane.`,
        visualIntent: {
          visualRole: agent.concept || agent.displayName,
          silhouette: 'clean silhouette',
          outfit: 'long coat',
          hairstyle: 'shoulder-length hair',
          palettePrimary: 'teal',
          artStyle: worldStylePack.artStyle,
          mustKeepTraits: [agent.concept || agent.displayName].filter(Boolean),
          forbiddenTraits: ['extreme close-up'],
          detailBudget: 'hero',
          backgroundWeight: 'supporting',
        },
      }));
    }

    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Limited truth batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a1'],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a1',
        handle: 'receptionist',
        displayName: '接待员',
        concept: '接待员',
        description: null,
        scenario: null,
        greeting: null,
        worldId,
        avatarUrl: null,
        currentPortrait: null,
        importance: 'PRIMARY',
        status: 'ACTIVE',
      }],
    });

    const batch = useLookdevStore.getState().batches.find((entry) => entry.batchId === batchId);
    expect(batch?.items[0]?.agentDisplayName).toBe('接待员');
    expect(batch?.items[0]?.agentConcept).toBe('接待员');
  });

  it('creates a batch when portrait binding lookup returns 400 for selected agents', async () => {
    getAgentPortraitBinding.mockRejectedValueOnce(new Error('400 Bad Request'));

    for (const agent of [{ id: 'a1', worldId: 'w1', displayName: '接待员', concept: '接待员', importance: 'PRIMARY' }]) {
      useLookdevStore.getState().saveCaptureState(makeCaptureState({
        agentId: agent.id,
        worldId: agent.worldId,
        displayName: agent.displayName,
        captureMode: 'capture',
        synthesisMode: 'interactive',
        seedSignature: `${agent.worldId}::${agent.id}::capture`,
        currentBrief: `${agent.displayName} stays readable inside the ${worldStylePack.name} lane.`,
        visualIntent: {
          visualRole: agent.concept || agent.displayName,
          silhouette: 'clean silhouette',
          outfit: 'long coat',
          hairstyle: 'shoulder-length hair',
          palettePrimary: 'teal',
          artStyle: worldStylePack.artStyle,
          mustKeepTraits: [agent.concept || agent.displayName].filter(Boolean),
          forbiddenTraits: ['extreme close-up'],
          detailBudget: 'hero',
          backgroundWeight: 'supporting',
        },
      }));
    }

    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Binding lookup failure batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a1'],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a1',
        handle: 'receptionist',
        displayName: '接待员',
        concept: '接待员',
        description: null,
        scenario: null,
        greeting: null,
        worldId,
        avatarUrl: null,
        currentPortrait: null,
        importance: 'PRIMARY',
        status: 'ACTIVE',
      }],
    });

    const batch = useLookdevStore.getState().batches.find((entry) => entry.batchId === batchId);
    expect(batch?.batchId).toBe(batchId);
    expect(batch?.items[0]?.existingPortraitUrl).toBeNull();
  });

  it('deletes a paused batch without deleting reusable working assets', () => {
    const captureState = makeCaptureState();
    const captureStateKey = `${worldId}::${captureState.agentId}`;
    const portraitBrief = {
      agentId: captureState.agentId,
      worldId: captureState.worldId,
      displayName: captureState.displayName,
      visualRole: captureState.visualIntent.visualRole,
      silhouette: captureState.visualIntent.silhouette,
      outfit: captureState.visualIntent.outfit,
      hairstyle: captureState.visualIntent.hairstyle,
      palettePrimary: captureState.visualIntent.palettePrimary,
      artStyle: captureState.visualIntent.artStyle,
      mustKeepTraits: captureState.visualIntent.mustKeepTraits,
      forbiddenTraits: captureState.visualIntent.forbiddenTraits,
      sourceConfidence: captureState.sourceConfidence,
      updatedAt: captureState.updatedAt,
    };
    useLookdevStore.setState({
      batches: [makeBatch({
        batchId: 'paused-batch',
        status: 'paused',
      })],
      worldStylePacks: {
        [worldId]: worldStylePack,
      },
      captureStates: {
        [captureStateKey]: captureState,
      },
      portraitBriefs: {
        [captureStateKey]: portraitBrief,
      },
    });

    useLookdevStore.getState().deleteBatch('paused-batch');

    expect(useLookdevStore.getState().batches).toEqual([]);
    expect(useLookdevStore.getState().worldStylePacks[worldId]).toEqual(worldStylePack);
    expect(useLookdevStore.getState().captureStates[captureStateKey]).toEqual(captureState);
    expect(useLookdevStore.getState().portraitBriefs[captureStateKey]).toEqual(portraitBrief);
  });

  it('fails closed when deleting a running batch', () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        batchId: 'running-batch',
        status: 'running',
      })],
    });

    expect(() => useLookdevStore.getState().deleteBatch('running-batch')).toThrow('LOOKDEV_BATCH_DELETE_RUNNING_FORBIDDEN');
    expect(useLookdevStore.getState().batches[0]?.batchId).toBe('running-batch');
  });
});
