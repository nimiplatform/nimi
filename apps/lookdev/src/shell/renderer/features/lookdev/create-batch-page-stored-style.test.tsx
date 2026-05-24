import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { changeLocale, initI18n } from '@renderer/i18n/index.js';
import CreateBatchPage from './create-batch-page.js';
import { useLookdevStore } from './lookdev-store.js';
import { createConfirmedWorldStylePack, type LookdevCaptureState, type LookdevPortraitBrief, type LookdevWorldStylePack } from './types.js';
import { buildCaptureSeedSignature, createCaptureStateKey } from './capture-harness.js';

vi.mock('@nimiplatform/kit/ui', async () => {
  const actual = await vi.importActual<typeof import('@nimiplatform/kit/ui')>('@nimiplatform/kit/ui');
  return {
    ...actual,
    SelectField: ({ options, value, placeholder, onValueChange, onChange, id, ...rest }: import('@nimiplatform/kit/ui').SelectFieldProps) => (
      <select
        id={id}
        aria-label={rest['aria-label']}
        value={value ?? ''}
        onChange={(event) => {
          onValueChange?.(event.target.value);
          onChange?.({
            target: { value: event.target.value },
            currentTarget: { value: event.target.value },
          });
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {typeof option.label === 'string' ? option.label : String(option.value)}
          </option>
        ))}
      </select>
    ),
  };
});

const { listLookdevWorlds, listLookdevAgents, listLookdevWorldAgents, getLookdevAgent, getLookdevAgentTruthBundle, getLookdevAgentAuthoringContext, getAgentPortraitBinding } = vi.hoisted(() => ({
  listLookdevWorlds: vi.fn(),
  listLookdevAgents: vi.fn(),
  listLookdevWorldAgents: vi.fn(),
  getLookdevAgent: vi.fn(async (agentId: string) => ({
    description: agentId === 'a2' ? 'Clockwork guide with patient posture.' : 'Anchor scout with a steady dockside silhouette.',
    scenario: null,
    greeting: null,
  })),
  getLookdevAgentTruthBundle: vi.fn(async (worldId: string, agentId: string) => ({
    description: agentId === 'a2' ? 'Clockwork guide with patient posture.' : 'Anchor scout with a steady dockside silhouette.',
    scenario: `Scenario for ${worldId}/${agentId}`,
    greeting: null,
    wakeStrategy: 'PASSIVE',
    dna: {
      identity: { role: 'Dock agent', worldview: null, species: null, summary: null },
      biological: { gender: null, visualAge: null, ethnicity: null, heightCm: null, weightKg: null },
      appearance: { artStyle: null, hair: null, eyes: null, skin: null, fashionStyle: null, signatureItems: [] },
      personality: { summary: null, mbti: null, interests: [], goals: [], relationshipMode: null, emotionBaseline: null },
      communication: { summary: null, responseLength: null, formality: null, sentiment: null },
    },
    behavioralRules: [],
    soulPrime: null,
    ruleTruth: {
      identity: { statement: null, structured: null },
      biological: { statement: null, structured: null },
      appearance: { statement: null, structured: null },
      personality: { statement: null, structured: null },
      communication: { statement: null, structured: null },
    },
  })),
  getLookdevAgentAuthoringContext: vi.fn(async (worldId: string, agentId: string) => {
    try {
      const truthBundle = await getLookdevAgentTruthBundle(worldId, agentId);
      return {
        detail: {
          description: truthBundle.description,
          scenario: truthBundle.scenario,
          greeting: truthBundle.greeting,
        },
        truthBundle,
        fullTruthReadable: true,
      };
    } catch {
      const detail = await getLookdevAgent(agentId).catch(() => null);
      return {
        detail,
        truthBundle: null,
        fullTruthReadable: false,
      };
    }
  }),
  getAgentPortraitBinding: vi.fn(async () => null),
}));

vi.mock('@renderer/data/lookdev-data-client.js', async () => {
  const actual = await vi.importActual<object>('@renderer/data/lookdev-data-client.js');
  return {
    ...actual,
    listLookdevWorlds,
    listLookdevAgents,
    listLookdevWorldAgents,
    getLookdevAgent,
    getLookdevAgentTruthBundle,
    getLookdevAgentAuthoringContext,
    getAgentPortraitBinding,
  };
});

const mockRuntime = {
  ai: {
    text: {
      generate: vi.fn(),
    },
  },
};

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: mockRuntime,
  }),
}));

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => undefined,
    });
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => undefined,
    });
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    });
  }
});

