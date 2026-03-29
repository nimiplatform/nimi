import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from './lookdev-store.js';
import { createDefaultWorldStylePack } from './types.js';

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

vi.mock('@renderer/data/lookdev-data-client.js', () => ({
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
        imageConnectorId: 'image-connector',
        imageModelId: 'image-model',
        visionConnectorId: 'vision-connector',
        visionModelId: 'vision-model',
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
        return new Response(new Blob(['image'], { type: 'image/png' }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    }));
  });

  const worldId = 'w1';
  const worldStylePack = createDefaultWorldStylePack(worldId, 'Aurora Harbor');

  it('creates a batch and auto-passes an item through runtime generation + evaluation', async () => {
    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Spring cast',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a1'],
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
  });

  it('commits passed items to Realm portrait binding', async () => {
    const batchId = await useLookdevStore.getState().createBatch({
      name: 'Commit batch',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a2'],
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
  });

  it('persists world style packs and compiled portrait briefs for later reuse', async () => {
    await useLookdevStore.getState().createBatch({
      name: 'Persistent lane',
      selectionSource: 'explicit_selection',
      worldId,
      worldStylePack,
      captureSelectionAgentIds: ['a4'],
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
});
