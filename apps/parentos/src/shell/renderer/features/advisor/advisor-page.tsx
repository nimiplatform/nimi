import { useEffect, useRef, useState } from 'react';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import { ChatMarkdownRenderer } from '@nimiplatform/nimi-kit/features/chat/ui';
import { Link, useSearchParams } from 'react-router-dom';
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
  resolveParentosTextRuntimeConfig,
} from '../settings/parentos-ai-runtime.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';

/* design tokens imported from shared page-style */

type StreamingState = 'idle' | 'streaming';

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

function formatAdvisorMessageTime(value: string) {
  const date = parseAdvisorDisplayDate(value);
  if (!date) {
    return value.split('T')[1]?.split('.')[0] ?? value;
  }
  return [
    padDateSegment(date.getHours()),
    padDateSegment(date.getMinutes()),
    padDateSegment(date.getSeconds()),
  ].join(':');
}

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

  const saveAssistantMsg = async (convId: string, content: string, contextSnapshot: string | null) => {
    await insertAiMessage({ messageId: ulid(), conversationId: convId, role: 'assistant', content, contextSnapshot, now: isoNow() });
    setMessages(await getAiMessages(convId));
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
      const aiParams = await resolveParentosTextRuntimeConfig('parentos.advisor', { temperature: 0.5, maxTokens: 1024 });
      await ensureParentosLocalRuntimeReady({
        route: aiParams.route,
        localModelId: aiParams.localModelId,
        timeoutMs: 60_000,
      });
      const out = await rt.ai.text.stream({
        ...aiParams,
        input: [{
          role: 'user',
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
        signal: ac.signal,
        metadata: buildParentosRuntimeMetadata('parentos.advisor'),
      });
      let full = '';
      for await (const part of out.stream) {
        if (part.type === 'delta') {
          full += part.text;
          setStreamingContent(full);
        } else if (part.type === 'error') {
          throw new Error(String(part.error));
        }
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
        const convId = ulid();
        const now = isoNow();
        await createConversation({ conversationId: convId, childId: child.childId, title: topic, now });
        setActiveConvId(convId);
        setConversations(await getConversations(child.childId));

        await runAdvisorTurn({
          conversationId: convId,
          question: opening,
          ageMonthsAtRequest: am,
        });
      } catch { /* bridge */ }
    })();
  }, [searchParams, child, runtimeAvailable]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);

  const handleNewConversation = async () => {
    const convId = ulid();
    try {
      await createConversation({ conversationId: convId, childId: child.childId, title: null, now: isoNow() });
      setActiveConvId(convId); setMessages([]); setRecordRoute(null);
      setConversations(await getConversations(child.childId));
    } catch { /* bridge */ }
  };

  const handleSend = async () => {
    if (!input.trim() || !activeConvId || streamingState === 'streaming') return;
    const q = input.trim(); setInput('');
    try {
      await runAdvisorTurn({
        conversationId: activeConvId,
        question: q,
        ageMonthsAtRequest: ageMonths,
      });
    } catch { /* bridge */ }
  };

  return (
    <div className="flex h-full" style={{ paddingTop: S.topPad }}>
      {/* Conversation sidebar */}
      <div className="w-56 p-3 flex flex-col" style={{ borderRight: `1px solid ${S.border}`, background: '#fafbfa' }}>
        <button onClick={handleNewConversation}
          className="w-full px-3 py-2.5 text-[13px] text-white rounded-xl font-medium hover:opacity-90 mb-3"
          style={{ background: S.blue, boxShadow: '0 2px 8px rgba(134,175,218,0.3)' }}>
          + 新对话
        </button>
        <div className="flex-1 overflow-auto space-y-1">
          {conversations.map((conv) => (
            <button key={conv.conversationId} onClick={() => { setActiveConvId(conv.conversationId); setRecordRoute(null); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-[12px] transition-colors ${activeConvId === conv.conversationId ? 'text-white' : 'hover:bg-black/[0.04]'}`}
              style={activeConvId === conv.conversationId ? { background: S.blue, color: '#fff' } : { color: S.text }}>
              <p className="truncate font-medium">{conv.title ?? '新对话'}</p>
              <p className="text-[10px] mt-0.5 opacity-60">{formatAdvisorConversationDate(conv.lastMessageAt)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeConvId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: '#f0ede8' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c0bdb8" strokeWidth="1.5" strokeLinecap="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-[14px] font-medium" style={{ color: S.text }}>选择或创建一个对话</p>
            <p className="text-[12px]" style={{ color: S.sub }}>AI 顾问基于 {child.displayName} 的档案和本地记录工作</p>
            {runtimeAvailable === false && (
              <p className="text-[11px] mt-1" style={{ color: '#e67e22' }}>nimi runtime 未连接，将使用本地结构化事实</p>
            )}
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {messages.map((msg) => (
                <div key={msg.messageId} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] ${S.radius} px-4 py-3 text-[13px] leading-relaxed`}
                    style={msg.role === 'user' ? { background: S.blue, color: '#fff' } : { background: S.card, color: S.text, boxShadow: S.shadow }}>
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <ChatMarkdownRenderer content={msg.content} appearance="canonical" />
                    )}
                    <p className="text-[10px] mt-1.5 opacity-50">{formatAdvisorMessageTime(msg.createdAt)}</p>
                  </div>
                </div>
              ))}
              {streamingState === 'streaming' && streamingContent && (
                <div className="flex justify-start">
                  <div className={`max-w-[75%] ${S.radius} px-4 py-3 text-[13px] leading-relaxed`} style={{ background: S.card, color: S.text, boxShadow: S.shadow }}>
                    <ChatMarkdownRenderer content={streamingContent} appearance="canonical" />
                    <p className="text-[10px] mt-1.5 animate-pulse" style={{ color: S.blue }}>生成中...</p>
                  </div>
                </div>
              )}
              {streamingState === 'streaming' && !streamingContent && (
                <div className="flex justify-start">
                  <div className={`${S.radius} px-4 py-3 text-[13px] animate-pulse`} style={{ background: '#f0ede8', color: S.sub }}>AI 正在思考...</div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Record data button — shown when navigated from a reminder */}
            {recordRoute && (
              <div className="px-6 pb-2">
                <Link to={recordRoute}
                  className={`flex items-center justify-center gap-2 w-full py-3 ${S.radius} text-[13px] font-medium text-white transition-all hover:opacity-90`}
                  style={{ background: S.accent, boxShadow: '0 2px 8px rgba(148,165,51,0.3)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  去记录数据
                </Link>
              </div>
            )}

            {/* Input */}
            <div className="px-6 py-4" style={{ borderTop: `1px solid ${S.border}` }}>
              <div className="flex gap-3">
                <input value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                  placeholder="输入问题..." className={`flex-1 ${S.radius} px-4 py-2.5 text-[13px] border-0 outline-none`}
                  style={{ background: '#f0ede8', color: S.text }} disabled={streamingState === 'streaming'} />
                {streamingState === 'streaming' ? (
                  <button onClick={() => abortRef.current?.abort()} className="px-5 py-2.5 rounded-xl text-[13px] font-medium text-white" style={{ background: '#e67e22' }}>停止</button>
                ) : (
                  <button onClick={() => void handleSend()} disabled={!input.trim()}
                    className="px-5 py-2.5 rounded-xl text-[13px] font-medium text-white disabled:opacity-40 transition-all hover:opacity-90" style={{ background: S.blue }}>发送</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
