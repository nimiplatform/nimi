import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, IconButton, cn } from '@nimiplatform/kit/ui';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import { CanonicalTranscriptView } from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';
import { ChatStreamStatus } from '@nimiplatform/kit/features/chat/components/chat-stream-status';
import type {
  ChatComposerAdapter,
  ConversationCanonicalMessage,
} from '@nimiplatform/kit/features/chat/types';
import type { HeroDemoChatCopy, HeroDemoZhiyuPreview } from '../content/landing-content.js';
import { CloseIcon, SlidersIcon } from './demo-icons.js';

const PARTNER_GRADIENTS = [
  'bg-gradient-to-br from-[#34d399] to-[#0d9488] text-white',
  'bg-gradient-to-br from-[#8b93f8] to-[#6d28d9] text-white',
  'bg-gradient-to-br from-[#f9a8d4] to-[#c026d9] text-white',
] as const;

// Zhiyu normalizes sender names to 你 / partner name in its own shell.
const ZHIYU_USER_NAME = '你';
const ZHIYU_COPY: HeroDemoChatCopy = {
  bubbleUserLabel: '你',
  bubbleAssistantLabel: '伙伴',
  typingAgentRoleLabel: '伙伴',
  typingThinkingLabel: '正在思考',
  typingStopLabel: '停止',
};

function materializePartnerMessages(content: HeroDemoZhiyuPreview): Record<string, ConversationCanonicalMessage[]> {
  const now = Date.now();
  const result: Record<string, ConversationCanonicalMessage[]> = {};
  for (const partner of content.partners) {
    result[partner.id] = partner.messages.map((seed) => ({
      id: seed.id,
      sessionId: `zhiyu-${partner.id}`,
      targetId: partner.id,
      source: 'agent',
      role: seed.role,
      text: seed.text,
      createdAt: new Date(now - seed.minutesAgo * 60_000).toISOString(),
      status: 'complete',
      kind: 'text',
      senderName: seed.role === 'user' ? ZHIYU_USER_NAME : partner.name,
      senderKind: seed.role === 'user' ? 'human' : 'agent',
    }));
  }
  return result;
}

