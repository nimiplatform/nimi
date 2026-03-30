import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from './lookdev-store.js';
import { createConfirmedWorldStylePack, createDefaultPolicySnapshot, type LookdevAuditEvent, type LookdevBatch, type LookdevItem } from './types.js';
import { createWorldStyleSession } from './world-style-session.js';

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
  getLookdevAgent,
  getAgentPortraitBinding,
  createLookdevImageUpload,
  finalizeLookdevResource,
  upsertAgentPortraitBinding,
} = vi.hoisted(() => ({
  getLookdevAgent: vi.fn(async () => ({
    description: 'Long coat, measured posture.',
    scenario: 'anchor',
    greeting: null,
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
  getLookdevAgent,
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
    useLookdevStore.setState({ batches: [] });
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

  it('creates a batch and auto-passes an item through runtime generation + evaluation', async () => {
    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Spring cast',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a1'],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a1',
        handle: 'iris',
        displayName: 'Iris',
        concept: 'Wind scout',
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

    const batch = useLookdevStore.getState().batches.find((item) => item.batchId === batchId);
    expect(batch?.status).toBe('processing_complete');
    expect(batch?.items[0]?.status).toBe('auto_passed');
    expect(batch?.items[0]?.currentEvaluation?.score).toBe(88);
    expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'vision-model',
      connectorId: 'vision-connector',
      route: 'cloud',
      input: [
        expect.objectContaining({
          role: 'user',
          content: [
            { type: 'text', text: 'Evaluate Iris portrait candidate.' },
            {
              type: 'artifact_ref',
              artifactId: 'artifact-1',
              mimeType: 'image/png',
              displayName: 'Iris candidate',
            },
          ],
        }),
      ],
    }));
  });

  it('clamps score threshold and max concurrency into supported bounds', async () => {
    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Clamped batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: [],
      generationTarget,
      evaluationTarget,
      maxConcurrency: 99,
      scoreThreshold: 0,
      agents: [{
        id: 'a7',
        handle: 'tess',
        displayName: 'Tess',
        concept: 'Signal keeper',
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

    const batch = useLookdevStore.getState().batches.find((item) => item.batchId === batchId);
    expect(batch?.policySnapshot.maxConcurrency).toBe(4);
    expect(batch?.policySnapshot.autoEvalPolicy.scoreThreshold).toBe(1);
    expect(batch?.policySnapshot.generationPolicy.aspectRatio).toBe('3:4');
  });

  it('uses a Gemini-safe image generation request shape', async () => {
    await useLookdevStore.getState().createBatch({
      name: 'Gemini batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a9'],
      generationTarget: geminiGenerationTarget,
      evaluationTarget,
      agents: [{
        id: 'a9',
        handle: 'mei',
        displayName: 'Mei',
        concept: 'Moon sect cultivator',
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

    expect(mockRuntime.media.image.generate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.1-flash-image-preview',
      connectorId: 'sys-cloud-gemini',
      route: 'cloud',
      aspectRatio: '3:4',
    }));
    expect(mockRuntime.media.image.generate).not.toHaveBeenCalledWith(expect.objectContaining({
      negativePrompt: expect.anything(),
    }));
    expect(mockRuntime.media.image.generate).not.toHaveBeenCalledWith(expect.objectContaining({
      style: expect.anything(),
    }));
    expect(mockRuntime.media.image.generate).not.toHaveBeenCalledWith(expect.objectContaining({
      responseFormat: expect.anything(),
    }));
    expect(mockRuntime.media.image.generate).not.toHaveBeenCalledWith(expect.objectContaining({
      n: expect.anything(),
    }));
  });

  it('uses the rich image request shape for openai-compatible Gemini connectors on /openai endpoints', async () => {
    await useLookdevStore.getState().createBatch({
      name: 'OpenAI-compatible Gemini batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a10'],
      generationTarget: openAICompatibleGeminiGenerationTarget,
      evaluationTarget,
      agents: [{
        id: 'a10',
        handle: 'lin',
        displayName: 'Lin',
        concept: 'Moon sect guardian',
        description: 'Moon sect guardian with a measured posture.',
        scenario: null,
        greeting: null,
        worldId: 'w1',
        avatarUrl: 'placeholder:portrait-seed',
        currentPortrait: null,
        importance: 'PRIMARY',
        status: 'READY',
      }],
    });

    expect(mockRuntime.media.image.generate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'models/gemini-3.1-flash-image-preview',
      connectorId: 'api-connector',
      route: 'cloud',
      prompt: expect.any(String),
      aspectRatio: '3:4',
      negativePrompt: expect.any(String),
      style: 'anchor-portrait',
      n: 1,
      responseFormat: 'url',
    }));
  });

  it('fails closed when evaluation would have to reference an image without artifact metadata', async () => {
    mockRuntime.media.image.generate.mockResolvedValue({
      artifacts: [{
        uri: 'https://images.example.com/portrait.png',
        mimeType: 'image/png',
      }],
      trace: { traceId: 'trace-1' },
    });

    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Artifact ref required batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: [],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a9b',
        handle: 'mira',
        displayName: 'Mira',
        concept: 'Moon harbor scout',
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

    const batch = useLookdevStore.getState().batches.find((entry) => entry.batchId === batchId);
    expect(batch?.items[0]?.status).toBe('auto_failed_exhausted');
    expect(batch?.items[0]?.lastErrorCode).toBe('LOOKDEV_EVALUATION_ARTIFACT_REQUIRED');
    expect(mockRuntime.ai.text.generate).not.toHaveBeenCalled();
  });

  it('falls back to null when current portrait binding lookup fails', async () => {
    getAgentPortraitBinding.mockRejectedValueOnce(new Error('binding unavailable'));

    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Binding fallback batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: [],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a8',
        handle: 'kira',
        displayName: 'Kira',
        concept: 'Harbor watcher',
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

    const batch = useLookdevStore.getState().batches.find((item) => item.batchId === batchId);
    expect(batch?.items[0]?.existingPortraitUrl).toBeNull();
    expect(batch?.items[0]?.referenceImageUrl).toBeNull();
  });

  it('preserves the generated image when evaluation fails after generation', async () => {
    mockRuntime.ai.text.generate.mockRejectedValue(new Error('provider rejected request parameters'));

    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Evaluation failure keeps artifact',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a11'],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a11',
        handle: 'veta',
        displayName: 'Veta',
        concept: 'Harbor tactician',
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

    const batch = useLookdevStore.getState().batches.find((entry) => entry.batchId === batchId);
    expect(batch?.items[0]?.status).toBe('auto_failed_exhausted');
    expect(batch?.items[0]?.lastErrorMessage).toBe('provider rejected request parameters');
    expect(batch?.items[0]?.currentImage?.url).toBe('https://images.example.com/portrait.png');
    expect(batch?.items[0]?.currentEvaluation).toBeNull();
  });

  it('does not treat generic avatar urls as lookdev generation references', async () => {
    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Avatar is not a reference batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: [],
      generationTarget: geminiGenerationTarget,
      evaluationTarget,
      agents: [{
        id: 'a8b',
        handle: 'suri',
        displayName: 'Suri',
        concept: 'Harbor witness',
        description: null,
        scenario: null,
        greeting: null,
        worldId: 'w1',
        avatarUrl: 'placeholder:portrait-seed',
        currentPortrait: null,
        importance: 'PRIMARY',
        status: 'READY',
      }],
    });

    const batch = useLookdevStore.getState().batches.find((item) => item.batchId === batchId);
    expect(batch?.items[0]?.referenceImageUrl).toBeNull();
    expect(mockRuntime.media.image.generate).toHaveBeenCalledWith(expect.not.objectContaining({
      referenceImages: expect.anything(),
    }));
  });

  it('commits passed items to Realm portrait binding', async () => {
    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Commit batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a2'],
      generationTarget,
      evaluationTarget,
      agents: [{
        id: 'a2',
        handle: 'nora',
        displayName: 'Nora',
        concept: 'Clockwork guide',
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

    await useLookdevStore.getState().commitBatch(batchId);
    const batch = useLookdevStore.getState().batches.find((item) => item.batchId === batchId);
    expect(batch?.status).toBe('commit_complete');
    expect(batch?.items[0]?.status).toBe('committed');
    expect(batch?.auditTrail[0]).toMatchObject({ kind: 'commit_complete', scope: 'batch' });
    expectAuditEvent(batch?.auditTrail, {
      kind: 'item_committed',
      agentDisplayName: 'Nora',
      detail: 'AGENT_PORTRAIT',
    });
  });

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
          ],
          summary: 'Third pass is acceptable.',
          failureReasons: [],
        }),
      });

    const batchId = await useLookdevStore.getState().createBatch({
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
    await useLookdevStore.getState().createBatch({
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
    await expect(useLookdevStore.getState().createBatch({
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

    useLookdevStore.getState().saveWorldStyleSession(session);

    const persisted = localStorage.getItem('lookdev-workspace-formal-v8');
    expect(persisted).toContain('"worldStyleSessions"');
    expect(persisted).toContain('"Aurora Harbor"');
  });
});
