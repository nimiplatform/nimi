import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { changeLocale, initI18n } from '@renderer/i18n/index.js';
import CreateBatchPage from './create-batch-page.js';
import { useLookdevStore } from './lookdev-store.js';
import { createConfirmedWorldStylePack, type LookdevPortraitBrief, type LookdevWorldStylePack } from './types.js';

const { listLookdevWorlds, listLookdevAgents, listLookdevWorldAgents } = vi.hoisted(() => ({
  listLookdevWorlds: vi.fn(),
  listLookdevAgents: vi.fn(),
  listLookdevWorldAgents: vi.fn(),
}));

vi.mock('@renderer/data/lookdev-data-client.js', async () => {
  const actual = await vi.importActual<object>('@renderer/data/lookdev-data-client.js');
  return {
    ...actual,
    listLookdevWorlds,
    listLookdevAgents,
    listLookdevWorldAgents,
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

function portraitBriefKey(worldId: string | null | undefined, agentId: string): string {
  return `${String(worldId || 'unscoped').trim() || 'unscoped'}::${agentId}`;
}

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

const { key: _generationTargetKey, ...expectedGenerationTarget } = generationTarget;
const { key: _evaluationTargetKey, ...expectedEvaluationTarget } = evaluationTarget;

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

async function completeWorldStyleSession(user: ReturnType<typeof userEvent.setup>) {
  const answers = [
    'Keep the world grounded, readable, and role-first.',
    'Differences should come through costume hierarchy and identity cues.',
    'Use a restrained palette and keep backgrounds subordinate.',
    'Avoid extreme close-ups and noisy cinematic backdrops.',
  ];
  for (const answer of answers) {
    await user.type(screen.getByLabelText('Current reply'), answer);
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
  }
  await user.click(screen.getByRole('button', { name: 'Synthesize style pack draft' }));
}

describe('CreateBatchPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await initI18n();
    await changeLocale('en');
    mockRuntime.ai.text.generate.mockImplementation(async (input: { system?: string; prompt?: string; input?: string }) => {
      const payload = String(input.system || '').includes('structured world style pack draft')
        || String(input.system || '').includes('结构化的 world style pack 草案')
        ? buildSynthesisPayload(String(input.prompt || input.input || '').includes('language: zh') ? 'zh' : 'en')
        : buildDialoguePayload(String(input.prompt || input.input || '').includes('language: zh') ? 'zh' : 'en');
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
  });

  it('creates a world-scoped batch with capture selection applied', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await user.type(screen.getByLabelText('Batch name'), 'Night market refresh');
    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');

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

    await user.click(screen.getByRole('button', { name: /Nora/i }));

    expect(await screen.findByText('Embedded Capture')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Anchor scout')).toBeInTheDocument();

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
  }, 15000);

  it('reuses stored world style packs and portrait briefs', async () => {
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

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');

    expect(await screen.findByDisplayValue('Stored Aurora lane')).toBeInTheDocument();
    expect(screen.getByDisplayValue('deep teal and brass')).toBeInTheDocument();
    expect(screen.getByText('Confirmed style pack')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Stored scout anchor')).toBeInTheDocument();
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

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');

    expect(await screen.findByText('World Style Session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    expect(screen.queryByText('Confirmed style pack')).not.toBeInTheDocument();
  });

  it('edits style pack, embedded capture brief, and policy snapshot before create', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await user.type(screen.getByLabelText('Batch name'), 'Policy tuned batch');
    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    fireEvent.change(screen.getByLabelText('Style pack name'), { target: { value: 'Aurora tuned lane' } });
    fireEvent.change(screen.getByLabelText('Visual era'), { target: { value: 'retro-futurist harbor noir' } });
    fireEvent.change(screen.getByLabelText('Art style'), { target: { value: 'graphic novel portrait realism' } });
    fireEvent.change(screen.getByLabelText('Palette direction'), { target: { value: 'teal, amber, midnight blue' } });
    fireEvent.change(screen.getByLabelText('Silhouette direction'), { target: { value: 'long coats, clear shoulder lines' } });

    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    fireEvent.change(screen.getByDisplayValue('Anchor scout'), { target: { value: 'Lead harbor scout' } });
    fireEvent.change(screen.getByLabelText('Silhouette'), { target: { value: 'full-body dockside silhouette' } });
    fireEvent.change(screen.getByLabelText('Outfit'), { target: { value: 'weatherproof scout coat' } });
    fireEvent.change(screen.getByLabelText('Hairstyle'), { target: { value: 'windswept bob' } });
    fireEvent.change(screen.getByLabelText('Palette'), { target: { value: 'teal and amber' } });
    fireEvent.change(screen.getByLabelText('Must keep traits'), { target: { value: 'steady gaze, scout posture' } });
    fireEvent.change(screen.getByLabelText('Forbidden traits'), { target: { value: 'extreme close-up, heavy blur' } });

    fireEvent.change(screen.getByLabelText('Auto-eval score threshold'), { target: { value: '84' } });
    fireEvent.change(screen.getByLabelText('Max concurrency'), { target: { value: '2' } });
    await user.selectOptions(screen.getByLabelText('Generation target'), generationTarget.key);
    await user.selectOptions(screen.getByLabelText('Evaluation target'), evaluationTarget.key);

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

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    await user.click(screen.getByRole('button', { name: /PRIMARY.*iris.*Capture/i }));

    expect(await screen.findByText('No capture agents selected. Keep everything in batch-only mode, or select agents above to open embedded capture refinement.')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Anchor scout')).not.toBeInTheDocument();
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

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');

    expect(await screen.findByText('Lookdev could not resolve a controllable cast for Aurora Harbor. Pick a world you can operate on or refresh runtime and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
    expect(createBatch).not.toHaveBeenCalled();
  });

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

    await screen.findByRole('option', { name: 'Aurora Harbor' });
    expect(screen.queryByRole('option', { name: /Aurora Harbor · 0 agents/i })).not.toBeInTheDocument();
  });

  it('supports switching back to world-scoped mode and editing a secondary capture brief', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris.*Select/i }));
    await user.click(screen.getByRole('button', { name: /World-scoped selection/i }));
    await user.selectOptions(screen.getByLabelText('World'), 'w1');
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));
    await user.click(screen.getByRole('button', { name: /SECONDARY.*nora.*Batch only/i }));
    await user.click(screen.getByRole('button', { name: /Nora.*Review/i }));

    expect(await screen.findByDisplayValue('Clockwork guide')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Clockwork guide'), { target: { value: 'Clocktower guide' } });

    expect(useLookdevStore.getState().portraitBriefs['w1::a2']).toEqual(expect.objectContaining({
      visualRole: 'Clocktower guide',
    }));
  }, 15000);

  it('keeps a manually removed primary agent out of capture when selection changes later', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris.*Select/i }));
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));
    await user.click(screen.getByRole('button', { name: /Iris.*Capture/i }));

    expect(await screen.findByText('No capture agents selected. Keep everything in batch-only mode, or select agents above to open embedded capture refinement.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Nora.*Select/i }));

    expect(screen.getByText('No capture agents selected. Keep everything in batch-only mode, or select agents above to open embedded capture refinement.')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Anchor scout')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Iris.*Capture/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Iris.*Batch only/i })).toBeInTheDocument();
  }, 15000);

  it('blocks explicit selection batches that span multiple worlds', async () => {
    const { createBatch } = seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.click(screen.getByRole('button', { name: /Explicit agent selection/i }));
    await user.click(screen.getByRole('button', { name: /Iris.*In batch|Iris.*Select/i }));
    await user.click(screen.getByRole('button', { name: /Sora.*In batch|Sora.*Select/i }));

    expect(await screen.findByText('Selected agents currently span multiple worlds. Narrow to one world before creating a batch.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create and start processing' })).toBeDisabled();
    expect(createBatch).not.toHaveBeenCalled();
  }, 15000);

  it('returns a confirmed style pack to draft when the operator edits it later', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    expect(screen.getByText('Confirmed style pack')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Aurora Harbor portrait style pack'), { target: { value: 'Aurora operator lane' } });

    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm style pack' })).toBeInTheDocument();
    expect(screen.getByText('Confirm the world style pack first. Capture selection only opens after the style lane is explicitly confirmed.')).toBeInTheDocument();
  });

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

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');

    expect(await screen.findByText('No text.generate target is currently available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Synthesize style pack draft' })).toBeDisabled();
  });

  it('returns the confirmed pack to draft when the operator keeps chatting after confirmation', async () => {
    seedWorkingState();
    const user = userEvent.setup();
    renderCreatePage();

    await screen.findByRole('option', { name: /Aurora Harbor/i });
    await user.selectOptions(screen.getByLabelText('World'), 'w1');
    await completeWorldStyleSession(user);
    await user.click(screen.getByRole('button', { name: 'Confirm style pack' }));

    expect(screen.getByText('Confirmed style pack')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Current reply'), 'Keep the silhouettes even cleaner and reduce background noise further.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(screen.queryByText('Confirmed style pack')).not.toBeInTheDocument();
    expect(screen.getByText('Draft style pack')).toBeInTheDocument();
    expect(screen.getByText('Confirm the world style pack first. Capture selection only opens after the style lane is explicitly confirmed.')).toBeInTheDocument();
  }, 15000);
});
