import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentDetail } from '@renderer/hooks/use-agent-queries.js';
import { RuntimeChatPanel } from '@nimiplatform/nimi-kit/features/chat/ui';
import {
  useRuntimeChatSession,
  type RuntimeChatSessionMessage,
} from '@nimiplatform/nimi-kit/features/chat/runtime';

export function PreviewTab({ agent }: { agent: AgentDetail }) {
  const { t } = useTranslation();
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  const dnaRecord = agent.dna && typeof agent.dna === 'object' ? agent.dna : {};
  const primaryType = String(dnaRecord.primaryType || '—');
  const secondaryTraits = Array.isArray(dnaRecord.secondaryTraits)
    ? (dnaRecord.secondaryTraits as string[]).join(', ')
    : '—';
  const systemPrompt = [
    agent.concept ? `Concept: ${agent.concept}` : '',
    agent.scenario ? `Scenario: ${agent.scenario}` : '',
    dnaRecord.primaryType ? `Primary personality: ${String(dnaRecord.primaryType)}` : '',
    secondaryTraits !== '—' ? `Secondary traits: ${secondaryTraits}` : '',
  ].filter(Boolean).join('\n');
  const initialMessages: RuntimeChatSessionMessage[] = agent.greeting
    ? [{
      id: `greeting-${agent.id}`,
      role: 'assistant',
      content: agent.greeting,
      timestamp: new Date().toISOString(),
      status: 'complete',
    }]
    : [];
  const session = useRuntimeChatSession({
    initialMessages,
    resolveRequest: ({ messages }) => ({
      model: 'auto',
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      system: systemPrompt || undefined,
      temperature: 0.8,
      maxTokens: 1024,
    }),
  });
  const resetMessages = session.resetMessages;

  useEffect(() => {
    resetMessages(initialMessages);
  }, [agent.id, resetMessages]);

  function handleResetConversation() {
    resetMessages(initialMessages);
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-700">
            <span className="text-xs text-neutral-400">
              {(agent.displayName || agent.handle || '?')[0]?.toUpperCase()}
            </span>
          </div>
          <span className="text-sm font-medium text-white">{agent.displayName || agent.handle}</span>
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

        <RuntimeChatPanel
          session={session}
          className="rounded-none border-0 bg-transparent shadow-none"
          messagesClassName="h-80"
          userMessageBubbleClassName="rounded-lg bg-white text-black"
          assistantMessageBubbleClassName="rounded-lg bg-neutral-800 text-white"
          composerClassName="border-neutral-800"
          placeholder={t('agentDetail.chatPlaceholder', 'Type a message...')}
          sendLabel={t('agentDetail.send', 'Send')}
          streamingLabel={t('agentDetail.streaming', 'Streaming...')}
          cancelLabel={t('agentDetail.cancel', 'Cancel')}
          resetLabel={t('agentDetail.resetChat', 'Reset')}
          onReset={handleResetConversation}
          actions={(
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
          )}
          emptyState={(
            <p className="py-8 text-center text-sm text-neutral-500">
              {t('agentDetail.noMessages', 'No messages yet')}
            </p>
          )}
        />
      </div>
    </div>
  );
}
