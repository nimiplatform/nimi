import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { changeLocale, initI18n } from '@renderer/i18n/index.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from './lookdev-store.js';
import CreateBatchPage from './create-batch-page.js';
import BatchListPage from './batch-list-page.js';
import BatchDetailPage from './batch-detail-page.js';
import { compilePortraitBrief } from './prompting.js';
import { createConfirmedWorldStylePack, createDefaultPolicySnapshot, type LookdevAgentImportance, type LookdevBatch, type LookdevCaptureState, type LookdevItem, type LookdevPortraitBrief, type LookdevWorldStylePack } from './types.js';

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
  getLookdevAgent: vi.fn(async (_agentId: string) => ({
    description: 'Anchor scout with a steady dockside silhouette.',
    scenario: null,
    greeting: null,
  })),
  getLookdevAgentTruthBundle: vi.fn(async (_worldId: string, _agentId: string) => ({
    description: 'Anchor scout with a steady dockside silhouette.',
    scenario: null,
    greeting: null,
    wakeStrategy: 'PASSIVE',
    dna: {
      identity: { role: 'Harbor scout', worldview: null, species: null, summary: null },
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

type RealWorld = {
  id: string;
  name: string;
  status: string;
  agentCount: number;
};

type RealAgent = {
  id: string;
  handle: string;
  displayName: string;
  concept: string;
  worldId: string;
  avatarUrl: string | null;
  importance: LookdevAgentImportance;
  status: string;
};

type RealFixture = {
  token: string;
  worlds: RealWorld[];
  activeWorld: RealWorld;
  cast: RealAgent[];
  primaryAgents: RealAgent[];
};

const maybeDescribe = process.env.LOOKDEV_REAL_SMOKE === '1' ? describe : describe.skip;
let realFixture: RealFixture;

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

function buildDialoguePayload(language: 'en' | 'zh') {
  if (language === 'zh') {
    return {
      assistantReply: '方向已经够清楚了。现在可以先整理风格包草案，如果你还想继续补门派感或禁区，也可以继续聊。',
      readiness: 'ready_to_synthesize',
      readinessReason: '世界气质、人物差异和画面控制都已经足够稳定，可以先整理草案。',
      summary: '人物锚点肖像整体克制写实，主要靠服装层级与身份气场拉开差异，背景始终退后服务角色识别。',
      understanding: {
        tone: '克制写实，强调身份与世界一致性。',
        differentiation: '服装层级、身份气场和材质差异共同承担人物区分。',
        palette: '配色收敛，背景退后，镜头稳定服务人物识别。',
        forbidden: '不要极端近景、夸张动作和喧宾夺主的背景。',
      },
      openQuestions: [],
    };
  }
  return {
    assistantReply: 'The lane is already coherent. We can synthesize a draft now, and you can still keep tightening any taboo or differentiation cue afterward.',
    readiness: 'ready_to_synthesize',
    readinessReason: 'Tone, differentiation, and control principles are already stable enough to synthesize a draft.',
    summary: 'Anchor portraits should stay grounded and role-first, with costume hierarchy doing most of the differentiation while palette and background remain restrained.',
    understanding: {
      tone: 'Grounded, role-first realism with stable world identity.',
      differentiation: 'Costume hierarchy, identity cues, and restrained material contrast.',
      palette: 'Restrained palette with subdued backgrounds and stable camera control.',
      forbidden: 'No extreme close-ups or noisy cinematic backdrops.',
    },
    openQuestions: [],
  };
}

function buildSynthesisPayload(language: 'en' | 'zh') {
  if (language === 'zh') {
    return {
      name: `${realFixture?.activeWorld?.name || 'Real'} 肖像风格包`,
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
    name: `${realFixture?.activeWorld?.name || 'Real'} portrait style pack`,
    summary: 'Anchor portraits stay grounded and role-first, with costume hierarchy carrying differentiation while palette and background remain restrained.',
    visualEra: 'Grounded world identity with restrained realism.',
    artStyle: 'Anchor portrait illustration with stable character readability.',
    paletteDirection: 'Restrained palette direction with subdued backgrounds.',
    materialDirection: 'Material language serves role hierarchy rather than decorative noise.',
    silhouetteDirection: 'Clean full-body silhouettes with clear costume structure.',
    costumeDensity: 'Moderate complexity that serves role identity first.',
    backgroundDirection: 'Backgrounds stay atmospheric but subordinate to character readability.',
    promptFrame: 'full-body character anchor portrait, fixed focal length, stable eye-level camera, subdued background',
    forbiddenElements: ['extreme close-up', 'dramatic action pose', 'busy cinematic background'],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function renderWithProviders(element: React.ReactNode, initialEntries: string[] = ['/']) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        {element}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function loginForRealSmoke(): Promise<string> {
  if (process.env.LOOKDEV_REAL_SMOKE_ACCESS_TOKEN) {
    return process.env.LOOKDEV_REAL_SMOKE_ACCESS_TOKEN;
  }
  const identifier = process.env.LOOKDEV_REAL_SMOKE_EMAIL ?? 'test@nimi.xyz';
  const password = process.env.LOOKDEV_REAL_SMOKE_PASSWORD ?? 'test123';
  const response = await fetch('http://localhost:3002/api/auth/password/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ identifier, password }),
  });
  if (!response.ok) {
    throw new Error(`LOOKDEV_REAL_SMOKE_LOGIN_FAILED:${response.status}`);
  }
  const payload = await response.json() as { tokens?: { accessToken?: string } };
  const token = String(payload.tokens?.accessToken || '').trim();
  if (!token) {
    throw new Error('LOOKDEV_REAL_SMOKE_TOKEN_MISSING');
  }
  return token;
}

async function fetchJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`http://localhost:3002${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`LOOKDEV_REAL_SMOKE_FETCH_FAILED:${path}:${response.status}`);
  }
  return await response.json() as T;
}

function normalizeRealAgent(worldId: string, value: Record<string, unknown>): RealAgent {
  const id = String(value.id || value.agentId || '').trim();
  const handle = String(value.handle || id).trim();
  return {
    id,
    handle,
    displayName: String(value.displayName || value.name || handle || id).trim() || id,
    concept: String(value.concept || value.bio || '').trim(),
    worldId,
    avatarUrl: value.avatarUrl ? String(value.avatarUrl) : null,
    importance: String(value.importance || 'UNKNOWN').trim().toUpperCase() as LookdevAgentImportance,
    status: String(value.status || value.state || 'UNKNOWN').trim() || 'UNKNOWN',
  };
}

function seedCreateBatchStore() {
  const createBatch = vi.fn(async () => 'real-batch-1');
  const saveWorldStylePack = vi.fn((pack: LookdevWorldStylePack) => {
    useLookdevStore.setState((state) => ({
      worldStylePacks: {
        ...state.worldStylePacks,
        [pack.worldId]: pack,
      },
    }));
  });
  const savePortraitBrief = vi.fn((brief) => {
    useLookdevStore.setState((state) => ({
      portraitBriefs: {
        ...state.portraitBriefs,
        [`${String((brief as LookdevPortraitBrief).worldId || 'unscoped').trim() || 'unscoped'}::${(brief as LookdevPortraitBrief).agentId}`]: brief as LookdevPortraitBrief,
      },
    }));
  });
  useLookdevStore.setState({
    createBatch,
    worldStyleSessions: {},
    saveWorldStylePack,
    savePortraitBrief,
    batches: [],
    worldStylePacks: {},
    portraitBriefs: {},
  });
  return { createBatch };
}

async function completeWorldStyleSession(
  user: ReturnType<typeof userEvent.setup>,
  input: {
    replyLabel: string;
    sendReplyLabel: string;
    synthesizeLabel: string;
    answers: string[];
  },
) {
  const { replyLabel, sendReplyLabel, synthesizeLabel, answers } = input;
  for (const answer of answers) {
    await user.type(screen.getByLabelText(replyLabel), answer);
    await user.click(screen.getByRole('button', { name: sendReplyLabel }));
  }
  await user.click(screen.getByRole('button', { name: synthesizeLabel }));
}

function makeRealDataBatch(): LookdevBatch {
  const worldStylePack = createConfirmedWorldStylePack(realFixture.activeWorld.id, realFixture.activeWorld.name, 'zh');
  const agents = realFixture.cast.slice(0, 2);
  const items: LookdevItem[] = agents.map((agent, index) => {
    const captureStateSnapshot: LookdevCaptureState = {
      agentId: agent.id,
      worldId: agent.worldId,
      displayName: agent.displayName,
      sourceConfidence: 'derived_from_agent_truth',
      captureMode: index === 0 ? 'capture' : 'batch_only',
      synthesisMode: index === 0 ? 'interactive' : 'silent',
      seedSignature: `real-${agent.id}`,
      currentBrief: `${agent.displayName} stays readable in the ${worldStylePack.name} lane.`,
      sourceSummary: 'Derived from fixture Realm truth and the current world style lane.',
      feelingAnchor: {
        coreVibe: 'grounded clarity',
        tonePhrases: ['readable silhouette'],
        avoidVibe: ['cinematic noise'],
      },
      workingMemory: {
        effectiveIntentSummary: 'Keep the role world-aligned and production-ready.',
        preserveFocus: [agent.concept],
        adjustFocus: [],
        negativeConstraints: ['extreme close-up'],
      },
      visualIntent: {
        visualRole: agent.concept || agent.displayName,
        silhouette: worldStylePack.silhouetteDirection,
        outfit: 'role-aligned costume silhouette',
        hairstyle: 'clean readable hairstyle',
        palettePrimary: worldStylePack.paletteDirection,
        artStyle: worldStylePack.artStyle,
        mustKeepTraits: [agent.concept].filter(Boolean),
        forbiddenTraits: [...worldStylePack.forbiddenElements],
        detailBudget: index === 0 ? 'hero' : 'standard',
        backgroundWeight: 'supporting',
      },
      messages: [],
      lastTextTraceId: 'real-capture-trace',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    };
    return {
      itemId: `real-item-${index + 1}`,
      batchId: 'real-batch',
      agentId: agent.id,
      agentHandle: agent.handle,
      agentDisplayName: agent.displayName,
      agentConcept: agent.concept,
      agentDescription: null,
      importance: agent.importance,
      captureMode: index === 0 ? 'capture' : 'batch_only',
      captureStateSnapshot,
      portraitBrief: compilePortraitBrief({
        agentId: agent.id,
        displayName: agent.displayName,
        worldId: agent.worldId,
        concept: agent.concept,
        description: null,
        worldStylePack,
      }),
      worldId: agent.worldId,
      status: index === 0 ? 'auto_passed' : 'auto_failed_retryable',
      attemptCount: 1,
      currentImage: null,
      currentEvaluation: index === 0
        ? {
          passed: true,
          score: 87,
          checks: [{ key: 'fullBody', passed: true, kind: 'hard_gate' }],
          summary: 'Real cast anchor passed.',
          failureReasons: [],
        }
        : {
          passed: false,
          score: 61,
          checks: [{ key: 'fullBody', passed: false, kind: 'hard_gate' }],
          summary: 'Needs rerun.',
          failureReasons: ['Keep full-body framing stable.'],
        },
      lastErrorCode: index === 0 ? null : 'REAL_SMOKE_RERUN',
      lastErrorMessage: index === 0 ? null : 'Keep full-body framing stable.',
      correctionHints: [],
      existingPortraitUrl: null,
      referenceImageUrl: null,
      committedAt: null,
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    };
  });

  return {
    batchId: 'real-batch',
    name: `Real smoke ${realFixture.activeWorld.name}`,
    status: 'processing_complete',
    selectionSnapshot: {
      selectionSource: 'by_world',
      agentIds: items.map((item) => item.agentId),
      captureSelectionAgentIds: items.filter((item) => item.captureMode === 'capture').map((item) => item.agentId),
      worldId: realFixture.activeWorld.id,
    },
    worldStylePackSnapshot: worldStylePack,
    policySnapshot: createDefaultPolicySnapshot({
      generationTarget,
      evaluationTarget,
    }),
    totalItems: items.length,
    captureSelectedItems: 1,
    passedItems: 1,
    failedItems: 1,
    committedItems: 0,
    commitFailedItems: 0,
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    processingCompletedAt: '2026-03-29T00:02:00.000Z',
    commitCompletedAt: null,
    selectedItemId: items[0]?.itemId || null,
    auditTrail: [{
      eventId: 'audit-real-created',
      batchId: 'real-batch',
      occurredAt: '2026-03-29T00:00:00.000Z',
      kind: 'batch_created',
      scope: 'batch',
      severity: 'info',
      detail: realFixture.activeWorld.name,
    }],
    items,
  };
}

maybeDescribe('Lookdev real-data smoke', () => {
  beforeAll(async () => {
    await initI18n();
    await changeLocale('en');
    const token = await loginForRealSmoke();
    const access = await fetchJson<{
      hasActiveAccess: boolean;
      canMaintainWorld: boolean;
      records: Array<{ scopeWorldId?: string | null }>;
    }>('/api/world-control/access/me', token);
    if (!access.hasActiveAccess || !access.canMaintainWorld) {
      throw new Error('LOOKDEV_REAL_SMOKE_NO_MAINTAIN_ACCESS');
    }
    const myWorldsPayload = await fetchJson<{ items?: Array<Record<string, unknown>> }>('/api/worlds/mine', token);
    const worlds = await Promise.all((myWorldsPayload.items || []).map(async (item) => {
      const id = String(item.id || '').trim();
      const name = String(item.name || id || 'Untitled World').trim();
      const cast = await fetchJson<Array<Record<string, unknown>>>(`/api/world/by-id/${id}/agents`, token);
      return {
        id,
        name,
        status: String(item.status || '').trim() || 'ACTIVE',
        agentCount: cast.length,
      };
    }));
    const activeWorld = worlds.find((world) => world.agentCount > 0);
    if (!activeWorld) {
      throw new Error('LOOKDEV_REAL_SMOKE_NO_NONEMPTY_WORLD');
    }
    const rawCast = await fetchJson<Array<Record<string, unknown>>>(`/api/world/by-id/${activeWorld.id}/agents`, token);
    const cast = rawCast.map((item) => normalizeRealAgent(activeWorld.id, item));
    const primaryAgents = cast.filter((agent) => agent.importance === 'PRIMARY');
    if (primaryAgents.length === 0) {
      throw new Error('LOOKDEV_REAL_SMOKE_NO_PRIMARY_AGENTS');
    }
    realFixture = {
      token,
      worlds,
      activeWorld,
      cast,
      primaryAgents,
    };
  }, 30000);

  beforeEach(async () => {
    localStorage.clear();
    await changeLocale('en');
    mockRuntime.ai.text.generate.mockImplementation(async (input: { system?: string; prompt?: string; input?: string }) => {
      const payload = String(input.system || '').includes('structured world style pack draft')
        || String(input.system || '').includes('结构化的 world style pack 草案')
        ? buildSynthesisPayload(String(input.prompt || input.input || '').includes('language: zh') ? 'zh' : 'en')
        : buildDialoguePayload(String(input.prompt || input.input || '').includes('language: zh') ? 'zh' : 'en');
      return {
        text: JSON.stringify(payload),
        finishReason: 'stop',
        trace: { traceId: 'real-style-trace' },
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
    });
    listLookdevWorlds.mockResolvedValue(realFixture.worlds);
    listLookdevAgents.mockResolvedValue(realFixture.cast);
    listLookdevWorldAgents.mockImplementation(async (worldId: string) => (
      worldId === realFixture.activeWorld.id ? realFixture.cast : []
    ));
    useLookdevStore.setState({
      batches: [],
      worldStyleSessions: {},
      worldStylePacks: {},
      portraitBriefs: {},
    });
  });

  it('drives the real-data create-batch flow up to pre-generation submit', async () => {
    const { createBatch } = seedCreateBatchStore();
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/batches/new" element={<CreateBatchPage />} />
        <Route path="/batches/:batchId" element={<div>detail page</div>} />
      </Routes>,
      ['/batches/new'],
    );

    await user.type(screen.getByLabelText('Batch name'), 'Real smoke batch');
    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', new RegExp(escapeRegExp(realFixture.activeWorld.name), 'i'));

    expect(await screen.findByText('World Style Session')).toBeInTheDocument();
    expect(screen.getByText(`Frozen selection preview: ${realFixture.cast.length} agents from ${realFixture.activeWorld.name}.`)).toBeInTheDocument();
    await completeWorldStyleSession(user, {
      replyLabel: 'Current reply',
      sendReplyLabel: 'Send reply',
      synthesizeLabel: 'Synthesize style pack draft',
      answers: [
        'Keep the lane grounded and role-first.',
        'Differentiate characters through costume hierarchy and role identity.',
        'Use restrained palette control and subordinate backgrounds.',
        'Avoid extreme close-ups and noisy cinematic backdrops.',
      ],
    });
    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    const firstPrimary = realFixture.primaryAgents[0]!;
    const firstPrimaryName = firstPrimary.displayName;
    const primaryCaptureButton = await screen.findByRole('button', {
      name: new RegExp(`${escapeRegExp(firstPrimaryName)}.*Capture`, 'i'),
    });
    await user.click(primaryCaptureButton);
    expect(await screen.findByRole('button', {
      name: new RegExp(`${escapeRegExp(firstPrimaryName)}.*Batch only`, 'i'),
    })).toBeInTheDocument();

    const reviewButton = screen.getAllByRole('button', { name: /Review/i })[0]!;
    await user.click(reviewButton);

    const roleInput = screen.getByLabelText('Visual role');
    fireEvent.change(roleInput, { target: { value: 'Real smoke tuned role' } });
    expect(screen.getByDisplayValue('Real smoke tuned role')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create and start processing' }));

    await waitFor(() => {
      expect(createBatch).toHaveBeenCalledTimes(1);
    });
    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      worldId: realFixture.activeWorld.id,
      generationTarget,
      evaluationTarget,
      agents: expect.arrayContaining([
        expect.objectContaining({ id: realFixture.cast[0]!.id }),
      ]),
      captureSelectionAgentIds: expect.not.arrayContaining([firstPrimary.id]),
    }));
  }, 30000);

  it('synthesizes a zh world style pack from real data without leaking legacy english defaults', async () => {
    const user = userEvent.setup();
    await changeLocale('zh');

    renderWithProviders(
      <Routes>
        <Route path="/batches/new" element={<CreateBatchPage />} />
      </Routes>,
      ['/batches/new'],
    );

    await screen.findByLabelText('World');
    await selectFieldOption(user, 'World', new RegExp(escapeRegExp(realFixture.activeWorld.name), 'i'));

    expect(await screen.findByText('World 风格会话')).toBeInTheDocument();
    await completeWorldStyleSession(user, {
      replyLabel: '当前回答',
      sendReplyLabel: '发送回答',
      synthesizeLabel: '整理风格包草案',
      answers: [
        '整体气质要克制，优先突出人物身份与修行层级。',
        '角色差异主要通过服装层次、材质和门派气质体现。',
        '配色保持收敛，背景退后，不要抢角色识别。',
        '不要极端近景、夸张动作和喧宾夺主的背景。',
      ],
    });

    expect(await screen.findByText('风格包草案')).toBeInTheDocument();
    expect(screen.getByText('风格摘要')).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => {
      const text = element?.textContent || '';
      return text.includes(realFixture.activeWorld.name) && text.includes('人物锚点肖像应保持');
    }).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue(/清晰全身轮廓/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/clean full-body silhouette/i)).not.toBeInTheDocument();
  }, 30000);

  it('renders batch list and detail with real-data-derived batch snapshots', async () => {
    const batch = makeRealDataBatch();
    const pauseBatch = vi.fn();
    const resumeBatch = vi.fn(async () => {});
    const rerunFailed = vi.fn(async () => {});
    const commitBatch = vi.fn(async () => {});
    const selectItem = vi.fn((batchId: string, itemId: string) => {
      useLookdevStore.setState((state) => ({
        batches: state.batches.map((entry) => entry.batchId === batchId ? { ...entry, selectedItemId: itemId } : entry),
      }));
    });

    useLookdevStore.setState({
      batches: [batch],
      pauseBatch,
      resumeBatch,
      rerunFailed,
      commitBatch,
      selectItem,
    });

    renderWithProviders(<BatchListPage />);
    expect(screen.getByText(batch.name)).toBeInTheDocument();
    expect(screen.getByText('Latest activity')).toBeInTheDocument();

    renderWithProviders(
      <Routes>
        <Route path="/batches/:batchId" element={<BatchDetailPage />} />
      </Routes>,
      ['/batches/real-batch'],
    );

    expect(await screen.findByText('Batch snapshots')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === `World id · ${realFixture.activeWorld.id}`)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: new RegExp(escapeRegExp(batch.items[1]!.agentDisplayName), 'i') }));
    expect(selectItem).toHaveBeenCalledWith('real-batch', batch.items[1]!.itemId);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Rerun Selected' }));
    expect(rerunFailed).toHaveBeenCalledWith('real-batch', [batch.items[1]!.itemId]);
  }, 30000);
});
