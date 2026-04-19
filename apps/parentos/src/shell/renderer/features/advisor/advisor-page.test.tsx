// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import AdvisorPage from './advisor-page.js';

type StoredConversation = {
  conversationId: string;
  childId: string;
  title: string | null;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
};

type StoredMessage = {
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  contextSnapshot: string | null;
  createdAt: string;
};

const conversationStore: StoredConversation[] = [];
const messageStore: StoredMessage[] = [];
const defaultLocalAIConfig = {
  scopeRef: { kind: 'app' as const, ownerId: 'parentos', surfaceId: 'app' },
  capabilities: {
    selectedBindings: {
      'text.generate': {
        source: 'local' as const,
        connectorId: '',
        model: 'qwen3',
      },
    },
    localProfileRefs: {},
    selectedParams: {},
  },
  profileOrigin: null,
};

const {
  createConversationMock,
  getConversationsMock,
  insertAiMessageMock,
  getAiMessagesMock,
  getMeasurementsMock,
  getVaccineRecordsMock,
  getMilestoneRecordsMock,
  getJournalEntriesMock,
  getOutdoorRecordsMock,
  getOutdoorGoalMock,
  loadParentosRuntimeRouteOptionsMock,
  generateMock,
  streamMock,
  warmLocalAssetMock,
  getPlatformClientMock,
} = vi.hoisted(() => ({
  createConversationMock: vi.fn(async (params: {
    conversationId: string;
    childId: string;
    title: string | null;
    now: string;
  }) => {
    conversationStore.unshift({
      conversationId: params.conversationId,
      childId: params.childId,
      title: params.title,
      startedAt: params.now,
      lastMessageAt: params.now,
      messageCount: 0,
      createdAt: params.now,
    });
  }),
  getConversationsMock: vi.fn(async (childId: string) => conversationStore
    .filter((item) => item.childId === childId)
    .sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt))),
  insertAiMessageMock: vi.fn(async (params: {
    messageId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    contextSnapshot: string | null;
    now: string;
  }) => {
    messageStore.push({
      messageId: params.messageId,
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      contextSnapshot: params.contextSnapshot,
      createdAt: params.now,
    });
    const conversation = conversationStore.find((item) => item.conversationId === params.conversationId);
    if (conversation) {
      conversation.lastMessageAt = params.now;
      conversation.messageCount += 1;
    }
  }),
  getAiMessagesMock: vi.fn(async (conversationId: string) => messageStore
    .filter((item) => item.conversationId === conversationId)
    .map((item) => ({ ...item }))),
  getMeasurementsMock: vi.fn(async () => [
    {
      measurementId: 'm-1',
      childId: 'child-1',
      typeId: 'height',
      value: 98.4,
      measuredAt: '2026-04-01T00:00:00.000Z',
      ageMonths: 27,
      percentile: null,
      source: 'manual',
      notes: null,
      createdAt: '2026-04-01T00:00:00.000Z',
    },
  ]),
  getVaccineRecordsMock: vi.fn(async () => [
    {
      recordId: 'v-1',
      childId: 'child-1',
      ruleId: 'PO-REM-VAC-001',
      vaccineName: 'MMR',
      vaccinatedAt: '2026-03-01T00:00:00.000Z',
      ageMonths: 26,
      batchNumber: null,
      hospital: null,
      adverseReaction: null,
      photoPath: null,
      createdAt: '2026-03-01T00:00:00.000Z',
    },
  ]),
  getMilestoneRecordsMock: vi.fn(async () => [
    {
      recordId: 'ms-1',
      childId: 'child-1',
      milestoneId: 'PO-MS-LANG-003',
      achievedAt: '2026-02-01T00:00:00.000Z',
      ageMonthsWhenAchieved: 25,
      notes: null,
      photoPath: null,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    },
  ]),
  getJournalEntriesMock: vi.fn(async () => [
    {
      entryId: 'j-1',
      childId: 'child-1',
      contentType: 'text',
      textContent: '午睡比较稳定',
      voicePath: null,
      photoPaths: null,
      recordedAt: '2026-04-02T00:00:00.000Z',
      ageMonths: 27,
      observationMode: 'five-minute',
      dimensionId: null,
      selectedTags: null,
      guidedAnswers: null,
      observationDuration: 5,
      keepsake: 0,
      moodTag: null,
      recorderId: 'mom',
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
  ]),
  getOutdoorRecordsMock: vi.fn(async () => []),
  getOutdoorGoalMock: vi.fn(async () => null),
  loadParentosRuntimeRouteOptionsMock: vi.fn(async () => ({
    capability: 'text.generate',
    selected: null,
    resolvedDefault: {
      source: 'local',
      connectorId: '',
      model: 'qwen3',
      modelId: 'qwen3',
      localModelId: 'local-qwen3',
      provider: 'llama',
      engine: 'llama',
      endpoint: 'http://127.0.0.1:1234/v1',
      goRuntimeLocalModelId: 'local-qwen3',
      goRuntimeStatus: 'active',
    },
    local: {
      defaultEndpoint: 'http://127.0.0.1:1234/v1',
      models: [],
    },
    connectors: [],
  })),
  generateMock: vi.fn(),
  streamMock: vi.fn(),
  warmLocalAssetMock: vi.fn(async () => ({})),
  getPlatformClientMock: vi.fn(),
}));

