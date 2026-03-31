import { beforeEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSilentCaptureState } from './capture-harness.js';

const mockRuntime = {
  ai: {
    text: {
      generate: vi.fn(),
    },
  },
};

const target = {
  route: 'cloud' as const,
  connectorId: 'text-connector',
  modelId: 'text-model',
};

const worldStylePack = {
  worldId: 'world-1',
  name: 'Aurora Harbor Pack',
  language: 'en' as const,
  status: 'confirmed' as const,
  seedSource: 'style_session' as const,
  sourceSessionId: 'session-1',
  summary: 'Grounded, role-first anchor portraits with subdued backgrounds.',
  visualEra: 'Near-future industrial realism',
  artStyle: 'Controlled realistic character illustration',
  paletteDirection: 'Slate, steel, restrained cyan accents',
  materialDirection: 'Functional industrial surfaces with low noise',
  silhouetteDirection: 'Readable full-body silhouettes with clean structure',
  costumeDensity: 'Standard',
  backgroundDirection: 'Supportive and restrained',
  promptFrame: 'Full-body anchor portrait, fixed lens, background subordinate to subject readability.',
  forbiddenElements: ['fisheye distortion', 'poster lighting', 'busy cinematic background'],
  createdAt: '2026-03-31T10:00:00.000Z',
  updatedAt: '2026-03-31T10:00:00.000Z',
  confirmedAt: '2026-03-31T10:00:00.000Z',
};

const agent = {
  id: 'agent-1',
  displayName: 'System Watcher',
  concept: 'System watcher',
  description: 'A disciplined monitoring entity for the station core.',
  truthBundle: {
    description: 'A disciplined monitoring entity for the station core.',
    scenario: 'Monitors the station core and intervenes when systems drift.',
    greeting: 'Station core remains within tolerance.',
    wakeStrategy: 'PROACTIVE' as const,
    dna: {
      identity: {
        role: 'Systems observer',
        worldview: 'Order sustains survival',
        species: 'Synthetic humanoid',
        summary: 'A calm systems sentinel.',
      },
      biological: {
        gender: 'androgynous',
        visualAge: 'ageless adult',
        ethnicity: 'n/a',
        heightCm: 188,
        weightKg: 82,
      },
      appearance: {
        artStyle: 'clean industrial realism',
        hair: 'smooth plated cranial shell',
        eyes: 'cool cyan optics',
        skin: 'porcelain alloy skin',
        fashionStyle: 'modular station uniform',
        signatureItems: ['reactor keyline collar'],
      },
      personality: {
        summary: 'Measured and precise',
        mbti: 'INTJ',
        interests: ['systems', 'oversight'],
        goals: ['maintain station order'],
        relationshipMode: 'distant',
        emotionBaseline: 'cool',
      },
      communication: {
        summary: 'Short and exact',
        responseLength: 'short',
        formality: 'formal',
        sentiment: 'neutral',
      },
    },
    behavioralRules: ['Never dramatize failures.', 'Keep operator guidance concise.'],
    soulPrime: {
      text: 'Backstory: Built to watch over the station core.\n\nCore Values: Order before ego.',
      backstory: 'Built to watch over the station core.',
      coreValues: 'Order before ego.',
      personalityDescription: 'Calm and surgical under pressure.',
      guidelines: 'Never waste motion or words.',
      catchphrase: 'Order holds.',
    },
    ruleTruth: {
      identity: { statement: 'A synthetic systems observer built for station order.', structured: null },
      biological: { statement: null, structured: null },
      appearance: { statement: 'Keep a clean modular station silhouette with restrained cyan accents.', structured: null },
      personality: { statement: 'Measured, distant, and precise under stress.', structured: null },
      communication: { statement: 'Keep replies short, formal, and neutral.', structured: null },
    },
  },
  worldId: 'world-1',
  importance: 'PRIMARY' as const,
  existingPortraitUrl: null,
};

