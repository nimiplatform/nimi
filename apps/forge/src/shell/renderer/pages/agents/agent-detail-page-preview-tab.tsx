import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentDetail } from '@renderer/hooks/use-agent-queries.js';
import { getPlatformClient } from '@runtime/platform-client.js';

export function PreviewTab({ agent }: { agent: AgentDetail }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Array<{ role: 'agent' | 'user'; text: string }>>(() => {
    if (agent.greeting) {
      return [{ role: 'agent' as const, text: agent.greeting }];
    }
    return [];
  });
  const [input, setInput] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const dnaRecord = agent.dna && typeof agent.dna === 'object' ? agent.dna : {};
  const primaryType = String(dnaRecord.primaryType || '—');
  const secondaryTraits = Array.isArray(dnaRecord.secondaryTraits)
    ? (dnaRecord.secondaryTraits as string[]).join(', ')
    : '—';

  function handleResetConversation() {
    if (agent.greeting) {
      setMessages([{ role: 'agent', text: agent.greeting }]);
    } else {
      setMessages([]);
    }
  }

  async function handleSend() {
    if (!input.trim() || streaming) return;
    const userMsg = { role: 'user' as const, text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    try {
      const { runtime } = getPlatformClient();
      const chatMessages = messages.map((message) => ({
        role: message.role === 'agent' ? 'assistant' as const : 'user' as const,
        content: message.text,
      }));
      chatMessages.push({ role: 'user', content: userMsg.text });

      const systemPrompt = [
        agent.concept ? `Concept: ${agent.concept}` : '',
        agent.scenario ? `Scenario: ${agent.scenario}` : '',
        dnaRecord.primaryType ? `Primary personality: ${String(dnaRecord.primaryType)}` : '',
        secondaryTraits !== '—' ? `Secondary traits: ${secondaryTraits}` : '',
      ].filter(Boolean).join('\n');

      const result = await runtime.ai.text.stream({
        model: 'auto',
        input: chatMessages,
        system: systemPrompt || undefined,
        temperature: 0.8,
        maxTokens: 1024,
      });

      let agentText = '';
      setMessages((prev) => [...prev, { role: 'agent', text: '' }]);

      for await (const part of result.stream) {
        if (part.type === 'delta') {
          agentText += part.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'agent', text: agentText };
            return updated;
          });
        }
      }
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'agent', text: `Error: ${error instanceof Error ? error.message : 'Failed to generate response'}` }]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-700">
              <span className="text-xs text-neutral-400">
                {(agent.displayName || agent.handle || '?')[0]?.toUpperCase()}
              </span>
            </div>
            <span className="text-sm font-medium text-white">{agent.displayName || agent.handle}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowSystemPrompt((value) => !value)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                showSystemPrompt
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-500 hover:bg-neutral-800 hover:text-white'
              }`}
            >
              {t('agentDetail.systemPrompt', 'System Prompt')}
            </button>
            <button
              onClick={handleResetConversation}
              className="rounded px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white"
            >
              {t('agentDetail.resetChat', 'Reset')}
            </button>
          </div>
        </div>

        {showSystemPrompt ? (
          <div className="space-y-2 border-b border-neutral-800 bg-neutral-950/50 px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-600">
              {t('agentDetail.systemPromptPreview', 'System Prompt Preview')}
            </p>
            <div className="space-y-1 text-xs text-neutral-400">
              <p><span className="text-neutral-600">{t('agentDetail.primaryLabel', 'Primary:')}</span> {primaryType}</p>
              <p><span className="text-neutral-600">{t('agentDetail.secondaryLabel', 'Secondary:')}</span> {secondaryTraits}</p>
              {agent.concept ? (
                <p><span className="text-neutral-600">{t('agentDetail.conceptLabel', 'Concept:')}</span> {agent.concept}</p>
              ) : null}
              {agent.scenario ? (
                <p><span className="text-neutral-600">{t('agentDetail.scenarioLabel', 'Scenario:')}</span> {agent.scenario}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="h-80 space-y-3 overflow-auto p-4">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              {t('agentDetail.noMessages', 'No messages yet')}
            </p>
          ) : (
            messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    message.role === 'user'
                      ? 'bg-white text-black'
                      : 'bg-neutral-800 text-white'
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 border-t border-neutral-800 p-3">
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
            placeholder={t('agentDetail.chatPlaceholder', 'Type a message...')}
            className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
          >
            {streaming ? t('agentDetail.streaming', 'Streaming...') : t('agentDetail.send', 'Send')}
          </button>
        </div>
      </div>
    </div>
  );
}