function portraitBriefKey(worldId: string | null | undefined, agentId: string): string {
  return `${String(worldId || 'unscoped').trim() || 'unscoped'}::${agentId}`;
}

const queryClients: QueryClient[] = [];

function seedWorkingState() {
  const saveWorldStylePack = vi.fn((pack: LookdevWorldStylePack) => {
    useLookdevStore.setState((state) => ({
      worldStylePacks: {
        ...state.worldStylePacks,
        [pack.worldId]: pack,
      },
    }));
  });
  const savePortraitBrief = vi.fn((brief: LookdevPortraitBrief) => {
    useLookdevStore.setState((state) => ({
      portraitBriefs: {
        ...state.portraitBriefs,
        [portraitBriefKey(brief.worldId, brief.agentId)]: brief,
      },
    }));
  });
  const createBatch = vi.fn(async () => 'batch-1');

  useLookdevStore.setState({
    createBatch,
    worldStyleSessions: {},
    saveWorldStylePack,
    savePortraitBrief,
    batches: [],
    captureStates: {},
    worldStylePacks: {},
    portraitBriefs: {},
  });

  return { createBatch, saveWorldStylePack, savePortraitBrief };
}

function renderCreatePage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  queryClients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/batches/new']}>
        <Routes>
          <Route path="/batches/new" element={<CreateBatchPage />} />
          <Route path="/batches/:batchId" element={<div>detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  while (queryClients.length > 0) {
    const client = queryClients.pop();
    client?.clear();
    client?.unmount();
  }
});

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

