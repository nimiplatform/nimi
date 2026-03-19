/**
 * AI Advisor Hub Page (FG-ADV-002..004)
 *
 * Advisor selection and chat interface for World, Agent, and Revenue advisors.
 * Requires runtime text.stream — shows selection UI + notice.
 * Sessions persist in localStorage per advisor type.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';

type AdvisorType = 'world' | 'agent' | 'revenue';

const ADVISORS: Array<{
  type: AdvisorType;
  icon: string;
  titleKey: string;
  descKey: string;
}> = [
  {
    type: 'world',
    icon: '🌍',
    titleKey: 'advisors.worldAdvisor',
    descKey: 'advisors.worldAdvisorDesc',
  },
  {
    type: 'agent',
    icon: '🤖',
    titleKey: 'advisors.agentCoach',
    descKey: 'advisors.agentCoachDesc',
  },
  {
    type: 'revenue',
    icon: '💰',
    titleKey: 'advisors.revenueOptimizer',
    descKey: 'advisors.revenueOptimizerDesc',
  },
];

type Message = { role: 'user' | 'assistant'; content: string; timestamp: string };

const STORAGE_KEY_PREFIX = 'nimi:forge:advisor:session:';

function loadSession(advisorType: AdvisorType): Message[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${advisorType}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSession(advisorType: AdvisorType, messages: Message[]): void {
  try {
    if (messages.length === 0) {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${advisorType}`);
    } else {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${advisorType}`, JSON.stringify(messages));
    }
  } catch {
    // localStorage may be unavailable
  }
}

function hasPersistedSession(advisorType: AdvisorType): boolean {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${advisorType}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export default function AdvisorHubPage() {
  const { t } = useTranslation();
  const [selectedAdvisor, setSelectedAdvisor] = useState<AdvisorType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  // Load persisted session when advisor is selected
  useEffect(() => {
    if (selectedAdvisor) {
      setMessages(loadSession(selectedAdvisor));
    }
  }, [selectedAdvisor]);

  // Persist messages whenever they change
  useEffect(() => {
    if (selectedAdvisor) {
      saveSession(selectedAdvisor, messages);
    }
  }, [selectedAdvisor, messages]);

  const handleNewSession = useCallback(() => {
    setMessages([]);
    if (selectedAdvisor) {
      saveSession(selectedAdvisor, []);
    }
  }, [selectedAdvisor]);

  const handleBack = useCallback(() => {
    setSelectedAdvisor(null);
    setMessages([]);
    setInput('');
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming || !selectedAdvisor) return;
    const userMsg: Message = { role: 'user', content: input, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    try {
      const { runtime } = getPlatformClient();
      const chatMessages = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      chatMessages.push({ role: 'user', content: userMsg.content });

      const systemPrompts: Record<AdvisorType, string> = {
        world: 'You are a World Advisor for nimi creators. Analyze world events, lorebooks, worldview for timeline consistency, plot holes, and character contradictions. Be specific and actionable.',
        agent: 'You are an Agent Coach for nimi creators. Analyze agent DNA traits, conversation samples for trait balance, personality coherence, and engagement optimization. Be specific and actionable.',
        revenue: 'You are a Revenue Optimizer for nimi creators. Analyze earnings, content performance, and agent monetization for pricing strategy, timing, and undermonetized assets. Be specific and actionable.',
      };

      const result = await runtime.ai.text.stream({
        model: 'auto',
        input: chatMessages,
        system: systemPrompts[selectedAdvisor],
        temperature: 0.7,
        maxTokens: 2048,
      });

      let assistantText = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }]);

      for await (const part of result.stream) {
        if (part.type === 'delta') {
          assistantText += part.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: assistantText, timestamp: new Date().toISOString() };
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to generate response'}`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, selectedAdvisor, messages]);

  const handleGenerateReport = useCallback(async () => {
    if (streaming || !selectedAdvisor) return;
    setStreaming(true);
    const reportPrompts: Record<AdvisorType, string> = {
      world: 'Generate a comprehensive world analysis report covering timeline consistency, plot holes, character contradictions, and improvement recommendations.',
      agent: 'Generate a comprehensive agent coaching report covering trait balance, personality coherence, engagement patterns, and optimization recommendations.',
      revenue: 'Generate a comprehensive revenue optimization report covering pricing strategy, content monetization, timing recommendations, and growth opportunities.',
    };
    const reportMsg: Message = { role: 'user', content: `[Report Request] ${reportPrompts[selectedAdvisor]}`, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, reportMsg]);
    try {
      const { runtime } = getPlatformClient();
      const result = await runtime.ai.text.stream({
        model: 'auto',
        input: reportPrompts[selectedAdvisor],
        system: `You are a ${selectedAdvisor} advisor. Generate a detailed analysis report in markdown format.`,
        temperature: 0.5,
        maxTokens: 4096,
      });
      let text = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }]);
      for await (const part of result.stream) {
        if (part.type === 'delta') {
          text += part.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: text, timestamp: new Date().toISOString() };
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to generate report'}`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setStreaming(false);
    }
  }, [streaming, selectedAdvisor]);

  if (!selectedAdvisor) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.advisorHub')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('advisors.subtitle', 'AI-powered analysis and recommendations for your content')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {ADVISORS.map((advisor) => {
              const hasPrior = hasPersistedSession(advisor.type);
              return (
                <button
                  key={advisor.type}
                  onClick={() => setSelectedAdvisor(advisor.type)}
                  className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 text-left hover:border-neutral-600 transition-colors"
                >
                  <div className="text-3xl mb-3">{advisor.icon}</div>
                  <p className="text-sm font-semibold text-white">
                    {t(advisor.titleKey, advisor.type)}
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    {t(advisor.descKey, `${advisor.type} advisor description`)}
                  </p>
                  <div className="mt-4 text-xs text-cyan-400 font-medium">
                    {hasPrior
                      ? t('advisors.resumeSession', 'Resume Session') + ' \u2192'
                      : t('advisors.startSession', 'Start Session') + ' \u2192'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const currentAdvisor = ADVISORS.find((a) => a.type === selectedAdvisor)!;

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mx-auto max-w-4xl w-full flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="rounded px-2 py-1 text-sm text-neutral-400 hover:text-white transition-colors"
            >
              &larr; {t('advisors.backToHub', 'Advisors')}
            </button>
            <span className="text-xl">{currentAdvisor.icon}</span>
            <h2 className="text-lg font-bold text-white">
              {t(currentAdvisor.titleKey, currentAdvisor.type)}
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleGenerateReport()}
              disabled={streaming}
              className="rounded px-3 py-1.5 text-xs font-medium bg-white text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {streaming ? t('advisors.generating', 'Generating...') : t('advisors.generateReport', 'Generate Report')}
            </button>
            <button
              onClick={handleNewSession}
              className="rounded px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white transition-colors"
            >
              {t('advisors.newSession', 'New Session')}
            </button>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 min-h-0 rounded-lg border border-neutral-800 bg-neutral-900/50 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-4xl text-neutral-700 mb-2">{currentAdvisor.icon}</div>
                  <p className="text-sm text-neutral-500">
                    {t('advisors.emptyChat', 'Start by asking a question or generating a report.')}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`rounded-lg px-3 py-2 text-sm max-w-[80%] ${
                      msg.role === 'user'
                        ? 'bg-white text-black'
                        : 'bg-neutral-800 text-white'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <div className="border-t border-neutral-800 p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={t('advisors.inputPlaceholder', 'Ask the advisor...')}
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
            <button
              onClick={() => void handleSend()}
              disabled={streaming || !input.trim()}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
            >
              {streaming ? t('advisors.streaming', 'Streaming...') : t('advisors.send', 'Send')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