export function DemoZhiyuPreview({ content }: { content: HeroDemoZhiyuPreview }) {
  const [activePartnerId, setActivePartnerId] = useState<string | null>(content.partners[0]?.id ?? null);
  const [localMessages, setLocalMessages] = useState<Readonly<Record<string, readonly ConversationCanonicalMessage[]>>>({});
  const [stream, setStream] = useState<{ partnerId: string; partial: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const baseMessages = useMemo(() => materializePartnerMessages(content), [content]);
  const activePartner = content.partners.find((partner) => partner.id === activePartnerId) ?? null;

  const clearStreamTimer = () => {
    if (streamTimerRef.current !== null) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  };
  useEffect(() => clearStreamTimer, []);

  const appendMessage = (partnerId: string, message: ConversationCanonicalMessage) => {
    setLocalMessages((prev) => ({
      ...prev,
      [partnerId]: [...(prev[partnerId] ?? []), message],
    }));
  };

  const buildMessage = (
    partnerId: string,
    role: 'user' | 'assistant',
    text: string,
    stamp: number,
  ): ConversationCanonicalMessage => ({
    id: `zhiyu-local-${stamp}-${role}`,
    sessionId: `zhiyu-${partnerId}`,
    targetId: partnerId,
    source: 'agent',
    role,
    text,
    createdAt: new Date(stamp).toISOString(),
    status: 'complete',
    kind: 'text',
    senderName: role === 'user' ? ZHIYU_USER_NAME : (content.partners.find((p) => p.id === partnerId)?.name ?? ''),
    senderKind: role === 'user' ? 'human' : 'agent',
  });

  const finishStream = (partnerId: string, text: string) => {
    clearStreamTimer();
    setStream(null);
    if (text.trim().length > 0) {
      appendMessage(partnerId, buildMessage(partnerId, 'assistant', text, Date.now()));
    }
  };

  const composerAdapter = useMemo<ChatComposerAdapter>(() => ({
    submit: ({ text }) => {
      const partnerId = activePartnerId;
      if (!partnerId) return;
      const stamp = Date.now();
      appendMessage(partnerId, buildMessage(partnerId, 'user', text, stamp));
      clearStreamTimer();
      let offset = 0;
      setStream({ partnerId, partial: '' });
      streamTimerRef.current = setInterval(() => {
        offset += 2;
        const partial = content.streamReplyText.slice(0, offset);
        if (offset >= content.streamReplyText.length) {
          finishStream(partnerId, content.streamReplyText);
        } else {
          setStream({ partnerId, partial });
        }
      }, 80);
    },
  }), [activePartnerId, content]);

  const messages = activePartner
    ? [...(baseMessages[activePartner.id] ?? []), ...(localMessages[activePartner.id] ?? [])]
    : [];
  const streamingHere = stream !== null && stream.partnerId === activePartnerId;

  return (
    <div className="flex h-full min-h-0 bg-gradient-to-br from-[#eef7f1] via-[#eef2fd] to-[#f4ecff]">
      <div className="flex w-14 shrink-0 flex-col items-center gap-3 py-4">
        <span className="text-[10px] font-bold tracking-widest text-[var(--nimi-text-muted)]">{content.partnersLabel}</span>
        <ul className="flex flex-col items-center gap-2.5">
          {content.partners.map((partner, index) => {
            const active = partner.id === activePartnerId;
            return (
              <li key={partner.id}>
                <button
                  type="button"
                  aria-label={partner.name}
                  aria-pressed={active}
                  onClick={() => setActivePartnerId(partner.id)}
                  className={cn(
                    'flex items-center justify-center rounded-full transition hover:-translate-y-0.5',
                    active && 'ring-2 ring-[#10b981] ring-offset-2 ring-offset-transparent',
                  )}
                >
                  <Avatar
                    alt={partner.name}
                    size="md"
                    className={PARTNER_GRADIENTS[index % PARTNER_GRADIENTS.length]}
                    fallback={<span className="text-sm font-bold">{Array.from(partner.name)[0]}</span>}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activePartner ? (
          <CanonicalTranscriptView
            messages={messages}
            copy={ZHIYU_COPY}
            agentName={activePartner.name}
            widthClassName="w-full max-w-[720px]"
            widthPositionClassName="mx-auto"
          />
        ) : (
          <CanonicalTranscriptView
            messages={[]}
            copy={ZHIYU_COPY}
            emptyEyebrow="ZHIYU"
            emptyTitle={content.emptyTitle}
            emptyDescription={content.emptyDescription}
            widthClassName="w-full"
          />
        )}
        {streamingHere ? (
          <div className="px-6">
            <ChatStreamStatus
              mode="streaming"
              partialText={stream.partial}
              reasoningLabel="思考片段"
              actions={(
                <button
                  type="button"
                  onClick={() => finishStream(stream.partnerId, stream.partial)}
                  className="ml-2 rounded-full border border-[var(--nimi-border-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-surface-active)]"
                >
                  {content.stopLabel}
                </button>
              )}
            />
          </div>
        ) : null}
        <CanonicalComposer
          adapter={composerAdapter}
          layout="stacked"
          placeholder={content.composerPlaceholder}
          sendLabel={content.sendLabel}
          widthClassName="w-full max-w-[720px]"
          trailingSlot={(
            <IconButton
              aria-label={content.panelTitle}
              aria-pressed={panelOpen}
              active={panelOpen}
              icon={<SlidersIcon />}
              size="sm"
              onClick={() => setPanelOpen((open) => !open)}
            />
          )}
        />
        <div className="flex shrink-0 flex-wrap gap-1.5 px-5 pb-3">
          <span className="rounded-full bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]">
            {content.sessionChipLabel} · {activePartner ? content.readyChipLabel : '—'}
          </span>
          <span className="rounded-full bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]">
            {content.replyChipLabel} · {stream ? content.streamingChipLabel : content.readyChipLabel}
          </span>
          <span className="rounded-full bg-[var(--nimi-surface-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--nimi-text-secondary)]">
            {content.rapportChipLabel} · {activePartner?.cue ?? content.rapportChipText}
          </span>
        </div>
      </div>

      {panelOpen ? (
        <div className="hidden w-[240px] shrink-0 flex-col border-l border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4 md:flex">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--nimi-text-primary)]">{content.panelTitle}</span>
            <IconButton aria-label={content.panelCloseLabel} icon={<CloseIcon />} size="sm" onClick={() => setPanelOpen(false)} />
          </div>
          {activePartner ? (
            <div className="mt-3 flex items-center gap-2">
              <Avatar
                alt={activePartner.name}
                size="sm"
                className={PARTNER_GRADIENTS[content.partners.indexOf(activePartner) % PARTNER_GRADIENTS.length]}
                fallback={<span className="text-xs font-bold">{Array.from(activePartner.name)[0]}</span>}
              />
              <span className="text-sm font-medium text-[var(--nimi-text-primary)]">{activePartner.name}</span>
              <span className="rounded-full bg-[#10b981]/15 px-2 py-0.5 text-[10px] font-medium text-[#047857]">
                {activePartner.cue}
              </span>
            </div>
          ) : null}
          <ul className="mt-4 divide-y divide-[var(--nimi-border-subtle)] rounded-xl bg-[var(--nimi-surface-card)]">
            {content.panelRows.map((row) => (
              <li key={row.label} className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-[var(--nimi-text-secondary)]">{row.label}</span>
                <span className="text-xs font-semibold text-[var(--nimi-text-primary)]">{row.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