const alternateDialogueTarget = {
  key: 'text.generate::cloud::api-connector::models/gemini-3-flash-preview::',
  source: 'cloud' as const,
  route: 'cloud' as const,
  connectorId: 'api-connector',
  connectorLabel: 'API Connector',
  endpoint: 'https://api.example.com/v1',
  provider: 'gemini',
  modelId: 'models/gemini-3-flash-preview',
  modelLabel: 'gemini-3-flash-preview',
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

const { key: _generationTargetKey, ...expectedGenerationTarget } = generationTarget;
const { key: _evaluationTargetKey, ...expectedEvaluationTarget } = evaluationTarget;

function formatRuntimeTargetLabel(target: { route: string; source: string; connectorLabel?: string; provider?: string; connectorId?: string; modelLabel?: string; localModelId?: string; modelId: string }, localLabel = 'Local route') {
  const model = target.modelLabel || target.localModelId || target.modelId;
  if (target.route === 'local' || target.source === 'local') {
    return `${localLabel} / ${model}`;
  }
  const connector = target.connectorLabel || target.provider || target.connectorId;
  return `${connector} / ${model}`;
}

async function selectFieldOption(user: ReturnType<typeof userEvent.setup>, label: string, optionName: string | RegExp) {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  let option: HTMLOptionElement | undefined;
  await waitFor(() => {
    option = Array.from(select.options).find((entry) => {
      if (optionName instanceof RegExp) {
        return optionName.test(entry.textContent || '');
      }
      return (entry.textContent || '').trim() === optionName;
    });
    expect(option).toBeDefined();
  });
  if (!option) {
    throw new Error(`Missing option for ${label}: ${String(optionName)}`);
  }
  await user.selectOptions(select, option.value);
}

function buildDialoguePayload(language: 'en' | 'zh') {
  if (language === 'zh') {
    return {
      assistantReply: '我已经抓到这条 world lane 了。现在可以直接整理风格包草案；如果你还想继续收紧禁区或角色差异，也可以继续聊。',
      readiness: 'ready_to_synthesize',
      readinessReason: '世界气质、差异方式和画面控制已经足够稳定，可以先整理草案再继续细修。',
      summary: '人物锚点肖像整体克制写实，靠服装层级、身份气场与门派感拉开差异，背景始终退后服务角色识别。',
      understanding: {
        tone: '克制写实，强调身份气质与世界一致性。',
        differentiation: '主要靠服装层级、身份气场和材质差异拉开人物。',
        palette: '配色收敛，背景退后，镜头稳定服务角色识别。',
        forbidden: '不要极端近景、夸张动作和喧宾夺主的背景。',
      },
      openQuestions: ['如果你有更具体的禁区或门派差异，也可以继续补充。'],
    };
  }
  return {
    assistantReply: 'I have the lane now. We can synthesize a draft style pack immediately, and you can still keep tightening any taboo or differentiation cue afterward.',
    readiness: 'ready_to_synthesize',
    readinessReason: 'The lane already has stable tone, differentiation, and control principles, so a draft can be synthesized now.',
    summary: 'Anchor portraits should stay grounded and role-first, with costume hierarchy doing most of the differentiation while palette and background remain restrained.',
    understanding: {
      tone: 'Grounded, role-first realism with stable world-authored identity.',
      differentiation: 'Costume hierarchy, role identity, and restrained material contrast.',
      palette: 'Restrained palette with subdued backgrounds and stable camera control.',
      forbidden: 'No extreme close-ups or noisy cinematic backdrops.',
    },
    openQuestions: ['If needed, we can still tighten any world-specific taboo after the draft is synthesized.'],
  };
}

function buildSynthesisPayload(language: 'en' | 'zh') {
  if (language === 'zh') {
    return {
      name: 'Aurora Harbor 肖像风格包',
      summary: '人物锚点肖像整体克制写实，主要通过服装层级与身份气场拉开差异，背景始终服从角色识别。',
      visualEra: '克制写实的世界人物时代感与身份气质。',
      artStyle: '角色锚点肖像插画，强调稳定的人物识别。',
      paletteDirection: '收敛的主配色关系，背景退后，不抢角色识别。',
      materialDirection: '材质表达服务人物身份层级，不追求表面噪音。',
      silhouetteDirection: '全身轮廓清楚，服装结构是主要差异来源。',
      costumeDensity: '中等复杂度，优先服务身份与阵营识别。',
      backgroundDirection: '背景只做世界氛围托底，不喧宾夺主。',
      promptFrame: '全身角色锚点肖像，固定焦距，稳定视角，背景服从角色识别。',
      forbiddenElements: ['极端近景', '夸张动作姿态', '喧宾夺主的背景'],
    };
  }
  return {
    name: 'Aurora Harbor portrait style pack',
    summary: 'Anchor portraits stay grounded and role-first, with costume hierarchy carrying differentiation while palette and background remain restrained.',
    visualEra: 'Grounded harbor-world identity with restrained retro-futurist realism.',
    artStyle: 'Anchor portrait illustration with stable character readability.',
    paletteDirection: 'Restrained teal-and-brass direction with subdued backgrounds.',
    materialDirection: 'Material language serves role hierarchy rather than decorative noise.',
    silhouetteDirection: 'Clean full-body silhouettes with clear costume structure.',
    costumeDensity: 'Moderate complexity that serves role identity first.',
    backgroundDirection: 'Backgrounds stay atmospheric but subordinate to character readability.',
    promptFrame: 'full-body character anchor portrait, fixed focal length, stable eye-level camera, subdued background',
    forbiddenElements: ['extreme close-up', 'dramatic action pose', 'busy cinematic background'],
  };
}

function buildCapturePayload(input: string, language: 'en' | 'zh') {
  const isNora = input.includes('displayName: Nora') || input.includes('Clockwork guide');
  const visualRole = isNora ? 'Clockwork guide' : 'Anchor scout';
  const outfit = isNora ? 'clockwork guide coat' : 'weatherproof scout coat';
  const silhouette = isNora ? 'clocktower guide silhouette' : 'harbor scout silhouette';
  if (language === 'zh') {
    return {
      assistantReply: isNora ? '这版更像一个耐心、稳定的钟楼向导。' : '这版更像一个稳定、克制的港口斥候。',
      currentBrief: isNora ? '钟楼向导保持稳定轮廓与克制材质层级。' : '港口斥候保持稳定轮廓与世界内实用服装语言。',
      sourceSummary: '由 Realm 角色信息与当前世界风格 lane 共同整理。',
      feelingAnchor: {
        coreVibe: isNora ? '耐心的秩序感' : '克制的前线感',
        tonePhrases: isNora ? ['稳定', '耐心'] : ['稳定', '克制'],
        avoidVibe: ['夸张电影感'],
      },
      workingMemory: {
        effectiveIntentSummary: isNora ? '保持钟楼向导的稳定秩序感。' : '保持港口斥候的可读性与实用气质。',
        preserveFocus: [visualRole],
        adjustFocus: [outfit],
        negativeConstraints: ['极端近景'],
      },
      visualIntent: {
        visualRole,
        silhouette,
        outfit,
        hairstyle: isNora ? 'orderly pinned hair' : 'windswept bob',
        palettePrimary: isNora ? 'brass and midnight blue' : 'teal and amber',
        artStyle: '角色锚点肖像插画，强调稳定的人物识别。',
        mustKeepTraits: [visualRole],
        forbiddenTraits: ['极端近景'],
        detailBudget: isNora ? 'standard' : 'hero',
        backgroundWeight: 'supporting',
      },
    };
  }
  return {
    assistantReply: isNora ? 'This lands as a patient, steady clocktower guide.' : 'This lands as a grounded harbor scout with a stable silhouette.',
    currentBrief: isNora ? 'Clockwork guide stays stable and role-readable inside the lane.' : 'Anchor scout stays grounded and role-readable inside the lane.',
    sourceSummary: 'Synthesized from Realm role truth and the current world style lane.',
    feelingAnchor: {
      coreVibe: isNora ? 'patient order' : 'grounded vigilance',
      tonePhrases: isNora ? ['steady', 'measured'] : ['steady', 'grounded'],
      avoidVibe: ['noisy cinematic drama'],
    },
    workingMemory: {
      effectiveIntentSummary: isNora ? 'Keep the guide orderly and readable.' : 'Keep the scout readable and world-aligned.',
      preserveFocus: [visualRole],
      adjustFocus: [outfit],
      negativeConstraints: ['extreme close-up'],
    },
    visualIntent: {
      visualRole,
      silhouette,
      outfit,
      hairstyle: isNora ? 'orderly pinned hair' : 'windswept bob',
      palettePrimary: isNora ? 'brass and midnight blue' : 'teal and amber',
      artStyle: 'Anchor portrait illustration with stable character readability.',
      mustKeepTraits: [visualRole],
      forbiddenTraits: ['extreme close-up'],
      detailBudget: isNora ? 'standard' : 'hero',
      backgroundWeight: 'supporting',
    },
  };
}

function buildDefaultTruthBundle(worldId: string, agentId: string) {
  return {
    description: agentId === 'a2' ? 'Clockwork guide with patient posture.' : 'Anchor scout with a steady dockside silhouette.',
    scenario: `Scenario for ${worldId}/${agentId}`,
    greeting: null,
    wakeStrategy: 'PASSIVE',
    dna: {
      identity: { role: 'Dock agent', worldview: null, species: null, summary: null },
      biological: { gender: null, visualAge: null, ethnicity: null, heightCm: null, weightKg: null },
      appearance: { artStyle: null, hair: null, eyes: null, skin: null, fashionStyle: null, signatureItems: [] },
      personality: { summary: null, mbti: null, interests: [], goals: [], relationshipMode: null, emotionBaseline: null },
      communication: { summary: null, responseLength: null, formality: null, sentiment: null },
    },
    behavioralRules: [],
    soulPrime: null,
    ruleTruth: {
      identity: { statement: null, structured: null },
      biological: { statement: null, structured: null },
      appearance: { statement: null, structured: null },
      personality: { statement: null, structured: null },
      communication: { statement: null, structured: null },
    },
  };
}

function makeStoredCaptureState(overrides: Partial<LookdevCaptureState> = {}): LookdevCaptureState {
  return {
    agentId: 'a1',
    worldId: 'w1',
    displayName: 'Iris',
    sourceConfidence: 'derived_from_agent_truth',
    captureMode: 'capture',
    synthesisMode: 'interactive',
    seedSignature: 'w1::a1::capture',
    currentBrief: 'Stored scout anchor',
    sourceSummary: 'Stored capture state.',
    feelingAnchor: {
      coreVibe: 'stored vigilance',
      tonePhrases: ['stored'],
      avoidVibe: ['stored avoid'],
    },
    workingMemory: {
      effectiveIntentSummary: 'Stored guide intent.',
      preserveFocus: ['Stored scout anchor'],
      adjustFocus: ['stored outfit'],
      negativeConstraints: ['stored forbidden'],
    },
    visualIntent: {
      visualRole: 'Stored scout anchor',
      silhouette: 'stored silhouette',
      outfit: 'stored outfit',
      hairstyle: 'stored hair',
      palettePrimary: 'stored palette',
      artStyle: 'Anchor portrait illustration with stable character readability.',
      mustKeepTraits: ['stored trait'],
      forbiddenTraits: ['stored forbidden'],
      detailBudget: 'hero',
      backgroundWeight: 'supporting',
    },
    messages: [],
    lastTextTraceId: 'stored-trace',
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    ...overrides,
  };
}

async function completeWorldStyleSession(user: ReturnType<typeof userEvent.setup>) {
  const answers = [
    'Keep the world grounded, readable, and role-first.',
    'Differences should come through costume hierarchy and identity cues.',
    'Use a restrained palette and keep backgrounds subordinate.',
    'Avoid extreme close-ups and noisy cinematic backdrops.',
  ];
  for (const answer of answers) {
    const replyField = screen.getByLabelText('Current reply');
    await user.clear(replyField);
    await user.type(replyField, answer);
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Current reply')).toHaveValue('');
    });
  }
  await user.click(screen.getByRole('button', { name: 'Synthesize style pack draft' }));
  await waitFor(() => {
    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
  });
}

