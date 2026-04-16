import { useEffect, useRef, useState } from 'react';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import { useLocation, useSearchParams } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { NEEDS_REVIEW_DOMAINS, REVIEWED_DOMAINS } from '../../knowledge-base/index.js';
import { filterAIResponse } from '../../engine/ai-safety-filter.js';
import {
  createConversation,
  getAiMessages,
  getConversations,
  insertAiMessage,
} from '../../bridge/sqlite-bridge.js';
import type { AiMessageRow, ConversationRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import {
  appendAdvisorSources,
  buildAdvisorGenericRuntimeUserMessage,
  buildAdvisorNeedsReviewRuntimeUserMessage,
  buildAdvisorUnknownClarifierRuntimeUserMessage,
  buildAdvisorRuntimeUserMessage,
  buildAdvisorSnapshot,
  buildStructuredAdvisorFallback,
  inferRequestedDomains,
  resolveAdvisorPromptStrategy,
  serializeAdvisorSnapshot,
  type AdvisorPromptStrategy,
} from './advisor-boundary.js';
import {
  buildParentosRuntimeMetadata,
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AdvisorSidebar } from './advisor-sidebar.js';
import { AdvisorTranscript } from './advisor-transcript.js';
import { AdvisorComposer } from './advisor-composer.js';
import { AdvisorEmptyState } from './advisor-empty-state.js';
import { AdvisorJournalContext, type JournalEntryAdvisorContext } from './advisor-journal-context.js';

type StreamingState = 'idle' | 'streaming';

type AdvisorLocationState = {
  journalEntryContext?: JournalEntryAdvisorContext;
} | null;

/* ── contextual opening message for reminder topics ──────── */

function buildTopicOpening(
  topic: string, desc: string,
  childName: string, ageMonths: number, gender: string,
): string {
  const ageY = Math.floor(ageMonths / 12);
  const ageR = ageMonths % 12;
  const ageStr = (ageY > 0 ? `${ageY}岁` : '') + (ageR > 0 ? `${ageR}个月` : '');
  const genderStr = gender === 'female' ? '女孩' : '男孩';

  return `我的孩子${childName}，${genderStr}，目前${ageStr}。

我想了解关于「${topic}」的内容：${desc}

请帮我：
1. 结合${childName}目前的年龄和发育阶段，说明这件事的重要性
2. 具体讲解应该如何进行
3. 需要注意哪些事项`;
}

function padDateSegment(value: number) {
  return String(value).padStart(2, '0');
}

function parseAdvisorDisplayDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAdvisorConversationDate(value: string) {
  const date = parseAdvisorDisplayDate(value);
  if (!date) {
    return value.split('T')[0] ?? value;
  }
  return [
    String(date.getFullYear()),
    padDateSegment(date.getMonth() + 1),
    padDateSegment(date.getDate()),
  ].join('-');
}

function formatAdvisorContextDateTime(value: string) {
  const date = parseAdvisorDisplayDate(value);
  if (!date) {
    return value.replace('T', ' ').slice(0, 16);
  }
  return [
    formatAdvisorConversationDate(value),
    `${padDateSegment(date.getHours())}:${padDateSegment(date.getMinutes())}`,
  ].join(' ');
}

function buildJournalEntryOpening(
  childName: string,
  context: JournalEntryAdvisorContext,
) {
  const lines = [
    `我想围绕 ${childName} 的一条成长随记继续聊聊。`,
    `记录时间：${formatAdvisorContextDateTime(context.recordedAt)}`,
  ];

  if (context.dimensionName) {
    lines.push(`成长方向：${context.dimensionName}`);
  }
  if (context.recorderName) {
    lines.push(`记录人：${context.recorderName}`);
  }
  if (context.tags.length > 0) {
    lines.push(`标签：${context.tags.join('、')}`);
  }

  lines.push(`内容：${context.textContent?.trim() || '这条随记以语音或图片为主，当前没有附带文字内容。'}`);
  lines.push('');
  lines.push('请先基于这条随记本身，温和地帮我整理其中值得留意的内容。');
  lines.push('不要做诊断或下结论；如果信息还不够，也请告诉我接下来可以补充哪些细节。');

  return lines.join('\n');
}

function buildSystemPrompt(
  childName: string,
  ageMonths: number,
  gender: string,
  nurtureMode: string,
  _domains: string[],
): string {
  return `你是"成长底稿"的 AI 成长顾问，只能在已审核知识领域内提供解释。

当前孩子信息：
- 姓名：${childName}
- 年龄：${formatAge(ageMonths)}
- 性别：${gender === 'male' ? '男' : '女'}
- 养育模式：${nurtureMode}

已审核领域：${REVIEWED_DOMAINS.join('、')}
禁止自由生成解释的领域：${NEEDS_REVIEW_DOMAINS.join('、')}

回答要求：
- 只使用温和、中性的表达，如"观察到""可能""倾向于"。
- 不得出现"发育迟缓""异常""障碍"。
- 不得出现"应该吃""建议用药""建议服用""推荐治疗"。
- 不得出现"落后""危险""警告"。
- 如涉及数据异常，只能描述结构化事实，并提醒"建议咨询专业人士"。
- 回答结尾不要自行编造来源标签，来源会由系统追加。`;
}

/* ── page ─────────────────────────────────────────────────── */

function buildAdvisorSystemPrompt(
  childName: string,
  ageMonths: number,
  gender: string,
  nurtureMode: string,
  strategy: AdvisorPromptStrategy,
  domains: string[],
): string {
  const basePrompt = buildSystemPrompt(childName, ageMonths, gender, nurtureMode, domains);
  if (strategy === 'reviewed-advice') {
    return `${basePrompt}

当前策略：reviewed-advice
- 可以基于本地快照和已审核领域给出解释、归纳、温和建议。
- 不要输出诊断、药物、治疗或惊吓式表述。`;
  }
  if (strategy === 'needs-review-descriptive') {
    return `${basePrompt}

当前策略：needs-review-descriptive
- 只允许基于本地快照做描述、整理、重述和范围说明。
- 不要给出诊断、治疗、用药、风险评级、因果解释或专家式判断。
- 如用户索要结论或建议，只能说明当前先基于本地记录描述事实，并建议咨询专业人士。`;
  }
  if (strategy === 'unknown-clarifier') {
    return `${basePrompt}

当前策略：unknown-clarifier
- 用户意图还不明确。
- 只做简短澄清和方向引导，不直接给个性化育儿结论。
- 优先把问题收敛到睡眠、敏感期、性教育、数字使用，或本地记录查看方向。`;
  }
  return `${basePrompt}

当前策略：generic-chat
- 用户如果只是问候、闲聊、测试、询问你是谁或你能做什么，可以正常聊天。
- 可以主动追问想了解的方向，例如睡眠、疫苗、生长、里程碑或观察记录。
- 在领域未明确前，不直接给个性化育儿判断或高风险建议。`;
}

function buildAdvisorRuntimeInput(
  strategy: AdvisorPromptStrategy,
  question: string,
  domains: string[],
  snapshot: Awaited<ReturnType<typeof buildAdvisorSnapshot>>,
) {
  switch (strategy) {
    case 'generic-chat':
      return buildAdvisorGenericRuntimeUserMessage(question);
    case 'needs-review-descriptive':
      return buildAdvisorNeedsReviewRuntimeUserMessage(question, domains, snapshot);
    case 'unknown-clarifier':
      return buildAdvisorUnknownClarifierRuntimeUserMessage(question, snapshot);
    case 'reviewed-advice':
    default:
      return buildAdvisorRuntimeUserMessage(question, domains, snapshot);
  }
}

function shouldAppendAdvisorSources(strategy: AdvisorPromptStrategy, domains: string[]) {
  return strategy === 'reviewed-advice' && domains.length > 0;
}

function shouldRetryAdvisorWithNonStreaming(route: 'local' | 'cloud' | undefined, streamedText: string, error: unknown) {
  if (route !== 'cloud') {
    return false;
  }
  if (streamedText.trim()) {
    return false;
  }
  return !(error instanceof DOMException && error.name === 'AbortError');
}

function buildAdvisorRuntimeFailureNote(error: unknown) {
  const normalized = asNimiError(error, { source: 'runtime' });
  const providerMessage = typeof normalized.details?.provider_message === 'string'
    ? normalized.details.provider_message.trim()
    : '';
  const detail = providerMessage || String(normalized.message || '').trim();
  if (detail) {
    return `补充说明：运行时响应失败（${normalized.reasonCode}：${detail}），已退回本地结构化事实。`;
  }
  return `补充说明：运行时响应失败（${normalized.reasonCode}），已退回本地结构化事实。`;
}

export default function AdvisorPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const location = useLocation();
  const journalEntryContext = (location.state as AdvisorLocationState | undefined)?.journalEntryContext ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [streamingState, setStreamingState] = useState<StreamingState>('idle');
  const [streamingContent, setStreamingContent] = useState('');
  const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null);
  const [recordRoute, setRecordRoute] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const topicHandledRef = useRef<string | null>(null);
  const journalHandledRef = useRef<string | null>(null);
  const [pendingJournalContext, setPendingJournalContext] = useState<JournalEntryAdvisorContext | null>(null);

  const saveAssistantMsg = async (convId: string, content: string, contextSnapshot: string | null) => {
    await insertAiMessage({ messageId: ulid(), conversationId: convId, role: 'assistant', content, contextSnapshot, now: isoNow() });
    setMessages(await getAiMessages(convId));
  };

  const startConversationWithOpening = async (params: {
    title: string | null;
    question: string;
    ageMonthsAtRequest: number;
  }) => {
    if (!child) {
      return;
    }
    const convId = ulid();
    const now = isoNow();
    await createConversation({ conversationId: convId, childId: child.childId, title: params.title, now });
    setActiveConvId(convId);
    setConversations(await getConversations(child.childId));

    await runAdvisorTurn({
      conversationId: convId,
      question: params.question,
      ageMonthsAtRequest: params.ageMonthsAtRequest,
    });
  };

  const runAdvisorTurn = async (params: {
    conversationId: string;
    question: string;
    ageMonthsAtRequest: number;
  }) => {
    if (!child) {
      return;
    }
    const activeChild = child;
    const domains = inferRequestedDomains(params.question);
    const strategy = resolveAdvisorPromptStrategy(params.question, domains);
    const snapshot = await buildAdvisorSnapshot({
      childId: activeChild.childId,
      displayName: activeChild.displayName,
      gender: activeChild.gender,
      birthDate: activeChild.birthDate,
      nurtureMode: activeChild.nurtureMode,
      ageMonths: params.ageMonthsAtRequest,
    });
    const snapshotJson = serializeAdvisorSnapshot(snapshot);

    await insertAiMessage({
      messageId: ulid(),
      conversationId: params.conversationId,
      role: 'user',
      content: params.question,
      contextSnapshot: snapshotJson,
      now: isoNow(),
    });
    setMessages(await getAiMessages(params.conversationId));

    if (!runtimeAvailable) {
      await saveAssistantMsg(params.conversationId, buildStructuredAdvisorFallback(params.question, domains, snapshot), snapshotJson);
      return;
    }

    setStreamingState('streaming');
    setStreamingContent('');
    try {
      const { getPlatformClient } = await import('@nimiplatform/sdk');
      const client = getPlatformClient();
      const rt = client.runtime;
      const ac = new AbortController();
      abortRef.current = ac;
      const aiParams = await resolveParentosTextRuntimeConfig('parentos.advisor', { temperature: 0.5, maxTokens: 4096 });
      await ensureParentosLocalRuntimeReady({
        route: aiParams.route,
        localModelId: aiParams.localModelId,
        timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
      });
      const runtimeInput = {
        ...aiParams,
        input: [{
          role: 'user' as const,
          content: buildAdvisorRuntimeInput(strategy, params.question, domains, snapshot),
        }],
        system: buildAdvisorSystemPrompt(
          activeChild.displayName,
          params.ageMonthsAtRequest,
          activeChild.gender,
          activeChild.nurtureMode,
          strategy,
          domains,
        ),
        metadata: buildParentosRuntimeMetadata('parentos.advisor'),
      };
      let full = '';
      try {
        const out = await rt.ai.text.stream({
          ...runtimeInput,
          signal: ac.signal,
        });
        for await (const part of out.stream) {
          if (part.type === 'delta') {
            full += part.text;
            setStreamingContent(full);
          } else if (part.type === 'error') {
            throw part.error;
          }
        }
      } catch (streamErr) {
        if (!shouldRetryAdvisorWithNonStreaming(aiParams.route, full, streamErr)) {
          throw streamErr;
        }
        if (ac.signal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        const generated = await rt.ai.text.generate(runtimeInput);
        full = generated.text;
        setStreamingContent(full);
      }
      const filtered = filterAIResponse(full);
      if (!filtered.safe) {
        await saveAssistantMsg(params.conversationId, buildStructuredAdvisorFallback(params.question, domains, snapshot, {
          note: '补充说明：运行时响应触发了安全过滤，已退回本地结构化事实。',
        }), snapshotJson);
        return;
      }
      const finalContent = shouldAppendAdvisorSources(strategy, domains)
        ? appendAdvisorSources(filtered.filtered, domains)
        : filtered.filtered.trim();
      await saveAssistantMsg(params.conversationId, finalContent, snapshotJson);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      await saveAssistantMsg(params.conversationId, buildStructuredAdvisorFallback(params.question, domains, snapshot, {
        note: buildAdvisorRuntimeFailureNote(err),
      }), snapshotJson);
    } finally {
      setStreamingState('idle');
      setStreamingContent('');
      abortRef.current = null;
    }
  };

  useEffect(() => {
    if (!activeChildId) return;
    getConversations(activeChildId).then(setConversations).catch(catchLog('advisor', 'action:load-conversations-failed'));
  }, [activeChildId]);

  useEffect(() => {
    if (!activeConvId) return;
    getAiMessages(activeConvId).then(setMessages).catch(catchLog('advisor', 'action:load-ai-messages-failed'));
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    async function checkRuntime() {
      try {
        const { getPlatformClient } = await import('@nimiplatform/sdk');
        const client = getPlatformClient();
        setRuntimeAvailable(Boolean(client.runtime?.appId && client.runtime?.ai?.text?.stream));
      } catch { setRuntimeAvailable(false); }
    }
    checkRuntime();
  }, []);

  // ── Handle incoming topic from reminder panel ─────────────
  useEffect(() => {
    if (runtimeAvailable === null) return;
    const topic = searchParams.get('topic');
    const desc = searchParams.get('desc') ?? '';
    const record = searchParams.get('record');
    if (!topic || !child || topicHandledRef.current === topic) return;

    topicHandledRef.current = topic;
    if (record) setRecordRoute(record);
    setSearchParams({}, { replace: true });

    const am = computeAgeMonths(child.birthDate);
    const opening = buildTopicOpening(topic, desc, child.displayName, am, child.gender);

    (async () => {
      try {
        await startConversationWithOpening({
          title: topic,
          question: opening,
          ageMonthsAtRequest: am,
        });
      } catch { /* bridge */ }
    })();
  }, [searchParams, child, runtimeAvailable]);

  useEffect(() => {
    if (!child || !journalEntryContext || journalHandledRef.current === journalEntryContext.entryId) {
      return;
    }
    journalHandledRef.current = journalEntryContext.entryId;
    setRecordRoute(null);
    setPendingJournalContext(journalEntryContext);
  }, [child, journalEntryContext]);

  if (!child) return <div className="p-8 text-slate-400">请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);

  const handleNewConversation = async () => {
    const convId = ulid();
    try {
      await createConversation({ conversationId: convId, childId: child.childId, title: null, now: isoNow() });
      setActiveConvId(convId); setMessages([]); setRecordRoute(null);
      setConversations(await getConversations(child.childId));
    } catch { /* bridge */ }
  };

  const handleStartJournalConversation = async (starterQuestion: string) => {
    if (!child || !pendingJournalContext) return;
    const am = computeAgeMonths(child.birthDate);
    const contextLines = buildJournalEntryOpening(child.displayName, pendingJournalContext);
    const fullQuestion = `${contextLines}\n\n${starterQuestion}`;
    const title = `随记 ${formatAdvisorConversationDate(pendingJournalContext.recordedAt)}`;
    setPendingJournalContext(null);
    try {
      await startConversationWithOpening({
        title,
        question: fullQuestion,
        ageMonthsAtRequest: am,
      });
    } catch { /* bridge */ }
  };

  const handleSend = async () => {
    if (!input.trim() || streamingState === 'streaming') return;
    const q = input.trim(); setInput('');
    if (pendingJournalContext && !activeConvId) {
      await handleStartJournalConversation(q);
      return;
    }
    if (!activeConvId) return;
    try {
      await runAdvisorTurn({
        conversationId: activeConvId,
        question: q,
        ageMonthsAtRequest: ageMonths,
      });
    } catch { /* bridge */ }
  };

  return (
    <div className="flex h-full gap-4 px-4" style={{ paddingTop: 16 }}>
      <AdvisorSidebar
        conversations={conversations}
        activeConvId={activeConvId}
        onSelectConversation={(id) => { setActiveConvId(id); setRecordRoute(null); }}
        onNewConversation={handleNewConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {!activeConvId && pendingJournalContext ? (
          <AdvisorJournalContext
            context={pendingJournalContext}
            onSelectStarter={handleStartJournalConversation}
          />
        ) : !activeConvId ? (
          <AdvisorEmptyState
            childName={child.displayName}
            runtimeAvailable={runtimeAvailable}
          />
        ) : (
          <>
            <AdvisorTranscript
              messages={messages}
              streamingState={streamingState}
              streamingContent={streamingContent}
              onStopGenerating={() => abortRef.current?.abort()}
              messagesEndRef={messagesEndRef}
            />
            <AdvisorComposer
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onStop={() => abortRef.current?.abort()}
              disabled={streamingState === 'streaming'}
              isStreaming={streamingState === 'streaming'}
              recordRoute={recordRoute}
            />
          </>
        )}
      </div>
    </div>
  );
}
