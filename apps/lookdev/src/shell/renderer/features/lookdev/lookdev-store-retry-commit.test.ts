import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { evaluateLookdevImage, generateLookdevItem } from './lookdev-processing.js';
import { useLookdevStore } from './lookdev-store.js';
import { createConfirmedWorldStylePack, createDefaultPolicySnapshot, type LookdevAuditEvent, type LookdevBatch, type LookdevCaptureState, type LookdevItem } from './types.js';
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

const geminiGenerationTarget = {
  key: 'image.generate::cloud::sys-cloud-gemini::gemini-3.1-flash-image-preview::',
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'sys-cloud-gemini',
  connectorLabel: 'Cloud Gemini',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  provider: 'gemini',
  modelId: 'gemini-3.1-flash-image-preview',
  modelLabel: 'Gemini 3.1 Flash Image Preview',
  capability: 'image.generate' as const,
};

const openAICompatibleGeminiGenerationTarget = {
  key: 'image.generate::cloud::api-connector::models/gemini-3.1-flash-image-preview::',
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'api-connector',
  connectorLabel: 'API Connector',
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  provider: 'openai-compatible:models/gemini-3-flash-preview',
  modelId: 'models/gemini-3.1-flash-image-preview',
  modelLabel: 'gemini-3.1-flash-image-preview',
  capability: 'image.generate' as const,
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

describe('lookdev store', () => {
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

  async function createBatchWithCaptureStates(
    input: Parameters<ReturnType<typeof useLookdevStore.getState>['createBatch']>[0],
    options?: { waitForCompletion?: boolean },
  ) {
    for (const agent of input.agents) {
      useLookdevStore.getState().saveCaptureState(makeCaptureState({
        agentId: agent.id,
        worldId: agent.worldId,
        displayName: agent.displayName,
        captureMode: input.captureSelectionAgentIds.includes(agent.id) ? 'capture' : 'batch_only',
        synthesisMode: input.captureSelectionAgentIds.includes(agent.id) ? 'interactive' : 'silent',
        seedSignature: `${agent.worldId || 'unscoped'}::${agent.id}::${input.captureSelectionAgentIds.includes(agent.id) ? 'capture' : 'batch_only'}`,
        currentBrief: `${agent.displayName} stays readable inside the ${worldStylePack.name} lane.`,
        visualIntent: {
          visualRole: agent.concept || agent.displayName,
          silhouette: 'clean silhouette',
          outfit: agent.description || 'long coat',
          hairstyle: 'shoulder-length hair',
          palettePrimary: 'teal',
          artStyle: worldStylePack.artStyle,
          mustKeepTraits: [agent.concept || agent.displayName].filter(Boolean),
          forbiddenTraits: ['extreme close-up'],
          detailBudget: input.captureSelectionAgentIds.includes(agent.id) ? 'hero' : 'standard',
          backgroundWeight: agent.importance === 'BACKGROUND' ? 'minimal' : 'supporting',
        },
      }));
    }
    const batchId = await useLookdevStore.getState().createBatch(input);
    if (options?.waitForCompletion !== false) {
      await waitForBatchStatus(batchId, 'processing_complete');
    }
    return batchId;
  }

  async function waitForBatchStatus(batchId: string, status: LookdevBatch['status']) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const batch = useLookdevStore.getState().batches.find((entry) => entry.batchId === batchId);
      if (batch?.status === status) {
        return batch;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for batch ${batchId} to reach ${status}`);
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

  function expectAuditEvent(
    auditTrail: LookdevAuditEvent[] | undefined,
    matcher: Partial<LookdevAuditEvent>,
  ) {
    expect(auditTrail?.some((event) => Object.entries(matcher).every(([key, value]) => event[key as keyof LookdevAuditEvent] === value))).toBe(true);
  }

  it('uses automatic retry budget before exhausting the item', async () => {
    mockRuntime.ai.text.generate
      .mockResolvedValueOnce({
        text: JSON.stringify({
          passed: false,
          score: 61,
          checks: [
            { key: 'fullBody', passed: false },
            { key: 'fixedFocalLength', passed: true },
            { key: 'subjectClarity', passed: true },
            { key: 'stablePose', passed: true },
            { key: 'backgroundSubordinate', passed: true },
            { key: 'lowOcclusion', passed: true },
          ],
          summary: 'Too cropped.',
          failureReasons: ['Keep the full body visible.'],
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          passed: false,
          score: 70,
          checks: [
            { key: 'fullBody', passed: true },
            { key: 'fixedFocalLength', passed: false },
            { key: 'subjectClarity', passed: true },
            { key: 'stablePose', passed: true },
            { key: 'backgroundSubordinate', passed: true },
            { key: 'lowOcclusion', passed: true },
          ],
          summary: 'Lens still feels too wide.',
          failureReasons: ['Reduce perspective distortion.'],
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          passed: true,
          score: 82,
          checks: [
            { key: 'fullBody', passed: true },
            { key: 'fixedFocalLength', passed: true },
            { key: 'subjectClarity', passed: true },
            { key: 'stablePose', passed: true },
            { key: 'backgroundSubordinate', passed: true },
            { key: 'lowOcclusion', passed: true },
          ],
          summary: 'Third pass is acceptable.',
          failureReasons: [],
        }),
      });

    const batchId = await createBatchWithCaptureStates({
      name: 'Retry batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: [],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a3',
        handle: 'lena',
        displayName: 'Lena',
        concept: 'Signal operator',
        description: null,
        scenario: null,
        greeting: null,
        worldId: 'w1',
        avatarUrl: null,
        currentPortrait: null,
        importance: 'SECONDARY',
        status: 'READY',
      }],
    });

    const batch = useLookdevStore.getState().batches.find((entry) => entry.batchId === batchId);
    expect(batch?.items[0]?.attemptCount).toBe(3);
    expect(batch?.items[0]?.status).toBe('auto_passed');
    expectAuditEvent(batch?.auditTrail, {
      kind: 'item_gated_retryable',
      agentDisplayName: 'Lena',
      detail: 'Keep the full body visible.',
    });
    expectAuditEvent(batch?.auditTrail, {
      kind: 'item_gated_retryable',
      agentDisplayName: 'Lena',
      detail: 'Reduce perspective distortion.',
    });
    expectAuditEvent(batch?.auditTrail, {
      kind: 'item_auto_passed',
      agentDisplayName: 'Lena',
    });
  });

  it('persists world style packs and compiled portrait briefs for later reuse', async () => {
    await createBatchWithCaptureStates({
      name: 'Persistent lane',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a4'],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a4',
        handle: 'mira',
        displayName: 'Mira',
        concept: 'Harbor navigator',
        description: null,
        scenario: null,
        greeting: null,
        worldId: 'w1',
        avatarUrl: null,
        currentPortrait: null,
        importance: 'PRIMARY',
        status: 'READY',
      }],
    });

    expect(useLookdevStore.getState().worldStylePacks.w1?.name).toBe(worldStylePack.name);
    expect(useLookdevStore.getState().portraitBriefs['w1::a4']?.displayName).toBe('Mira');
  });

  it('fails closed when agents from multiple worlds are mixed into one batch', async () => {
    await expect(createBatchWithCaptureStates({
      name: 'Broken lane',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: [],
      generationTarget,
      evaluationTarget,
      agents: [
        {
          id: 'a5',
          handle: 'rhea',
          displayName: 'Rhea',
          concept: 'First world',
          description: null,
          scenario: null,
          greeting: null,
          worldId: 'w1',
          avatarUrl: null,
          currentPortrait: null,
          importance: 'PRIMARY',
          status: 'READY',
        },
        {
          id: 'a6',
          handle: 'sora',
          displayName: 'Sora',
          concept: 'Second world',
          description: null,
          scenario: null,
          greeting: null,
          worldId: 'w2',
          avatarUrl: null,
          currentPortrait: null,
          importance: 'SECONDARY',
          status: 'READY',
        },
      ],
    })).rejects.toThrow('LOOKDEV_BATCH_SINGLE_WORLD_REQUIRED');
  });

  it('pauses a running batch synchronously', () => {
    useLookdevStore.setState({
      batches: [makeBatch({ status: 'running' })],
    });

    useLookdevStore.getState().pauseBatch('b1');

    expect(useLookdevStore.getState().batches[0]?.status).toBe('paused');
  });

  it('does nothing when pauseBatch is called outside the running state', () => {
    useLookdevStore.setState({
      batches: [makeBatch({ status: 'processing_complete' })],
    });

    useLookdevStore.getState().pauseBatch('b1');

    expect(useLookdevStore.getState().batches[0]?.status).toBe('processing_complete');
    expect(useLookdevStore.getState().batches[0]?.auditTrail).toEqual([]);
  });

  it('resumes a paused batch and finishes pending work', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'paused',
        items: [makeItem({ status: 'pending' })],
      })],
    });

    await useLookdevStore.getState().resumeBatch('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('processing_complete');
    expect(batch?.items[0]?.status).toBe('auto_passed');
  });

  it('does nothing when resumeBatch is called outside the paused state', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'processing_complete',
        items: [makeItem({ status: 'auto_passed', attemptCount: 1 })],
      })],
    });

    await useLookdevStore.getState().resumeBatch('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('processing_complete');
    expect(batch?.items[0]?.status).toBe('auto_passed');
    expect(mockRuntime.media.image.generate).not.toHaveBeenCalled();
  });

  it('resumes all active running batches on rehydrate', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'running',
        items: [makeItem({ status: 'pending' })],
      })],
    });

    await useLookdevStore.getState().resumeActiveBatches();

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('processing_complete');
    expect(batch?.items[0]?.status).toBe('auto_passed');
  });

  it('requeues orphaned generating items when resuming active batches after rehydrate', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'running',
        items: [makeItem({
          status: 'generating',
          attemptCount: 1,
          lastErrorCode: 'LOOKDEV_STALE_WORKER',
          lastErrorMessage: 'worker disappeared',
        })],
      })],
    });

    await useLookdevStore.getState().resumeActiveBatches();

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('processing_complete');
    expect(batch?.items[0]?.status).toBe('auto_passed');
    expect(batch?.items[0]?.attemptCount).toBe(2);
    expect(batch?.items[0]?.lastErrorCode).toBeNull();
    expectAuditEvent(batch?.auditTrail, {
      kind: 'batch_resumed',
      severity: 'warning',
      detail: 'Recovered interrupted generating items and returned them to pending.',
    });
  });

  it('reruns failed items and returns them to passed state', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'processing_complete',
        items: [
          makeItem({
            status: 'auto_failed_exhausted',
            attemptCount: 3,
            currentEvaluation: {
              passed: false,
              score: 61,
              checks: [{ key: 'fullBody', passed: false, kind: 'hard_gate' }],
              summary: 'Too cropped.',
              failureReasons: ['Keep the feet visible.'],
            },
            lastErrorCode: 'LOOKDEV_AUTO_GATE_EXHAUSTED',
            lastErrorMessage: 'Keep the feet visible.',
          }),
        ],
      })],
    });

    await useLookdevStore.getState().rerunFailed('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('processing_complete');
    expect(batch?.items[0]?.status).toBe('auto_passed');
    expect(batch?.items[0]?.attemptCount).toBe(1);
  });

  it('does nothing when rerunFailed is called before processing completes', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'paused',
        items: [
          makeItem({
            status: 'auto_failed_exhausted',
            attemptCount: 3,
          }),
        ],
      })],
    });

    await useLookdevStore.getState().rerunFailed('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('paused');
    expect(batch?.items[0]?.status).toBe('auto_failed_exhausted');
    expect(batch?.items[0]?.attemptCount).toBe(3);
  });

  it('marks items as commit_failed when writeback fails', async () => {
    upsertAgentPortraitBinding.mockRejectedValueOnce(new Error('binding write failed'));

    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'processing_complete',
        items: [
          makeItem({
            status: 'auto_passed',
            attemptCount: 1,
            currentImage: {
              url: 'https://images.example.com/portrait.png',
              mimeType: 'image/png',
              promptSnapshot: 'anchor',
              createdAt: '2026-03-28T00:00:00.000Z',
            },
            currentEvaluation: {
              passed: true,
              score: 88,
              checks: [{ key: 'fullBody', passed: true, kind: 'hard_gate' }],
              summary: 'Good anchor portrait.',
              failureReasons: [],
            },
          }),
        ],
      })],
    });

    await useLookdevStore.getState().commitBatch('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('commit_complete');
    expect(batch?.items[0]?.status).toBe('commit_failed');
    expect(batch?.items[0]?.lastErrorMessage).toContain('binding write failed');
    expectAuditEvent(batch?.auditTrail, {
      kind: 'item_commit_failed',
      agentDisplayName: 'Iris',
      detail: 'binding write failed',
    });
  });

  it('marks items as commit_failed when worldId is missing at writeback time', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'processing_complete',
        items: [
          makeItem({
            status: 'auto_passed',
            worldId: null,
            currentImage: {
              url: 'https://images.example.com/portrait.png',
              mimeType: 'image/png',
              promptSnapshot: 'anchor',
              createdAt: '2026-03-28T00:00:00.000Z',
            },
            currentEvaluation: {
              passed: true,
              score: 88,
              checks: [{ key: 'fullBody', passed: true, kind: 'hard_gate' }],
              summary: 'Good anchor portrait.',
              failureReasons: [],
            },
          }),
        ],
      })],
    });

    await useLookdevStore.getState().commitBatch('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('commit_complete');
    expect(batch?.items[0]?.status).toBe('commit_failed');
    expect(batch?.items[0]?.lastErrorMessage).toContain('LOOKDEV_AGENT_WORLD_ID_REQUIRED');
    expectAuditEvent(batch?.auditTrail, {
      kind: 'item_commit_failed',
      agentDisplayName: 'Iris',
      detail: 'LOOKDEV_AGENT_WORLD_ID_REQUIRED',
    });
  });

  it('marks items as commit_failed when the generated image download returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://images.example.com/')) {
        return new Response('expired', { status: 403, headers: { 'content-type': 'text/plain' } });
      }
      return new Response(null, { status: 200 });
    }));

    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'processing_complete',
        items: [
          makeItem({
            status: 'auto_passed',
            currentImage: {
              url: 'https://images.example.com/portrait.png',
              mimeType: 'image/png',
              promptSnapshot: 'anchor',
              createdAt: '2026-03-28T00:00:00.000Z',
            },
            currentEvaluation: {
              passed: true,
              score: 88,
              checks: [{ key: 'fullBody', passed: true, kind: 'hard_gate' }],
              summary: 'Good anchor portrait.',
              failureReasons: [],
            },
          }),
        ],
      })],
    });

    await useLookdevStore.getState().commitBatch('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('commit_complete');
    expect(batch?.items[0]?.status).toBe('commit_failed');
    expect(batch?.items[0]?.lastErrorMessage).toContain('LOOKDEV_COMMIT_IMAGE_FETCH_FAILED:403');
    expect(finalizeLookdevResource).not.toHaveBeenCalled();
    expect(upsertAgentPortraitBinding).not.toHaveBeenCalled();
  });

  it('marks items as commit_failed when the generated image download is not an image mime type', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://images.example.com/')) {
        return new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response(null, { status: 200 });
    }));

    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'processing_complete',
        items: [
          makeItem({
            status: 'auto_passed',
            currentImage: {
              url: 'https://images.example.com/portrait.png',
              mimeType: 'image/png',
              promptSnapshot: 'anchor',
              createdAt: '2026-03-28T00:00:00.000Z',
            },
            currentEvaluation: {
              passed: true,
              score: 88,
              checks: [{ key: 'fullBody', passed: true, kind: 'hard_gate' }],
              summary: 'Good anchor portrait.',
              failureReasons: [],
            },
          }),
        ],
      })],
    });

    await useLookdevStore.getState().commitBatch('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('commit_complete');
    expect(batch?.items[0]?.status).toBe('commit_failed');
    expect(batch?.items[0]?.lastErrorMessage).toContain('LOOKDEV_IMAGE_MIME_TYPE_INVALID:text/html');
    expect(finalizeLookdevResource).not.toHaveBeenCalled();
    expect(upsertAgentPortraitBinding).not.toHaveBeenCalled();
  });

  it('does nothing when commitBatch is called for a non-processing batch', async () => {
    useLookdevStore.setState({
      batches: [makeBatch({
        status: 'paused',
        items: [
          makeItem({
            status: 'auto_passed',
            currentImage: {
              url: 'https://images.example.com/portrait.png',
              mimeType: 'image/png',
              promptSnapshot: 'anchor',
              createdAt: '2026-03-28T00:00:00.000Z',
            },
          }),
        ],
      })],
    });

    await useLookdevStore.getState().commitBatch('b1');

    const batch = useLookdevStore.getState().batches[0];
    expect(batch?.status).toBe('paused');
    expect(batch?.items[0]?.status).toBe('auto_passed');
    expect(upsertAgentPortraitBinding).not.toHaveBeenCalled();
  });

});