describe('CreateBatchPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await initI18n();
    await changeLocale('en');
    mockRuntime.ai.text.generate.mockImplementation(async (input: { system?: string; prompt?: string; input?: string }) => {
      const language = String(input.prompt || input.input || '').includes('language: zh') ? 'zh' : 'en';
      const system = String(input.system || '');
      const prompt = String(input.prompt || input.input || '');
      const payload = system.includes('structured world style pack draft')
        || system.includes('结构化的 world style pack 草案')
        ? buildSynthesisPayload(language)
        : system.includes('silent single-agent capture state')
          || system.includes('静默版单角色 capture state')
          || system.includes('interactive capture refinement')
          || system.includes('重点角色执行 interactive capture refinement')
          ? buildCapturePayload(prompt, language)
          : buildDialoguePayload(language);
      return {
        text: JSON.stringify(payload),
        finishReason: 'stop',
        trace: { traceId: 'mock-style-trace' },
      };
    });
    useAppStore.setState({
      runtimeProbe: {
        realmConfigured: true,
        realmAuthenticated: true,
        textDefaultTargetKey: dialogueTarget.key,
        textConnectorId: dialogueTarget.connectorId,
        textModelId: dialogueTarget.modelId,
        imageDefaultTargetKey: generationTarget.key,
        imageConnectorId: generationTarget.connectorId,
        imageModelId: generationTarget.modelId,
        visionDefaultTargetKey: evaluationTarget.key,
        visionConnectorId: evaluationTarget.connectorId,
        visionModelId: evaluationTarget.modelId,
        textTargets: [dialogueTarget],
        imageTargets: [generationTarget],
        visionTargets: [evaluationTarget],
        issues: [],
      },
      routeSettingsOpen: false,
      routeSettings: {
        dialogueTargetKey: '',
        generationTargetKey: '',
        evaluationTargetKey: '',
      },
    });
    listLookdevWorlds.mockResolvedValue([
      { id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: 2 },
      { id: 'w2', name: 'Sunfall Yard', status: 'ACTIVE', agentCount: 1 },
    ]);
    listLookdevAgents.mockResolvedValue([
      { id: 'a1', handle: 'iris', displayName: 'Iris', concept: 'Anchor scout', worldId: 'w1', avatarUrl: null, importance: 'PRIMARY', status: 'READY' },
      { id: 'a2', handle: 'nora', displayName: 'Nora', concept: 'Clockwork guide', worldId: 'w1', avatarUrl: null, importance: 'SECONDARY', status: 'READY' },
      { id: 'a3', handle: 'sora', displayName: 'Sora', concept: 'Sunfall courier', worldId: 'w2', avatarUrl: null, importance: 'PRIMARY', status: 'READY' },
    ]);
    listLookdevWorldAgents.mockImplementation(async (worldId: string) => {
      if (worldId === 'w1') {
        return [
          { id: 'a1', handle: 'iris', displayName: 'Iris', concept: 'Anchor scout', worldId: 'w1', avatarUrl: null, importance: 'PRIMARY', status: 'READY' },
          { id: 'a2', handle: 'nora', displayName: 'Nora', concept: 'Clockwork guide', worldId: 'w1', avatarUrl: null, importance: 'SECONDARY', status: 'READY' },
        ];
      }
      if (worldId === 'w2') {
        return [
          { id: 'a3', handle: 'sora', displayName: 'Sora', concept: 'Sunfall courier', worldId: 'w2', avatarUrl: null, importance: 'PRIMARY', status: 'READY' },
        ];
      }
      return [];
    });
    getLookdevAgent.mockImplementation(async (agentId: string) => ({
      description: agentId === 'a2' ? 'Clockwork guide with patient posture.' : 'Anchor scout with a steady dockside silhouette.',
      scenario: null,
      greeting: null,
    }));
    getLookdevAgentTruthBundle.mockImplementation(async (worldId: string, agentId: string) => buildDefaultTruthBundle(worldId, agentId));
    getAgentPortraitBinding.mockResolvedValue(null);
  });

  it('rekeys the world-style workspace when the shell locale changes', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await user.type(screen.getByLabelText('Current reply'), 'Keep the lane grounded and readable.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => {
      expect(screen.getByText('I have the lane now. We can synthesize a draft style pack immediately, and you can still keep tightening any taboo or differentiation cue afterward.')).toBeInTheDocument();
    });

    mockRuntime.ai.text.generate.mockClear();
    await act(async () => {
      await changeLocale('zh');
    });

    await waitFor(() => {
      expect(screen.getByLabelText('当前回答')).toBeInTheDocument();
    });
    expect(screen.queryByText('I have the lane now. We can synthesize a draft style pack immediately, and you can still keep tightening any taboo or differentiation cue afterward.')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('当前回答'), '请把这条世界风格 lane 继续收紧一点。');
    await user.click(screen.getByRole('button', { name: '发送回答' }));

    await waitFor(() => {
      expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.stringContaining('language: zh'),
      }));
      expect(screen.getByText('我已经抓到这条 world lane 了。现在可以直接整理风格包草案；如果你还想继续收紧禁区或角色差异，也可以继续聊。')).toBeInTheDocument();
    });
  });

  it('reuses stored world style packs without mutating them on load', async () => {
    const { saveWorldStylePack } = seedWorkingState();
    const storedPack = {
      ...createConfirmedWorldStylePack('w1', 'Aurora Harbor', 'en'),
      name: 'Stored Aurora lane',
      paletteDirection: 'deep teal and brass',
      seedSource: 'style_session' as const,
      sourceSessionId: 'lookdev-style-session-stored',
    };

    useLookdevStore.setState({
      worldStylePacks: {
        w1: storedPack,
      },
      captureStates: {
        [createCaptureStateKey('w1', 'a1')]: makeStoredCaptureState({
          seedSignature: buildCaptureSeedSignature({
            agent: {
              id: 'a1',
              displayName: 'Iris',
              concept: 'Anchor scout',
              description: 'Anchor scout with a steady dockside silhouette.',
              worldId: 'w1',
              importance: 'PRIMARY',
              existingPortraitUrl: null,
            },
            worldStylePack: storedPack,
            captureMode: 'capture',
          }),
        }),
      },
      portraitBriefs: {
        'w1::a1': {
          agentId: 'a1',
          worldId: 'w1',
          displayName: 'Iris',
          visualRole: 'Stored scout anchor',
          silhouette: 'stored silhouette',
          outfit: 'stored outfit',
          hairstyle: 'stored hair',
          palettePrimary: 'stored palette',
          artStyle: storedPack.artStyle,
          mustKeepTraits: ['stored trait'],
          forbiddenTraits: ['stored forbidden'],
          sourceConfidence: 'derived_from_agent_truth',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
      },
    });

    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect(await screen.findByDisplayValue('Stored Aurora lane')).toBeInTheDocument();
    expect(screen.getByDisplayValue('deep teal and brass')).toBeInTheDocument();
    expect(screen.getByText('Confirmed style pack')).toBeInTheDocument();
    expect(saveWorldStylePack).not.toHaveBeenCalled();
  });

  it('ignores legacy stored packs that were not derived from a world style session', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    useLookdevStore.setState({
      worldStylePacks: {
        w1: {
          worldId: 'w1',
          name: 'Legacy Aurora lane',
          visualEra: 'legacy era',
          artStyle: 'legacy style',
          paletteDirection: 'legacy palette',
          materialDirection: 'legacy materials',
          silhouetteDirection: 'legacy silhouette',
          costumeDensity: 'legacy density',
          backgroundDirection: 'legacy background',
          promptFrame: 'legacy prompt frame',
          forbiddenElements: ['legacy forbidden'],
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          confirmedAt: '2026-03-28T00:00:00.000Z',
        } as unknown as LookdevWorldStylePack,
      },
    });

    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect(await screen.findByText('World Style Session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    expect(screen.queryByText('Confirmed style pack')).not.toBeInTheDocument();
  });
});