vi.mock('@nimiplatform/nimi-kit/features/chat/ui', () => {
  /** Minimal markdown renderer that converts **bold** and - list items. */
  function SimpleMd({ content }: { content: string }) {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(<ul key={`ul-${elements.length}`}>{listItems.map((li, i) => <li key={i}>{li}</li>)}</ul>);
        listItems = [];
      }
    };

    for (const line of lines) {
      if (line.startsWith('- ')) {
        listItems.push(line.slice(2));
        continue;
      }
      flushList();
      const boldMatch = line.match(/^\*\*(.+)\*\*$/);
      if (boldMatch) {
        elements.push(<p key={elements.length}><strong>{boldMatch[1]}</strong></p>);
      } else if (line.trim()) {
        elements.push(<p key={elements.length}>{line}</p>);
      }
    }
    flushList();
    return <div>{elements}</div>;
  }

  return {
    CanonicalMessageBubble: ({ message }: { message: { text: string; role: string } }) => (
      <div data-testid={`bubble-${message.role}`}><SimpleMd content={message.text} /></div>
    ),
    CanonicalTypingBubble: ({ thinkingLabel }: { thinkingLabel?: string }) => (
      <div>{thinkingLabel ?? 'Thinking…'}</div>
    ),
    ChatMarkdownRenderer: SimpleMd,
  };
});

vi.mock('@nimiplatform/nimi-kit/ui', () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Surface: ({ children, className, style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <div className={className} style={style}>{children}</div>
  ),
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  createConversation: createConversationMock,
  getConversations: getConversationsMock,
  insertAiMessage: insertAiMessageMock,
  getAiMessages: getAiMessagesMock,
  getMeasurements: getMeasurementsMock,
  getVaccineRecords: getVaccineRecordsMock,
  getMilestoneRecords: getMilestoneRecordsMock,
  getJournalEntries: getJournalEntriesMock,
  getOutdoorRecords: getOutdoorRecordsMock,
  getOutdoorGoal: getOutdoorGoalMock,
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => getPlatformClientMock(),
}));

vi.mock('@nimiplatform/sdk/runtime', () => ({
  asNimiError: (err: unknown) => ({
    reasonCode: (err as Record<string, unknown>)?.reasonCode ?? 'UNKNOWN',
    message: (err as Record<string, unknown>)?.message ?? '',
    details: (err as Record<string, unknown>)?.details ?? {},
  }),
}));

vi.mock('../../infra/parentos-runtime-route-options.js', () => ({
  loadParentosRuntimeRouteOptions: loadParentosRuntimeRouteOptionsMock,
}));

function createStreamOutput(text: string) {
  return {
    stream: (async function* stream() {
      yield { type: 'delta' as const, text };
    })(),
  };
}

function createStreamErrorOutput(error: unknown) {
  return {
    stream: (async function* stream() {
      yield { type: 'error' as const, error };
    })(),
  };
}

function renderAdvisorPage(
  initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/'],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AdvisorPage />
    </MemoryRouter>,
  );
}

