import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { NEEDS_REVIEW_DOMAINS, REVIEWED_DOMAINS } from '../../knowledge-base/index.js';
import { filterAIResponse } from '../../engine/ai-safety-filter.js';
import {
  createConversation,
  getAiMessages,
  getConversations,
  getJournalEntries,
  getMeasurements,
  getMilestoneRecords,
  getVaccineRecords,
  insertAiMessage,
} from '../../bridge/sqlite-bridge.js';
import type { AiMessageRow, ConversationRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import {
  appendAdvisorSources,
  buildStructuredAdvisorFallback,
  canUseAdvisorRuntime,
  inferRequestedDomains,
} from './advisor-boundary.js';

/* design tokens imported from shared page-style */

type StreamingState = 'idle' | 'streaming';

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

function buildSystemPrompt(childName: string, ageMonths: number, gender: string, nurtureMode: string): string {
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

  const saveAssistantMsg = async (convId: string, content: string) => {
    await insertAiMessage({ messageId: ulid(), conversationId: convId, role: 'assistant', content, contextSnapshot: null, now: isoNow() });
    setMessages(await getAiMessages(convId));
  };

  useEffect(() => {
    if (!activeChildId) return;
    getConversations(activeChildId).then(setConversations).catch(() => {});
  }, [activeChildId]);

  useEffect(() => {
    if (!activeConvId) return;
    getAiMessages(activeConvId).then(setMessages).catch(() => {});
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    async function checkRuntime() {
      try {
        const { getPlatformClient } = await import('@nimiplatform/sdk');
        const client = getPlatformClient();
        setRuntimeAvailable(Boolean(client.runtime && client.runtime.appId));
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

        await insertAiMessage({ messageId: ulid(), conversationId: convId, role: 'user', content: opening, contextSnapshot: JSON.stringify({ childId: child.childId, ageMonths: am, nurtureMode: child.nurtureMode }), now: isoNow() });
        const msgs = await getAiMessages(convId);
        setMessages(msgs);

        const domains = inferRequestedDomains(opening);
        const snapshot = {
          child: { displayName: child.displayName, gender: child.gender, birthDate: child.birthDate, nurtureMode: child.nurtureMode },
          ageMonths: am, measurements: await getMeasurements(child.childId), vaccines: await getVaccineRecords(child.childId),
          milestones: await getMilestoneRecords(child.childId), journalEntries: await getJournalEntries(child.childId, 20),
        };

        if (!runtimeAvailable || !canUseAdvisorRuntime(domains)) {
          await saveAssistantMsg(convId, buildStructuredAdvisorFallback(opening, domains, snapshot));
          return;
        }

        setStreamingState('streaming'); setStreamingContent('');
        try {
          const { getPlatformClient } = await import('@nimiplatform/sdk');
          const rt = getPlatformClient().runtime;
          const ac = new AbortController(); abortRef.current = ac;
          const out = await rt.ai.text.stream({
            model: 'auto', input: msgs.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            system: buildSystemPrompt(child.displayName, am, child.gender, child.nurtureMode),
            temperature: 0.5, maxTokens: 1024, signal: ac.signal,
            metadata: { callerKind: 'third-party-app', callerId: 'app.nimi.parentos', surfaceId: 'parentos.advisor' },
          });
          let full = '';
          for await (const p of out.stream) { if (p.type === 'delta') { full += p.text; setStreamingContent(full); } else if (p.type === 'error') throw new Error(String(p.error)); }
          await saveAssistantMsg(convId, appendAdvisorSources(filterAIResponse(full).filtered, domains));
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          await saveAssistantMsg(convId, `${buildStructuredAdvisorFallback(opening, domains, snapshot)}\n\n补充说明：运行时响应失败，已退回本地结构化事实。`);
        } finally { setStreamingState('idle'); setStreamingContent(''); abortRef.current = null; }
      } catch { /* bridge */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await insertAiMessage({ messageId: ulid(), conversationId: activeConvId, role: 'user', content: q, contextSnapshot: JSON.stringify({ childId: child.childId, ageMonths, nurtureMode: child.nurtureMode }), now: isoNow() });
      const updated = await getAiMessages(activeConvId); setMessages(updated);
      const domains = inferRequestedDomains(q);
      const snapshot = { child: { displayName: child.displayName, gender: child.gender, birthDate: child.birthDate, nurtureMode: child.nurtureMode }, ageMonths, measurements: await getMeasurements(child.childId), vaccines: await getVaccineRecords(child.childId), milestones: await getMilestoneRecords(child.childId), journalEntries: await getJournalEntries(child.childId, 20) };
      if (!runtimeAvailable || !canUseAdvisorRuntime(domains)) { await saveAssistantMsg(activeConvId, buildStructuredAdvisorFallback(q, domains, snapshot)); return; }

      setStreamingState('streaming'); setStreamingContent('');
      try {
        const { getPlatformClient } = await import('@nimiplatform/sdk');
        const rt = getPlatformClient().runtime; const ac = new AbortController(); abortRef.current = ac;
        const out = await rt.ai.text.stream({ model: 'auto', input: updated.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })), system: buildSystemPrompt(child.displayName, ageMonths, child.gender, child.nurtureMode), temperature: 0.5, maxTokens: 1024, signal: ac.signal, metadata: { callerKind: 'third-party-app', callerId: 'app.nimi.parentos', surfaceId: 'parentos.advisor' } });
        let full = '';
        for await (const p of out.stream) { if (p.type === 'delta') { full += p.text; setStreamingContent(full); } else if (p.type === 'error') throw new Error(String(p.error)); }
        await saveAssistantMsg(activeConvId, appendAdvisorSources(filterAIResponse(full).filtered, domains));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        await saveAssistantMsg(activeConvId, `${buildStructuredAdvisorFallback(q, domains, snapshot)}\n\n补充说明：运行时响应失败，已退回本地结构化事实。`);
      } finally { setStreamingState('idle'); setStreamingContent(''); abortRef.current = null; }
    } catch { /* bridge */ }
  };

  return (
    <div className="flex h-full" style={{ background: S.bg, paddingTop: S.topPad }}>
      {/* Conversation sidebar */}
      <div className="w-56 p-3 flex flex-col" style={{ borderRight: `1px solid ${S.border}`, background: S.bg }}>
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
              <p className="text-[10px] mt-0.5 opacity-60">{conv.lastMessageAt.split('T')[0]}</p>
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
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[10px] mt-1.5 opacity-50">{msg.createdAt.split('T')[1]?.split('.')[0]}</p>
                  </div>
                </div>
              ))}
              {streamingState === 'streaming' && streamingContent && (
                <div className="flex justify-start">
                  <div className={`max-w-[75%] ${S.radius} px-4 py-3 text-[13px] leading-relaxed`} style={{ background: S.card, color: S.text, boxShadow: S.shadow }}>
                    <p className="whitespace-pre-wrap">{streamingContent}</p>
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
