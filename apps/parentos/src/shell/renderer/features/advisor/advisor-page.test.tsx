// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const {
  createConversationMock,
  getConversationsMock,
  insertAiMessageMock,
  getAiMessagesMock,
  getMeasurementsMock,
  getVaccineRecordsMock,
  getMilestoneRecordsMock,
  getJournalEntriesMock,
  loadParentosRuntimeRouteOptionsMock,
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
  streamMock: vi.fn(),
  warmLocalAssetMock: vi.fn(async () => ({})),
  getPlatformClientMock: vi.fn(),
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
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => getPlatformClientMock(),
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

function renderAdvisorPage() {
  return render(
    <MemoryRouter>
      <AdvisorPage />
    </MemoryRouter>,
  );
}

function formatLocalDateForAssertion(value: string) {
  const date = new Date(value);
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatLocalTimeForAssertion(value: string) {
  const date = new Date(value);
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':');
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
    loadParentosRuntimeRouteOptionsMock.mockClear();
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
      aiConfig: null,
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

    fireEvent.click(screen.getByRole('button', { name: /\+ 新对话/i }));
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
      timeoutMs: 60000,
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

  it('assembles reviewed-domain runtime prompts from the frozen snapshot', async () => {
    streamMock.mockResolvedValue(createStreamOutput('睡眠节律目前比较稳定。'));

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /\+ 新对话/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /\+ 新对话/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /\+ 新对话/i }));
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
      reasonCode: 'AI_PROVIDER_UNAVAILABLE',
      message: 'provider request failed',
      details: {
        provider_message: 'dial tcp 127.0.0.1:8321: connect: connection refused',
      },
    });

    renderAdvisorPage();

    fireEvent.click(screen.getByRole('button', { name: /\+ 新对话/i }));
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

  it('renders conversation dates and message times in local time instead of raw UTC slices', async () => {
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

    expect(screen.getByText(formatLocalDateForAssertion('2026-04-14T16:39:14.000Z'))).toBeTruthy();
    expect(screen.getByText(formatLocalTimeForAssertion('2026-04-14T16:41:55.000Z'))).toBeTruthy();
    expect(screen.queryByText('16:41:55')).toBeNull();
  });
});