describe('AdvisorPage', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    conversationStore.length = 0;
    messageStore.length = 0;
    createConversationMock.mockClear();
    getConversationsMock.mockClear();
    insertAiMessageMock.mockClear();
    getAiMessagesMock.mockClear();
    getMeasurementsMock.mockClear();
    getVaccineRecordsMock.mockClear();
    getMilestoneRecordsMock.mockClear();
    getJournalEntriesMock.mockClear();
    getOutdoorRecordsMock.mockClear();
    getOutdoorGoalMock.mockClear();
    loadParentosRuntimeRouteOptionsMock.mockClear();
    generateMock.mockReset();
    streamMock.mockReset();
    warmLocalAssetMock.mockReset();
    getPlatformClientMock.mockReturnValue({
      runtime: {
        appId: 'app.nimi.parentos',
        local: {
          warmLocalAsset: warmLocalAssetMock,
        },
        ai: {
          text: {
            generate: generateMock,
            stream: streamMock,
          },
        },
      },
    });

    useAppStore.setState({
      bootstrapReady: true,
      familyId: 'family-1',
      activeChildId: 'child-1',
      children: [
        {
          childId: 'child-1',
          familyId: 'family-1',
          displayName: 'Mimi',
          gender: 'female',
          birthDate: '2024-01-15',
          birthWeightKg: null,
          birthHeightCm: null,
          birthHeadCircCm: null,
          avatarPath: null,
          nurtureMode: 'balanced',
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      aiConfig: defaultLocalAIConfig,
    });
  });

  afterEach(() => {
    useAppStore.setState({
      bootstrapReady: false,
      familyId: null,
      activeChildId: null,
      children: [],
      aiConfig: null,
    });
  });

  it('persists a full frozen advisor snapshot and routes unknown domains to clarifier runtime', async () => {
    streamMock.mockResolvedValue(createStreamOutput('你想聊睡眠、敏感期、屏幕使用，还是先看身高、疫苗、里程碑这些记录？'));

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /新对话/ }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入问题...')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('输入问题...'), {
      target: { value: '最近怎么样？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    const streamInput = streamMock.mock.calls[0]?.[0] as {
      route: string;
      model: string;
      input: Array<{ role: string; content: string }>;
    };
    expect(streamInput.route).toBe('local');
    expect(streamInput.model).toBe('llama/qwen3');
    expect(streamInput.input[0]?.content).toContain('澄清型回答策略');
    expect(streamInput.input[0]?.content).toContain('当前本地记录概况');
    expect(warmLocalAssetMock).toHaveBeenCalledWith({
      localAssetId: 'local-qwen3',
      timeoutMs: 180000,
    });

    const userCall = insertAiMessageMock.mock.calls.find((call) => call[0].role === 'user')?.[0];
    expect(userCall?.contextSnapshot).toBeTruthy();
    const snapshot = JSON.parse(String(userCall?.contextSnapshot)) as {
      child: { childId: string; displayName: string };
      measurements: unknown[];
      vaccines: unknown[];
      milestones: unknown[];
      journalEntries: unknown[];
    };
    expect(snapshot.child).toEqual(expect.objectContaining({
      childId: 'child-1',
      displayName: 'Mimi',
    }));
    expect(snapshot.measurements).toHaveLength(1);
    expect(snapshot.vaccines).toHaveLength(1);
    expect(snapshot.milestones).toHaveLength(1);
    expect(snapshot.journalEntries).toHaveLength(1);

    await waitFor(() => {
      expect(screen.getByText(/你想聊睡眠、敏感期、屏幕使用/)).toBeTruthy();
    });
  });

  it('shows journal context preview and starts conversation on starter click', async () => {
    streamMock.mockResolvedValue(createStreamOutput('我先帮你整理一下这条随记里值得继续留意的部分。'));

    renderAdvisorPage([{
      pathname: '/advisor',
      state: {
        journalEntryContext: {
          entryId: 'journal-entry-1',
          recordedAt: '2026-04-05T09:48:00.000Z',
          contentType: 'text',
          textContent: '午睡前自己把玩具收好了，还主动和我说想先去洗手。',
          dimensionName: 'Self care',
          tags: ['Independent cleanup'],
          recorderName: 'Mom',
        },
      },
    }]);

    // Should show context preview instead of auto-sending
    await waitFor(() => {
      expect(screen.getByText('关于这条随记，你想聊什么？')).toBeTruthy();
      expect(screen.getByText(/午睡前自己把玩具收好了/)).toBeTruthy();
      expect(screen.getByText('Self care')).toBeTruthy();
      expect(screen.getByText('Independent cleanup')).toBeTruthy();
    });

    // No conversation created yet
    expect(createConversationMock).not.toHaveBeenCalled();

    // Click a starter to begin conversation
    fireEvent.click(screen.getByText('请帮我整理这条记录的关键信息'));

    await waitFor(() => {
      expect(createConversationMock).toHaveBeenCalledTimes(1);
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    expect(createConversationMock.mock.calls[0]?.[0]).toMatchObject({
      childId: 'child-1',
      title: '随记 2026-04-05',
    });

    const userCall = insertAiMessageMock.mock.calls.find((call) => call[0].role === 'user')?.[0];
    expect(userCall?.content).toContain('成长随记继续聊聊');
    expect(userCall?.content).toContain('Self care');
    expect(userCall?.content).toContain('Independent cleanup');
    expect(userCall?.content).toContain('午睡前自己把玩具收好了');
    expect(userCall?.content).toContain('请帮我整理这条记录的关键信息');

    await waitFor(() => {
      expect(screen.getByText(/我先帮你整理一下这条随记/)).toBeTruthy();
    });
  });

  it('assembles reviewed-domain runtime prompts from the frozen snapshot', async () => {
    streamMock.mockResolvedValue(createStreamOutput('睡眠节律目前比较稳定。'));

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /新对话/ }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入问题...')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('输入问题...'), {
      target: { value: '最近睡眠怎么样？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    const streamInput = streamMock.mock.calls[0]?.[0] as {
      route: string;
      model: string;
      input: Array<{ role: string; content: string }>;
      metadata: { surfaceId: string };
    };
    expect(streamInput.route).toBe('local');
    expect(streamInput.model).toBe('llama/qwen3');
    expect(streamInput.metadata.surfaceId).toBe('parentos.advisor');
    expect(streamInput.input[0]?.content).toContain('请仅基于以下 ParentOS 本地结构化快照回答');
    expect(streamInput.input[0]?.content).toContain('问题：最近睡眠怎么样？');
    expect(streamInput.input[0]?.content).toContain('已判定领域：sleep');
    expect(streamInput.input[0]?.content).toContain('"childId":"child-1"');

    await waitFor(() => {
      expect(screen.getByText(/来源：sleep:/)).toBeTruthy();
    });
  });

  it('routes generic advisor chat to runtime without exposing the structured fallback', async () => {
    streamMock.mockResolvedValue(createStreamOutput([
      '我是 ParentOS 顾问助手，目前走的是本地受治理的模型调用路径。',
      '',
      '**当前可以深入讨论的方向包括：**',
      '- 睡眠',
      '- 敏感度',
    ].join('\n')));

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /新对话/ }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入问题...')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('输入问题...'), {
      target: { value: '你好，测试，你的模型是？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    const streamInput = streamMock.mock.calls[0]?.[0] as {
      input: Array<{ role: string; content: string }>;
      route: string;
      model: string;
    };
    expect(streamInput.route).toBe('local');
    expect(streamInput.model).toBe('llama/qwen3');
    expect(streamInput.input[0]?.content).toContain('泛闲聊或产品能力澄清');
    expect(streamInput.input[0]?.content).toContain('用户消息：你好，测试，你的模型是？');
    expect(streamInput.input[0]?.content).not.toContain('"childId":"child-1"');

    await waitFor(() => {
      expect(screen.getByText(/本地受治理的模型调用路径/)).toBeTruthy();
    });
    expect(screen.getByText('当前可以深入讨论的方向包括：', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('睡眠', { selector: 'li' })).toBeTruthy();
    expect(screen.getByText('敏感度', { selector: 'li' })).toBeTruthy();
    expect(screen.queryByText(/当前问题尚未明确到已审核领域/)).toBeNull();
  });

  it('routes needs-review questions to descriptive runtime instead of skipping the model', async () => {
    streamMock.mockResolvedValue(createStreamOutput('从当前本地记录看，最近一次疫苗记录是 MMR。若你想判断补种安排，建议结合专业接种门诊进一步确认。'));

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /新对话/ }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入问题...')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('输入问题...'), {
      target: { value: '疫苗补种怎么判断？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    const streamInput = streamMock.mock.calls[0]?.[0] as {
      route: string;
      model: string;
      input: Array<{ role: string; content: string }>;
    };
    expect(streamInput.route).toBe('local');
    expect(streamInput.model).toBe('llama/qwen3');
    expect(streamInput.input[0]?.content).toContain('描述型回答策略');
    expect(streamInput.input[0]?.content).toContain('涉及领域：vaccine');
    expect(streamInput.input[0]?.content).toContain('"childId":"child-1"');

    await waitFor(() => {
      expect(screen.getByText(/最近一次疫苗记录是 MMR/)).toBeTruthy();
    });
  });

  it('surfaces normalized runtime error details in the fallback note', async () => {
    streamMock.mockRejectedValue({
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      message: 'provider request failed',
      details: {
        provider_message: 'dial tcp 127.0.0.1:8321: connect: connection refused',
      },
    });

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /新对话/ }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入问题...')).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText('输入问题...'), {
      target: { value: '你好，测试，你的模型是？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(screen.getByText(/AI_PROVIDER_UNAVAILABLE/)).toBeTruthy();
    });
    expect(screen.getByText(/connect: connection refused/)).toBeTruthy();
  });

  it('retries cloud advisor chat with generate when the stream fails before any text arrives', async () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: { kind: 'app', ownerId: 'parentos', surfaceId: 'app' },
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'cloud',
              connectorId: 'connector-1',
              model: 'gpt-5.4',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });
    streamMock.mockResolvedValue(createStreamErrorOutput({
      reasonCode: ReasonCode.AI_STREAM_BROKEN,
      message: 'retry stream request',
    }));
    generateMock
      .mockResolvedValueOnce({
        text: JSON.stringify([
          '最近睡眠节律稳定吗？',
          '户外活动还够吗？',
          '敏感期要注意什么？',
        ]),
      })
      .mockResolvedValueOnce({
        text: 'cloud fallback reply',
        finishReason: 'stop',
        usage: {},
        trace: {
          routeDecision: 'cloud',
          modelResolved: 'cloud/gpt-5.4',
        },
      });

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /新对话/ }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入问题...')).toBeTruthy();
    });
    await waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByPlaceholderText('输入问题...'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(streamMock).toHaveBeenCalledTimes(1);
      expect(generateMock).toHaveBeenCalledTimes(2);
    });

    const streamInput = streamMock.mock.calls[0]?.[0] as {
      route: string;
      model: string;
      connectorId?: string;
    };
    expect(streamInput.route).toBe('cloud');
    expect(streamInput.model).toBe('cloud/gpt-5.4');
    expect(streamInput.connectorId).toBe('connector-1');

    const generateInput = generateMock.mock.calls[1]?.[0] as {
      route: string;
      model: string;
      connectorId?: string;
    };
    expect(generateInput.route).toBe('cloud');
    expect(generateInput.model).toBe('cloud/gpt-5.4');
    expect(generateInput.connectorId).toBe('connector-1');
    expect(warmLocalAssetMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText('cloud fallback reply')).toBeTruthy();
    });
    expect(screen.queryByText(/已退回本地结构化事实/)).toBeNull();
  });

  it('renders conversation list and message content without raw UTC slices', async () => {
    conversationStore.push({
      conversationId: 'conv-local-time',
      childId: 'child-1',
      title: '本地时间测试',
      startedAt: '2026-04-14T16:39:14.000Z',
      lastMessageAt: '2026-04-14T16:39:14.000Z',
      messageCount: 1,
      createdAt: '2026-04-14T16:39:14.000Z',
    });
    messageStore.push({
      messageId: 'msg-local-time',
      conversationId: 'conv-local-time',
      role: 'assistant',
      content: '本地时间显示检查',
      contextSnapshot: null,
      createdAt: '2026-04-14T16:41:55.000Z',
    });

    renderAdvisorPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /本地时间测试/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /本地时间测试/i }));

    await waitFor(() => {
      expect(screen.getByText('本地时间显示检查')).toBeTruthy();
    });

    // Sidebar shows Chinese relative time instead of raw date strings
    // Raw UTC segments must not leak to the UI
    expect(screen.queryByText('16:39:14')).toBeNull();
    expect(screen.queryByText('16:41:55')).toBeNull();
  });

  it('generates starter suggestions once runtime availability becomes ready', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify([
        '最近睡眠节律稳定吗？',
        '户外活动还够吗？',
        '敏感期要注意什么？',
      ]),
    });

    renderAdvisorPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新对话/ }));
    });

    await waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '最近睡眠节律稳定吗？' })).toBeTruthy();
    });
  });
});