const captureEnvelope = {
  currentBrief: 'A disciplined industrial monitoring entity with clean modular surfaces.',
  sourceSummary: 'Derived from the agent truth and the world lane emphasis on disciplined industrial realism.',
  feelingAnchor: {
    coreVibe: 'Controlled industrial vigilance',
    tonePhrases: ['precise', 'calm', 'high-order'],
    avoidVibe: ['chaotic', 'scrappy'],
  },
  workingMemory: {
    effectiveIntentSummary: 'Keep the role legible and restrained while preserving a non-human monitoring presence.',
    preserveFocus: ['modular body design', 'calm stance'],
    adjustFocus: ['cleaner silhouette'],
    negativeConstraints: ['avoid clutter'],
  },
  visualIntent: {
    visualRole: 'Industrial monitoring entity',
    silhouette: 'Clean full-body modular silhouette',
    outfit: 'Integrated shell with restrained panel hierarchy',
    hairstyle: 'No hair; smooth cranial plating',
    palettePrimary: 'Steel white, graphite, restrained cyan',
    artStyle: 'Controlled realistic character illustration',
    mustKeepTraits: ['monitoring presence', 'non-human precision'],
    forbiddenTraits: ['scrap-built asymmetry'],
    detailBudget: 'hero',
    backgroundWeight: 'supporting',
  },
  assistantReply: 'Locking the role into a cleaner, more disciplined monitoring silhouette.',
};

describe('capture-harness', () => {
  beforeEach(() => {
    mockRuntime.ai.text.generate.mockReset();
    mockRuntime.ai.text.generate.mockResolvedValue({
      text: JSON.stringify(captureEnvelope),
      finishReason: 'stop',
      trace: { traceId: 'trace-capture-1' },
    });
  });

  it('uses explicit behavior wording instead of internal product shorthand in the english silent-capture prompt', async () => {
    await synthesizeSilentCaptureState({
      runtime: mockRuntime as never,
      target,
      language: 'en',
      agent,
      worldStylePack,
      captureMode: 'batch_only',
    });

    expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('Understand the current role first'),
    }));
    expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.not.stringContaining('Agent-Capture'),
    }));
    expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('creator-scoped detail and AgentRule truth'),
    }));
    expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.stringContaining('appearanceTruth: artStyle=clean industrial realism'),
    }));
  });

  it('uses explicit behavior wording instead of internal product shorthand in the chinese silent-capture prompt', async () => {
    await synthesizeSilentCaptureState({
      runtime: mockRuntime as never,
      target,
      language: 'zh',
      agent,
      worldStylePack: {
        ...worldStylePack,
        language: 'zh',
      },
      captureMode: 'batch_only',
    });

    expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('先理解当前角色'),
    }));
    expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.not.stringContaining('Agent-Capture'),
    }));
  });

  it('uses richer creator truth as the default visual fallback while still returning a capture state', async () => {
    mockRuntime.ai.text.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        currentBrief: 'Disciplined station observer held in a clean modular anchor portrait.',
        sourceSummary: 'Derived from creator truth, AgentRule truth, and the world lane.',
        feelingAnchor: {
          coreVibe: 'Controlled industrial vigilance',
        },
        workingMemory: {
          effectiveIntentSummary: 'Preserve the systems-observer identity while keeping the silhouette clean.',
        },
        visualIntent: {},
      }),
      finishReason: 'stop',
      trace: { traceId: 'trace-capture-2' },
    });

    const state = await synthesizeSilentCaptureState({
      runtime: mockRuntime as never,
      target,
      language: 'en',
      agent,
      worldStylePack,
      captureMode: 'batch_only',
    });

    expect(state.visualIntent.visualRole).toBe('Systems observer');
    expect(state.visualIntent.hairstyle).toBe('smooth plated cranial shell');
    expect(state.visualIntent.outfit).toContain('modular station uniform');
    expect(state.visualIntent.mustKeepTraits).toContain('reactor keyline collar');
    expect(state.sourceConfidence).toBe('derived_from_agent_truth');
  });
});
