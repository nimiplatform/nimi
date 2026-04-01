import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeTargetOption } from '@renderer/app-shell/providers/app-store.js';
import type { LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { expectedCaptureStateSignature } from './create-batch-page-helpers.js';
import { useLookdevCaptureStateSynthesis } from './use-lookdev-capture-state-synthesis.js';
import type { LookdevCaptureState, LookdevPortraitBrief, LookdevWorldStylePack } from './types.js';

const { getAgentPortraitBinding, getLookdevAgentAuthoringContext } = vi.hoisted(() => ({
  getAgentPortraitBinding: vi.fn(async () => null),
  getLookdevAgentAuthoringContext: vi.fn(async () => ({
    detail: {
      description: 'Station receptionist with calm posture.',
      scenario: null,
      greeting: null,
    },
    truthBundle: null,
    fullTruthReadable: false,
  })),
}));

const { materializePortraitBriefFromCaptureState, synthesizeSilentCaptureState } = vi.hoisted(() => ({
  materializePortraitBriefFromCaptureState: vi.fn((state: LookdevCaptureState) => ({
    agentId: state.agentId,
    worldId: state.worldId,
    displayName: state.displayName,
    visualRole: state.visualIntent.visualRole,
    silhouette: state.visualIntent.silhouette,
    outfit: state.visualIntent.outfit,
    hairstyle: state.visualIntent.hairstyle,
    palettePrimary: state.visualIntent.palettePrimary,
    artStyle: state.visualIntent.artStyle,
    mustKeepTraits: [...state.visualIntent.mustKeepTraits],
    forbiddenTraits: [...state.visualIntent.forbiddenTraits],
    sourceConfidence: state.sourceConfidence,
    updatedAt: state.updatedAt,
  })),
  synthesizeSilentCaptureState: vi.fn(),
}));

vi.mock('@renderer/data/lookdev-data-client.js', async () => {
  const actual = await vi.importActual<object>('@renderer/data/lookdev-data-client.js');
  return {
    ...actual,
    getAgentPortraitBinding,
    getLookdevAgentAuthoringContext,
  };
});

vi.mock('./capture-harness.js', async () => {
  const actual = await vi.importActual<object>('./capture-harness.js');
  return {
    ...actual,
    materializePortraitBriefFromCaptureState,
    synthesizeSilentCaptureState,
  };
});

type HarnessProps = {
  storedCaptureStates: Record<string, LookdevCaptureState>;
};

const runtime = {} as never;
const styleDialogueTarget = {
  key: 'cloud:gemini-text',
  capability: 'text.generate',
  route: 'cloud',
  source: 'cloud',
  connectorId: 'cloud-gemini',
  connectorLabel: 'Cloud Gemini',
  endpoint: 'https://runtime.example/connector/cloud-gemini',
  provider: 'gemini',
  modelId: 'gemini-3-flash-preview',
  modelLabel: 'gemini-3-flash-preview',
} satisfies RuntimeTargetOption;

const worldStylePack: LookdevWorldStylePack = {
  worldId: 'w1',
  name: 'Oasis Reception Lane',
  language: 'zh',
  status: 'confirmed',
  seedSource: 'style_session',
  sourceSessionId: 'session-1',
  summary: '极简流线型绿洲接待风格。',
  visualEra: 'futuristic oasis',
  artStyle: 'clean industrial realism',
  paletteDirection: 'white, silver, cyan glow',
  materialDirection: 'gloss ceramic and polished alloy',
  silhouetteDirection: 'clean humanoid silhouette',
  costumeDensity: 'minimal',
  backgroundDirection: 'restrained',
  promptFrame: 'production-ready anchor portrait',
  forbiddenElements: ['industrial clutter'],
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  confirmedAt: '2026-04-01T00:00:00.000Z',
};

const selectedAgent: Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'> = {
  id: 'a1',
  handle: '~oasis_receptionist',
  displayName: '接待员',
  concept: '接待机器人',
  worldId: 'w1',
  avatarUrl: null,
  importance: 'PRIMARY',
  status: 'READY',
};

function makeCaptureState(): LookdevCaptureState {
  return {
    agentId: 'a1',
    worldId: 'w1',
    displayName: '接待员',
    sourceConfidence: 'world_style_fallback',
    captureMode: 'capture',
    synthesisMode: 'interactive',
    seedSignature: expectedCaptureStateSignature({
      agent: selectedAgent,
      worldStylePack,
      captureMode: 'capture',
    }),
    currentBrief: '接待员的默认立绘 brief。',
    sourceSummary: 'Synthesized from readable agent fields and the current world style lane.',
    feelingAnchor: {
      coreVibe: '神圣秩序感',
      tonePhrases: [],
      avoidVibe: [],
    },
    workingMemory: {
      effectiveIntentSummary: '保持门厅引导感。',
      preserveFocus: [],
      adjustFocus: [],
      negativeConstraints: [],
    },
    visualIntent: {
      visualRole: '高科技拟人接待机器人',
      silhouette: 'clean humanoid silhouette',
      outfit: 'gloss ceramic shell',
      hairstyle: 'streamlined head shell',
      palettePrimary: 'white, silver, cyan glow',
      artStyle: 'clean industrial realism',
      mustKeepTraits: ['接待员'],
      forbiddenTraits: ['industrial clutter'],
      detailBudget: 'hero',
      backgroundWeight: 'supporting',
    },
    messages: [],
    lastTextTraceId: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

function Harness(props: HarnessProps) {
  const result = useLookdevCaptureStateSynthesis({
    stylePackConfirmed: true,
    worldStylePack,
    styleDialogueTarget,
    selectedAgents: [selectedAgent],
    captureSelectionAgentIds: ['a1'],
    storedCaptureStates: props.storedCaptureStates,
    storedPortraitBriefs: {} as Record<string, LookdevPortraitBrief>,
    currentLanguage: 'zh',
    runtime,
    saveCaptureState: () => {},
    savePortraitBrief: () => {},
  });

  return (
    <div>
      <div data-testid="busy">{String(result.captureSynthesisBusy)}</div>
      <div data-testid="ready">{String(result.captureStatesReady)}</div>
      <div data-testid="count">{String(result.captureStates.length)}</div>
    </div>
  );
}

describe('useLookdevCaptureStateSynthesis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears busy once matching capture states are already present after a rerender', async () => {
    const pending = {
      resolve: null as null | ((state: LookdevCaptureState) => void),
    };
    synthesizeSilentCaptureState.mockImplementation(() => new Promise<LookdevCaptureState>((resolve) => {
      pending.resolve = resolve;
    }));

    const view = render(<Harness storedCaptureStates={{}} />);

    await waitFor(() => {
      expect(screen.getByTestId('busy').textContent).toBe('true');
    });

    const state = makeCaptureState();
    view.rerender(<Harness storedCaptureStates={{ 'w1::a1': state }} />);

    await waitFor(() => {
      expect(screen.getByTestId('busy').textContent).toBe('false');
      expect(screen.getByTestId('ready').textContent).toBe('true');
      expect(screen.getByTestId('count').textContent).toBe('1');
    });

    if (pending.resolve) {
      pending.resolve(state);
    }
  });
});
