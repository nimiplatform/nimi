import { useMemo } from 'react';
import { Avatar, cn } from '@nimiplatform/kit/ui';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import { CanonicalTranscriptView } from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';
import type {
  ChatComposerAdapter,
  ConversationCanonicalMessage,
} from '@nimiplatform/kit/features/chat/types';
import type { HeroDemo } from '../content/landing-content.js';
import { BackIcon } from './demo-icons.js';

type DemoChat = HeroDemo['chat'];

const AGENT_GRADIENTS = [
  'bg-gradient-to-br from-[#2fc79a] to-[#22cce7] text-slate-950',
  'bg-gradient-to-br from-[#8b93f8] to-[#6d28d9] text-white',
  'bg-gradient-to-br from-[#94a3b8] to-[#475569] text-white',
] as const;

export function materializeAgentMessages(chat: DemoChat): Record<string, ConversationCanonicalMessage[]> {
  const now = Date.now();
  const result: Record<string, ConversationCanonicalMessage[]> = {};
  for (const agent of chat.agents) {
    result[agent.id] = agent.messages.map((seed) => ({
      id: seed.id,
      sessionId: `demo-${agent.id}`,
      targetId: agent.id,
      source: 'agent',
      role: seed.role,
      text: seed.text,
      createdAt: new Date(now - seed.minutesAgo * 60_000).toISOString(),
      status: 'complete',
      kind: 'text',
      senderName: seed.role === 'user' ? chat.userName : agent.name,
      senderKind: seed.role === 'user' ? 'human' : 'agent',
    }));
  }
  return result;
}

function DemoAgentRail({
  chat,
  activeAgentId,
  onOpenAgent,
  orientation,
}: {
  chat: DemoChat;
  activeAgentId: string | null;
  onOpenAgent: (agentId: string) => void;
  orientation: 'vertical' | 'horizontal';
}) {
  return (
    <ul
      className={cn(
        'flex shrink-0 gap-2.5',
        orientation === 'vertical'
          ? 'w-12 flex-col items-center pt-1'
          : 'flex-row items-center px-1 pt-1',
      )}
    >
      {chat.agents.map((agent, index) => {
        const active = agent.id === activeAgentId;
        return (
          <li key={agent.id}>
            <button
              type="button"
              aria-label={agent.name}
              aria-pressed={active}
              onClick={() => onOpenAgent(agent.id)}
              className={cn(
                'flex items-center justify-center rounded-full transition hover:-translate-y-0.5',
                active && 'ring-2 ring-[var(--nimi-action-primary-bg)] ring-offset-2 ring-offset-transparent',
              )}
            >
              <Avatar
                alt={agent.name}
                size="md"
                className={AGENT_GRADIENTS[index % AGENT_GRADIENTS.length]}
                fallback={<span className="text-sm font-bold">{agent.initial}</span>}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function DemoChatSurface({
  chat,
  activeAgentId,
  baseMessages,
  localMessages,
  onOpenAgent,
  onBack,
  onSubmit,
}: {
  chat: DemoChat;
  activeAgentId: string | null;
  baseMessages: Record<string, ConversationCanonicalMessage[]>;
  localMessages: Readonly<Record<string, readonly ConversationCanonicalMessage[]>>;
  onOpenAgent: (agentId: string) => void;
  onBack: () => void;
  onSubmit: (text: string) => void;
}) {
  const activeAgent = chat.agents.find((agent) => agent.id === activeAgentId) ?? null;

  const composerAdapter = useMemo<ChatComposerAdapter>(() => ({
    submit: ({ text }) => {
      onSubmit(text);
    },
  }), [onSubmit]);

  const formatDateLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(chat.dateLocale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return ({ date, diffDays }: { timestamp: string; date: Date; diffDays: number }): string => {
      if (diffDays === 0) return chat.dateLabels.today;
      if (diffDays === 1) return chat.dateLabels.yesterday;
      return formatter.format(date);
    };
  }, [chat]);

  const messages = activeAgent
    ? [...(baseMessages[activeAgent.id] ?? []), ...(localMessages[activeAgent.id] ?? [])]
    : [];

  return (
    <div className="flex h-full min-h-0 gap-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="md:hidden">
          <DemoAgentRail chat={chat} activeAgentId={activeAgentId} onOpenAgent={onOpenAgent} orientation="horizontal" />
        </div>
        {activeAgent ? (
          <>
            <div className="flex items-center gap-2 px-2 pb-1 pt-1">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-surface-card)] px-3 py-1.5 text-xs font-semibold text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-surface-active)]"
              >
                <BackIcon />
                {chat.backLabel}
              </button>
              <span className="truncate text-sm font-semibold tracking-tight text-[var(--nimi-text-primary)]">
                {activeAgent.name}
              </span>
            </div>
            <CanonicalTranscriptView
              messages={messages}
              copy={chat.copy}
              agentName={activeAgent.name}
              formatDateLabel={formatDateLabel}
              widthClassName="w-full max-w-[720px]"
              widthPositionClassName="mx-auto"
            />
            <CanonicalComposer
              adapter={composerAdapter}
              placeholder={chat.inputPlaceholder}
              sendLabel={chat.sendLabel}
              widthClassName="w-full max-w-[720px]"
            />
          </>
        ) : (
          <CanonicalTranscriptView
            messages={[]}
            copy={chat.copy}
            emptyEyebrow=""
            emptyTitle={chat.greeting}
            emptyDescription=""
            emptyStateContent={(
              <CanonicalComposer
                adapter={composerAdapter}
                layout="stacked"
                placeholder={chat.inputPlaceholder}
                sendLabel={chat.sendLabel}
                widthClassName="w-full"
              />
            )}
            formatDateLabel={formatDateLabel}
            widthClassName="w-full"
          />
        )}
        <p className="shrink-0 px-6 pb-2 text-[11px] leading-5 text-[var(--nimi-text-muted)]">{chat.inputNote}</p>
      </div>
      <div className="hidden md:flex">
        <DemoAgentRail chat={chat} activeAgentId={activeAgentId} onOpenAgent={onOpenAgent} orientation="vertical" />
      </div>
    </div>
  );
}
