import { useEffect, useRef, useState } from 'react';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
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

type StreamingState = 'idle' | 'streaming';

function buildSystemPrompt(childName: string, ageMonths: number, gender: string, nurtureMode: string): string {
  return `你是“成长底稿”的 AI 成长顾问，只能在已审核知识领域内提供解释。

当前孩子信息：
- 姓名：${childName}
- 月龄：${ageMonths} 个月
- 性别：${gender === 'male' ? '男' : '女'}
- 养育模式：${nurtureMode}

已审核领域：${REVIEWED_DOMAINS.join('、')}
禁止自由生成解释的领域：${NEEDS_REVIEW_DOMAINS.join('、')}

回答要求：
- 只使用温和、中性的表达，如“观察到”“可能”“倾向于”。
- 不得出现“发育迟缓”“异常”“障碍”。
- 不得出现“应该吃”“建议用药”“建议服用”“推荐治疗”。
- 不得出现“落后”“危险”“警告”。
- 如涉及数据异常，只能描述结构化事实，并提醒“建议咨询专业人士”。
- 回答结尾不要自行编造来源标签，来源会由系统追加。`;
}

export default function AdvisorPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [streamingState, setStreamingState] = useState<StreamingState>('idle');
  const [streamingContent, setStreamingContent] = useState('');
  const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
      } catch {
        setRuntimeAvailable(false);
      }
    }

    checkRuntime();
  }, []);

  if (!child) {
    return <div className="p-8 text-gray-500">请先添加孩子</div>;
  }

  const ageMonths = computeAgeMonths(child.birthDate);

  const handleNewConversation = async () => {
    const conversationId = ulid();
    const now = isoNow();
    try {
      await createConversation({
        conversationId,
        childId: child.childId,
        title: null,
        now,
      });
      setActiveConvId(conversationId);
      setMessages([]);
      setConversations(await getConversations(child.childId));
    } catch {
      // Tauri bridge unavailable in browser-only mode.
    }
  };

  const saveAssistantMessage = async (conversationId: string, content: string) => {
    await insertAiMessage({
      messageId: ulid(),
      conversationId,
      role: 'assistant',
      content,
      contextSnapshot: null,
      now: isoNow(),
    });
    setMessages(await getAiMessages(conversationId));
  };

  const handleSend = async () => {
    if (!input.trim() || !activeConvId || streamingState === 'streaming') return;

    const question = input.trim();
    setInput('');

    try {
      await insertAiMessage({
        messageId: ulid(),
        conversationId: activeConvId,
        role: 'user',
        content: question,
        contextSnapshot: JSON.stringify({
          childId: child.childId,
          ageMonths,
          nurtureMode: child.nurtureMode,
        }),
        now: isoNow(),
      });

      const updatedAfterUser = await getAiMessages(activeConvId);
      setMessages(updatedAfterUser);

      const domains = inferRequestedDomains(question);
      const snapshot = {
        child: {
          displayName: child.displayName,
          gender: child.gender,
          birthDate: child.birthDate,
          nurtureMode: child.nurtureMode,
        },
        ageMonths,
        measurements: await getMeasurements(child.childId),
        vaccines: await getVaccineRecords(child.childId),
        milestones: await getMilestoneRecords(child.childId),
        journalEntries: await getJournalEntries(child.childId, 20),
      };

      if (!runtimeAvailable || !canUseAdvisorRuntime(domains)) {
        const fallback = buildStructuredAdvisorFallback(question, domains, snapshot);
        await saveAssistantMessage(activeConvId, fallback);
        return;
      }

      setStreamingState('streaming');
      setStreamingContent('');

      try {
        const { getPlatformClient } = await import('@nimiplatform/sdk');
        const runtime = getPlatformClient().runtime;
        const abortController = new AbortController();
        abortRef.current = abortController;

        const output = await runtime.ai.text.stream({
          model: 'auto',
          input: updatedAfterUser.map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content,
          })),
          system: buildSystemPrompt(child.displayName, ageMonths, child.gender, child.nurtureMode),
          temperature: 0.5,
          maxTokens: 1024,
          signal: abortController.signal,
          metadata: {
            callerKind: 'third-party-app',
            callerId: 'app.nimi.parentos',
            surfaceId: 'parentos.advisor',
          },
        });

        let fullText = '';
        for await (const part of output.stream) {
          if (part.type === 'delta') {
            fullText += part.text;
            setStreamingContent(fullText);
          } else if (part.type === 'error') {
            throw new Error(String(part.error));
          }
        }

        const filtered = filterAIResponse(fullText).filtered;
        const assistantContent = appendAdvisorSources(filtered, domains);
        await saveAssistantMessage(activeConvId, assistantContent);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        const fallback = buildStructuredAdvisorFallback(question, domains, snapshot);
        await saveAssistantMessage(
          activeConvId,
          `${fallback}\n\n补充说明：运行时响应失败，已退回本地结构化事实。`,
        );
      } finally {
        setStreamingState('idle');
        setStreamingContent('');
        abortRef.current = null;
      }
    } catch {
      // Tauri bridge unavailable in browser-only mode.
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex h-full">
      <div className="w-56 border-r bg-gray-50 p-3 flex flex-col">
        <button
          onClick={handleNewConversation}
          className="w-full px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 mb-3"
        >
          + 新对话
        </button>
        <div className="flex-1 overflow-auto space-y-1">
          {conversations.map((conversation) => (
            <button
              key={conversation.conversationId}
              onClick={() => setActiveConvId(conversation.conversationId)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                activeConvId === conversation.conversationId
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <p className="truncate">{conversation.title ?? '新对话'}</p>
              <p className="text-xs text-gray-400">{conversation.lastMessageAt.split('T')[0]}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {!activeConvId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
            <p>选择或创建一个对话</p>
            <p className="text-xs">AI 顾问基于 {child.displayName} 的档案和本地记录工作</p>
            <p className="text-xs text-amber-600">
              已审核领域：{REVIEWED_DOMAINS.join('、')} | 其他领域仅返回结构化事实
            </p>
            {runtimeAvailable === false && (
              <p className="text-xs text-red-500 mt-2">nimi runtime 未连接，AI 自由生成暂不可用</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.messageId}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-4 py-2.5 text-sm ${
                      message.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    <p className="text-xs mt-1 opacity-60">
                      {message.createdAt.split('T')[1]?.split('.')[0]}
                    </p>
                  </div>
                </div>
              ))}
              {streamingState === 'streaming' && streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-lg px-4 py-2.5 text-sm bg-gray-100 text-gray-800">
                    <p className="whitespace-pre-wrap">{streamingContent}</p>
                    <p className="text-xs mt-1 text-indigo-500 animate-pulse">生成中...</p>
                  </div>
                </div>
              )}
              {streamingState === 'streaming' && !streamingContent && (
                <div className="flex justify-start">
                  <div className="rounded-lg px-4 py-2.5 text-sm bg-gray-100 text-gray-500 animate-pulse">
                    AI 正在思考...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t p-4">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="输入问题..."
                  className="flex-1 border rounded-md px-3 py-2 text-sm"
                  disabled={streamingState === 'streaming'}
                />
                {streamingState === 'streaming' ? (
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 text-sm bg-red-500 text-white rounded-md hover:bg-red-600"
                  >
                    停止
                  </button>
                ) : (
                  <button
                    onClick={() => void handleSend()}
                    disabled={!input.trim()}
                    className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  >
                    发送
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
