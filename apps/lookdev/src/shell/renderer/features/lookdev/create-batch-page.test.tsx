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

vi.mock('@nimiplatform/nimi-kit/ui', async () => {
  const actual = await vi.importActual<typeof import('@nimiplatform/nimi-kit/ui')>('@nimiplatform/nimi-kit/ui');
  return {
    ...actual,
    SelectField: ({ options, value, placeholder, onValueChange, onChange, id, ...rest }: import('@nimiplatform/nimi-kit/ui').SelectFieldProps) => (
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

  it('creates a world-scoped batch with capture selection applied', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await user.type(screen.getByLabelText('Batch name'), 'Night market refresh');
    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect(await screen.findByText('World Style Session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    expect(screen.getByText('Confirm the world style pack first. Capture selection only opens after the style lane is explicitly confirmed.')).toBeInTheDocument();

    await completeWorldStyleSession(user);
    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    expect(screen.getAllByText('Iris').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nora').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Capture').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Batch only').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Nora.*Batch only/i }));
    await user.click(screen.getByRole('button', { name: /Nora.*Review/i }));

    expect(await screen.findByText('Embedded Capture')).toBeInTheDocument();
    expect(screen.getByLabelText('Visual role')).toHaveValue('Clockwork guide');

    await user.click(screen.getByRole('button', { name: 'Create and start processing' }));

    await waitFor(() => {
      expect(createBatch).toHaveBeenCalledTimes(1);
    });

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Night market refresh',
      selectionSource: 'by_world',
      worldId: 'w1',
      captureSelectionAgentIds: ['a1', 'a2'],
      generationTarget: expectedGenerationTarget,
      evaluationTarget: expectedEvaluationTarget,
      worldStylePack: expect.objectContaining({
        worldId: 'w1',
        name: 'Aurora Harbor portrait style pack',
        status: 'confirmed',
      }),
    }));
  }, 30000);

  it('keeps world-scoped agents in the batch when truth falls back to a limited lane', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    getLookdevAgentTruthBundle.mockImplementation(async (worldId: string, agentId: string) => {
      if (agentId === 'a2') {
        throw new Error('LOOKDEV_AGENT_TRUTH_UNREADABLE');
      }
      return {
        description: 'Anchor scout with a steady dockside silhouette.',
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
    });

    renderCreatePage();

    await user.type(screen.getByLabelText('Batch name'), 'Filtered cast batch');
    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect(await screen.findByText("1 agents in this world batch only have limited portrait truth available. Lookdev will still use each agent's available fields together with the current world style lane: Nora.")).toBeInTheDocument();

    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Create and start processing' }));

    await waitFor(() => {
      expect(createBatch).toHaveBeenCalledTimes(1);
    });

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      agents: [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' })],
      captureSelectionAgentIds: ['a1'],
    }));
  }, 30000);

  it('keeps the world-style lane focused on authoring before a world is selected', async () => {
    seedWorkingState();
    renderCreatePage();

    expect(await screen.findByText('World Style Session')).toBeInTheDocument();
    expect(screen.getByText('Pick a world first and this lane\'s style conversation will expand below.')).toBeInTheDocument();
    expect(screen.queryByText('World Style Session reads the current dialogue route from Route Settings. The route there controls which connector + model understand the conversation and synthesize the style-pack draft.')).not.toBeInTheDocument();
  });

  it('localizes world option counts with the current shell locale', async () => {
    seedWorkingState();
    await act(async () => {
      await changeLocale('zh');
    });
    renderCreatePage();

    expect(await screen.findByRole('option', { name: 'Aurora Harbor · 2 个角色' })).toBeInTheDocument();
  });

  it('uses the current shell dialogue route for world-style authoring', async () => {
    seedWorkingState();
    useAppStore.setState((state) => ({
      runtimeProbe: {
        ...state.runtimeProbe,
        textDefaultTargetKey: dialogueTarget.key,
        textConnectorId: dialogueTarget.connectorId,
        textModelId: dialogueTarget.modelId,
        textTargets: [dialogueTarget, alternateDialogueTarget],
      },
      runtimeDefaults: {
        ...(state.runtimeDefaults || {
          realm: {
            realmBaseUrl: 'http://localhost:3002',
            realtimeUrl: '',
            accessToken: '',
            jwksUrl: 'http://localhost:3002/api/auth/jwks',
            jwtIssuer: 'http://localhost:3002',
            jwtAudience: 'nimi-runtime',
          },
          runtime: {
            localProviderEndpoint: 'http://127.0.0.1:1234/v1',
            localProviderModel: 'local-model',
            localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
            connectorId: '',
            targetType: 'AGENT',
            targetAccountId: '',
            agentId: '',
            worldId: '',
            provider: '',
            userConfirmedUpload: false,
          },
        }),
        runtime: {
          ...(state.runtimeDefaults?.runtime || {
            localProviderEndpoint: 'http://127.0.0.1:1234/v1',
            localProviderModel: 'local-model',
            localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
            connectorId: '',
            targetType: 'AGENT',
            targetAccountId: '',
            agentId: '',
            worldId: '',
            provider: '',
            userConfirmedUpload: false,
          }),
          connectorId: 'api-connector',
          provider: 'gemini',
        },
      },
    }));
    useAppStore.getState().setDialogueTargetKey(alternateDialogueTarget.key);
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect(screen.getAllByText(formatRuntimeTargetLabel(alternateDialogueTarget)).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Current reply'), 'Keep the lane grounded, stable, and readable.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => {
      expect(mockRuntime.ai.text.generate).toHaveBeenCalledWith(expect.objectContaining({
        model: alternateDialogueTarget.modelId,
        connectorId: alternateDialogueTarget.connectorId,
      }));
    });
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

  it('edits style pack, embedded capture brief, and policy snapshot before create', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await user.type(screen.getByLabelText('Batch name'), 'Policy tuned batch');
    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    fireEvent.change(screen.getByLabelText('Style pack name'), { target: { value: 'Aurora tuned lane' } });
    fireEvent.change(screen.getByLabelText('Visual era'), { target: { value: 'retro-futurist harbor noir' } });
    fireEvent.change(screen.getByLabelText('Art style'), { target: { value: 'graphic novel portrait realism' } });
    fireEvent.change(screen.getByLabelText('Palette direction'), { target: { value: 'teal, amber, midnight blue' } });
    fireEvent.change(screen.getByLabelText('Silhouette direction'), { target: { value: 'long coats, clear shoulder lines' } });

    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    fireEvent.change(screen.getByLabelText('Visual role'), { target: { value: 'Lead harbor scout' } });
    fireEvent.change(screen.getByLabelText('Silhouette'), { target: { value: 'full-body dockside silhouette' } });
    fireEvent.change(screen.getByLabelText('Outfit'), { target: { value: 'weatherproof scout coat' } });
    fireEvent.change(screen.getByLabelText('Hairstyle'), { target: { value: 'windswept bob' } });
    fireEvent.change(screen.getByLabelText('Palette'), { target: { value: 'teal and amber' } });
    fireEvent.change(screen.getByLabelText('Must keep traits'), { target: { value: 'steady gaze, scout posture' } });
    fireEvent.change(screen.getByLabelText('Forbidden traits'), { target: { value: 'extreme close-up, heavy blur' } });

    fireEvent.change(screen.getByLabelText('Auto-eval score threshold'), { target: { value: '84' } });
    fireEvent.change(screen.getByLabelText('Max concurrency'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Create and start processing' }));

    await waitFor(() => {
      expect(createBatch).toHaveBeenCalledTimes(1);
    });

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      scoreThreshold: 84,
      maxConcurrency: 2,
      generationTarget: expectedGenerationTarget,
      evaluationTarget: expectedEvaluationTarget,
      worldStylePack: expect.objectContaining({
        name: 'Aurora tuned lane',
        visualEra: 'retro-futurist harbor noir',
        artStyle: 'graphic novel portrait realism',
        paletteDirection: 'teal, amber, midnight blue',
        silhouetteDirection: 'long coats, clear shoulder lines',
      }),
    }));

    expect(useLookdevStore.getState().portraitBriefs['w1::a1']).toEqual(expect.objectContaining({
      visualRole: 'Lead harbor scout',
      silhouette: 'full-body dockside silhouette',
      outfit: 'weatherproof scout coat',
      hairstyle: 'windswept bob',
      palettePrimary: 'teal and amber',
      mustKeepTraits: ['steady gaze', 'scout posture'],
      forbiddenTraits: ['extreme close-up', 'heavy blur'],
    }));
  }, 15000);

  it('shows embedded capture empty state when the user clears capture selection', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    await user.click(screen.getByRole('button', { name: /PRIMARY.*iris.*Capture/i }));

    expect(await screen.findByText('This agent stays on the silent capture lane. Lookdev still synthesizes a role-aware capture state, but it does not open a detailed operator conversation by default.')).toBeInTheDocument();
    expect(screen.getByLabelText('Visual role')).toHaveValue('Anchor scout');
    expect(screen.queryByRole('button', { name: 'Refine capture' })).not.toBeInTheDocument();
  }, 15000);

  it('shows an error when creating a batch without any selected agents', async () => {
    const { createBatch } = seedWorkingState();
    renderCreatePage();

    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('fails closed when a selected world cannot resolve a controllable cast', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    listLookdevWorldAgents.mockResolvedValueOnce([]);
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect((await screen.findAllByText('Lookdev could not resolve a controllable cast for Aurora Harbor. Pick a world you can operate on or refresh runtime and try again.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Send reply' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('keeps world-style authoring available when a selected world only has limited truth', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    getLookdevAgentTruthBundle.mockRejectedValue(new Error('LOOKDEV_AGENT_TRUTH_UNREADABLE'));
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect(await screen.findByText("2 agents in this world batch only have limited portrait truth available. Lookdev will still use each agent's available fields together with the current world style lane: Iris, Nora.")).toBeInTheDocument();
    expect(screen.queryByText('Lookdev could not resolve a controllable cast for Aurora Harbor. Pick a world you can operate on or refresh runtime and try again.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Synthesize style pack draft' })).toBeInTheDocument();
  });

  it('blocks world-style authoring when explicit selection spans multiple worlds', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris/i }));
    await user.click(screen.getByRole('button', { name: /Sora/i }));

    expect((await screen.findAllByText('Selected agents currently span multiple worlds. Narrow to one world before creating a batch.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Send reply' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
  });

  it('keeps explicitly selected agents in the batch when truth falls back to a limited lane', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    getLookdevAgentTruthBundle.mockImplementation(async (worldId: string, agentId: string) => {
      if (agentId === 'a2') {
        throw new Error('LOOKDEV_AGENT_TRUTH_UNREADABLE');
      }
      return {
        description: 'Anchor scout with a steady dockside silhouette.',
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
    });

    renderCreatePage();

    await screen.findByLabelText('World');
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris.*Select/i }));
    await user.click(screen.getByRole('button', { name: /Nora.*Select/i }));

    expect(await screen.findByText("1 selected agents only have limited portrait truth available. Lookdev will still use each agent's available fields together with the current world style lane: Nora.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nora.*Limited truth/i })).toBeInTheDocument();

    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Create and start processing' }));

    await waitFor(() => {
      expect(createBatch).toHaveBeenCalledTimes(1);
    });

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      agents: [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' })],
      captureSelectionAgentIds: ['a1'],
    }));
  }, 30000);

  it('shows intake loading state and disables batch creation until intake resolves', () => {
    seedWorkingState();
    listLookdevWorlds.mockImplementation(() => new Promise(() => {}));
    listLookdevAgents.mockImplementation(() => new Promise(() => {}));

    renderCreatePage();

    expect(screen.getByText('Loading world and agent intake data before batch freeze…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
  });

  it('shows intake error state and blocks create when intake queries fail', async () => {
    seedWorkingState();
    listLookdevWorlds.mockRejectedValueOnce(new Error('world intake failed'));
    listLookdevAgents.mockRejectedValueOnce(new Error('agent intake failed'));

    renderCreatePage();

    await waitFor(() => {
      expect(screen.getByText('Lookdev could not load the current world or agent intake data. Refresh runtime and try again.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
  });

  it('does not render a fake zero agent count when control-scoped world summaries omit agentCount', async () => {
    seedWorkingState();
    listLookdevWorlds.mockResolvedValueOnce([
      { id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: null },
    ]);

    renderCreatePage();

    await screen.findByLabelText('World');
    fireEvent.pointerDown(screen.getByLabelText('World'), { button: 0, ctrlKey: false });
    expect(await screen.findByRole('option', { name: 'Aurora Harbor' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Aurora Harbor · 0 agents/i })).not.toBeInTheDocument();
  });

  it('supports switching back to world-scoped mode and editing a secondary capture brief', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris.*Select/i }));
    await user.click(screen.getByRole('button', { name: /World-scoped selection/i }));
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));
    await user.click(screen.getByRole('button', { name: /Nora.*Batch only/i }));
    await user.click(screen.getByRole('button', { name: /Nora.*Review/i }));

    expect(await screen.findByLabelText('Visual role')).toHaveValue('Clockwork guide');

    fireEvent.change(screen.getByLabelText('Visual role'), { target: { value: 'Clocktower guide' } });

    expect(useLookdevStore.getState().portraitBriefs['w1::a2']).toEqual(expect.objectContaining({
      visualRole: 'Clocktower guide',
    }));
  }, 30000);

  it('keeps interactive capture drafts isolated per agent', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));
    await user.click(screen.getByRole('button', { name: /Nora.*Batch only/i }));
    await user.click(screen.getByRole('button', { name: /Nora.*Review/i }));

    const refineField = await screen.findByPlaceholderText('Describe what to preserve, what to push, and where this role should move next.');
    await user.type(refineField, 'Keep Nora measured and orderly.');

    await user.click(screen.getByRole('button', { name: /Iris.*Review/i }));
    const irisRefineField = await screen.findByPlaceholderText('Describe what to preserve, what to push, and where this role should move next.');
    expect(irisRefineField).toHaveValue('');

    await user.type(irisRefineField, 'Keep Iris grounded and watchful.');
    await user.click(screen.getByRole('button', { name: /Nora.*Review/i }));

    expect(await screen.findByPlaceholderText('Describe what to preserve, what to push, and where this role should move next.')).toHaveValue('Keep Nora measured and orderly.');
  }, 15000);

  it('clears interactive capture errors when the operator edits the current draft', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    mockRuntime.ai.text.generate.mockRejectedValueOnce(new Error('LOOKDEV_CAPTURE_REFINE_FAILED'));
    const refineField = await screen.findByPlaceholderText('Describe what to preserve, what to push, and where this role should move next.');
    await user.type(refineField, 'Push Iris a little closer to duty-first restraint.');
    await user.click(screen.getByRole('button', { name: 'Refine capture' }));

    expect(await screen.findByText('LOOKDEV_CAPTURE_REFINE_FAILED')).toBeInTheDocument();

    await user.type(refineField, ' More restraint.');

    await waitFor(() => {
      expect(screen.queryByText('LOOKDEV_CAPTURE_REFINE_FAILED')).not.toBeInTheDocument();
    });
  }, 15000);

  it('resets interactive capture back to the initial synthesized state for the active agent', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    mockRuntime.ai.text.generate.mockImplementation(async (input: { system?: string; prompt?: string; input?: string }) => {
      const language = String(input.prompt || input.input || '').includes('language: zh') ? 'zh' : 'en';
      const system = String(input.system || '');
      const prompt = String(input.prompt || input.input || '');
      if (system.includes('interactive capture refinement') || system.includes('重点角色执行 interactive capture refinement')) {
        const base = buildCapturePayload(prompt, language);
        return {
          text: JSON.stringify({
            ...base,
            assistantReply: 'Push the face structure closer to a human attendant while keeping the lane clean.',
            currentBrief: 'Anchor attendant leans more human in face structure while staying lane-clean.',
            visualIntent: {
              ...base.visualIntent,
              visualRole: 'Anchor attendant',
              hairstyle: 'soft human-like cranial contour',
            },
          }),
          finishReason: 'stop',
          trace: { traceId: 'mock-refine-trace' },
        };
      }
      if (
        system.includes('silent single-agent capture state')
        || system.includes('静默版单角色 capture state')
      ) {
        return {
          text: JSON.stringify(buildCapturePayload(prompt, language)),
          finishReason: 'stop',
          trace: { traceId: 'mock-silent-trace' },
        };
      }
      const payload = system.includes('structured world style pack draft')
        || system.includes('结构化的 world style pack 草案')
        ? buildSynthesisPayload(language)
        : buildDialoguePayload(language);
      return {
        text: JSON.stringify(payload),
        finishReason: 'stop',
        trace: { traceId: 'mock-style-trace' },
      };
    });
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    const refineField = await screen.findByPlaceholderText('Describe what to preserve, what to push, and where this role should move next.');
    await user.type(refineField, 'Make Iris feel a little more human in the face.');
    await user.click(screen.getByRole('button', { name: 'Refine capture' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Visual role')).toHaveValue('Anchor attendant');
    });
    expect(screen.getByText('Push the face structure closer to a human attendant while keeping the lane clean.')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Describe what to preserve, what to push, and where this role should move next.'), ' Unsubmitted note.');
    await user.click(screen.getByRole('button', { name: 'Reset capture' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Visual role')).toHaveValue('Anchor scout');
    });
    expect(screen.queryByText('Push the face structure closer to a human attendant while keeping the lane clean.')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe what to preserve, what to push, and where this role should move next.')).toHaveValue('');
  }, 15000);

  it('keeps a manually removed primary agent out of capture when selection changes later', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris.*Select/i }));
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));
    await user.click(screen.getByRole('button', { name: /Iris.*Capture/i }));

    expect(await screen.findByRole('button', { name: /Iris.*Batch only/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Nora.*Select/i }));

    expect(screen.getByRole('button', { name: /Iris.*Batch only/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Iris.*Capture/i })).not.toBeInTheDocument();
  }, 15000);

  it('blocks explicit selection batches that span multiple worlds', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris.*In batch|Iris.*Select/i }));
    await user.click(screen.getByRole('button', { name: /Sora.*In batch|Sora.*Select/i }));

    expect((await screen.findAllByText('Selected agents currently span multiple worlds. Narrow to one world before creating a batch.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
    expect(createBatch).not.toHaveBeenCalled();
  }, 15000);

  it('returns a confirmed style pack to draft when the operator edits it later', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    expect(screen.getByText('Confirmed style pack')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Aurora Harbor portrait style pack'), { target: { value: 'Aurora operator lane' } });

    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm style pack' })).toBeInTheDocument();
    expect(screen.getByText('Confirm the world style pack first. Capture selection only opens after the style lane is explicitly confirmed.')).toBeInTheDocument();
  }, 15000);

  it('fails closed when no text.generate dialogue target is available', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    useAppStore.setState({
      runtimeProbe: {
        realmConfigured: true,
        realmAuthenticated: true,
        textDefaultTargetKey: undefined,
        textConnectorId: undefined,
        textModelId: undefined,
        imageDefaultTargetKey: generationTarget.key,
        imageConnectorId: generationTarget.connectorId,
        imageModelId: generationTarget.modelId,
        visionDefaultTargetKey: evaluationTarget.key,
        visionConnectorId: evaluationTarget.connectorId,
        visionModelId: evaluationTarget.modelId,
        textTargets: [],
        imageTargets: [generationTarget],
        visionTargets: [evaluationTarget],
        issues: ['No text.generate target is currently available.'],
      },
    });

    renderCreatePage();

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', /Aurora Harbor/i);

    expect(await screen.findByText('World Style Session needs an available dialogue route from Route Settings before it can run.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Synthesize style pack draft' })).toBeDisabled();
  });

});
