import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { Avatar, Button, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { useQuery } from '@tanstack/react-query';
import { Compass, Send } from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { resolveAgentTargetSnapshotForSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { fetchLocalAgentList, localAgentListQueryKey, type LocalAgentListItem } from '../agents/local-agent-list-model.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import { fetchHomeRecentChatPartners, type HomeRecentChatPartner } from './home-recent-conversations-model.js';
import { useHomeRowCapacity } from './use-home-row-capacity.js';

export type HomeAgentCardState = 'loading' | 'none' | 'unavailable' | 'ready';

// Fixed tile geometry; the row measures itself and renders only as many
// partner tiles as actually fit the card width (overflow goes to Chat).
// The strip is a quick switcher, so it never lists more than a few partners.
const HOME_PARTNER_TILE_WIDTH = 108;
const HOME_PARTNER_TILE_GAP = 8;
const HOME_PARTNER_TILE_LIMIT = 6;

export type HomeAgentCardViewProps = {
  state: HomeAgentCardState;
  partners: readonly HomeRecentChatPartner[];
  partnersPending: boolean;
  selectedId: string | null;
  /** Measured row capacity; the view slices the strip to this many tiles. */
  visibleCount: number;
  stripRef: (node: HTMLDivElement | null) => void;
  formatTime: (updatedAtMs: number) => string;
  onSelectPartner: (id: string) => void;
  /** Opens a conversation with an optional draft; this does not send it. */
  onOpenChat: (text: string) => void;
  onOpenPartner: (id: string) => void;
  onOpenAll: () => void;
  onExplore: () => void;
};

function PartnerAvatar({ displayName, avatarUrl }: { displayName: string; avatarUrl: string | null }) {
  return (
    <Avatar
      src={avatarUrl}
      alt={displayName}
      size="md"
      tone="accent"
      className="size-[34px] shrink-0 text-sm"
      fallback={<span aria-hidden="true">{[...displayName.trim()][0] || '?'}</span>}
    />
  );
}

function PartnerTile({ partner, selected, onSelect }: {
  partner: HomeRecentChatPartner;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`home-recent-chat:${partner.localAgentRef}`}
      className={`flex w-[108px] shrink-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors ${
        selected
          ? 'bg-[var(--nimi-surface-panel)] font-semibold'
          : 'hover:bg-[var(--nimi-surface-panel)]'
      }`}
    >
      <span className="relative shrink-0">
        <PartnerAvatar displayName={partner.displayName} avatarUrl={partner.avatarUrl} />
        {partner.hasUnread ? (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--nimi-action-primary-bg)] ring-2 ring-[var(--nimi-surface-card)]" data-testid={`home-recent-chat-unread:${partner.localAgentRef}`} aria-hidden="true" />
        ) : null}
      </span>
      <span className="truncate text-sm">{partner.displayName}</span>
    </button>
  );
}

/** One shallow container: recent message on the left, capsule reply on the right. */
function MiniChatBar({ partner, formatTime, onOpenChat, onOpenPartner }: {
  partner: HomeRecentChatPartner;
  formatTime: (updatedAtMs: number) => string;
  onOpenChat: (text: string) => void;
  onOpenPartner: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const hasDraft = text.trim().length > 0;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onOpenChat(text.trim());
  };
  const message = partner.lastMessageText ?? partner.conversationTitle ?? (partner.updatedAtMs !== null
    ? t('runtimeConfig.overview.agentCard.continueChat')
    : t('runtimeConfig.overview.recentChats.noMessageYet'));
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-[var(--nimi-surface-panel)] px-3.5 py-2.5" data-testid="home-mini-chat">
      <button
        type="button"
        onClick={() => onOpenPartner(partner.localAgentRef)}
        aria-label={t('runtimeConfig.overview.recentChats.openConversation', { name: partner.displayName })}
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg px-1.5 text-left"
        data-testid="home-recent-chat-preview"
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold" data-testid="home-agent-name">{partner.displayName}</span>
          {partner.updatedAtMs !== null ? (
            <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]" data-testid="home-recent-chat-time">{formatTime(partner.updatedAtMs)}</span>
          ) : null}
        </span>
        <span className="truncate text-sm text-[var(--nimi-text-secondary)]" data-testid="home-recent-chat-message">{message}</span>
      </button>
      <form onSubmit={submit} className="flex min-w-0 flex-1 items-center" data-testid="home-agent-composer">
        <label htmlFor="home-agent-composer-input" className="sr-only">{t('runtimeConfig.overview.recentChats.replyLabel', { name: partner.displayName })}</label>
        <span className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] pl-3.5 pr-1 focus-within:ring-2 focus-within:ring-[var(--nimi-focus-ring-color)]">
          <input
            id="home-agent-composer-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('runtimeConfig.overview.recentChats.replyPlaceholder', { name: partner.displayName })}
            className="min-w-0 flex-1 bg-transparent text-sm leading-6 text-[var(--nimi-field-text)] outline-none placeholder:text-[var(--nimi-field-placeholder)]"
          />
          <Button
            type="submit"
            tone="primary"
            aria-label={t('runtimeConfig.overview.recentChats.replySend')}
            className={`size-7 min-h-0 shrink-0 rounded-full !p-0${hasDraft ? '' : ' border-transparent bg-[var(--nimi-surface-active)] text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-active)]'}`}
            data-testid="home-agent-send"
          >
            <Send size={14} aria-hidden="true" />
          </Button>
        </span>
      </form>
    </div>
  );
}

/** Recent-chat composition; partner selection is local composition state, not Runtime agent state. */
export function HomeAgentCardView({ state, partners, partnersPending, selectedId, visibleCount, stripRef, formatTime, onSelectPartner, onOpenChat, onOpenPartner, onOpenAll, onExplore }: HomeAgentCardViewProps) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <section className="flex min-h-[172px] flex-col justify-center gap-2.5 rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 shadow-[var(--nimi-home-card-elevation)]" data-testid="home-agent-card" data-state={state}>
        <LoadingSkeleton lines={2} label={t('Common.loading')} />
      </section>
    );
  }
  if (state === 'unavailable') {
    return (
      <section className="flex min-h-[120px] flex-col justify-center gap-2.5 rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 shadow-[var(--nimi-home-card-elevation)]" data-testid="home-agent-card" data-state={state}>
        <p className="text-sm text-[var(--nimi-status-warning)]">{t('runtimeConfig.overview.agentCard.unavailable')}</p>
      </section>
    );
  }
  if (state === 'none') {
    return (
      <section className="flex min-h-[120px] flex-col justify-center gap-2.5 rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 shadow-[var(--nimi-home-card-elevation)]" data-testid="home-agent-card" data-state={state}>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t('runtimeConfig.overview.agentCard.none')}</p>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.agentCard.noneBody')}</p>
        </div>
        <Button tone="primary" size="sm" className="self-start" onClick={onExplore} data-testid="home-agent-explore">
          <Compass size={15} />{t('runtimeConfig.overview.agentCard.explore')}
        </Button>
      </section>
    );
  }
  const visiblePartners = partners.slice(0, Math.max(1, visibleCount));
  const selected = partners.find((partner) => partner.localAgentRef === selectedId) ?? null;
  return (
    <section className="flex flex-col gap-2.5 rounded-[24px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 shadow-[var(--nimi-home-card-elevation)]" data-testid="home-agent-card" data-state={state}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold" data-testid="home-recent-chats-title">{t('runtimeConfig.overview.recentChats.title')}</h2>
        <Button tone="ghost" size="sm" onClick={onOpenAll} data-testid="home-recent-chats-open-all">
          {t('runtimeConfig.overview.recentChats.openAll')}
        </Button>
      </div>
      {partnersPending ? (
        <LoadingSkeleton lines={2} label={t('Common.loading')} />
      ) : (
        <>
          <div ref={stripRef} className="flex gap-2 overflow-hidden" data-testid="home-recent-chats-strip">
            {visiblePartners.map((partner) => (
              <PartnerTile
                key={partner.localAgentRef}
                partner={partner}
                selected={partner.localAgentRef === selectedId}
                onSelect={() => onSelectPartner(partner.localAgentRef)}
              />
            ))}
          </div>
          {selected ? (
            <MiniChatBar
              key={selected.localAgentRef}
              partner={selected}
              formatTime={formatTime}
              onOpenChat={onOpenChat}
              onOpenPartner={onOpenPartner}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/** Live wrapper used by Home. Conversation truth comes from Runtime; the composer routes into the agent conversation with the text prefilled. */
export function HomeAgentCard() {
  const navigation = useHomeNavigation();
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const setAgentConversationTargetSnapshot = useAppStore((state) => state.setAgentConversationTargetSnapshot);
  const setPendingAgentComposerPrefill = useAppStore((state) => state.setPendingAgentComposerPrefill);
  const enabled = authStatus === 'authenticated' && Boolean(ownerUserId);
  const [selection, setSelection] = useState<{ ownerUserId: string; id: string } | null>(null);

  // Shared key with Explore and Source Detail so the list is fetched once per session.
  const agents = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: () => fetchLocalAgentList(ownerUserId, bindings.sdk),
    enabled,
    staleTime: 30_000,
  });
  const agentList = agents.data ?? [];
  const agentItemsByRef = useMemo(
    () => new Map(agentList.map((item) => [item.localAgentRef, item])),
    [agentList],
  );
  const recent = useQuery({
    queryKey: ['home-recent-chat-partners', ownerUserId, agentList.map((item) => item.localAgentRef).join(',')],
    queryFn: () => fetchHomeRecentChatPartners({ ownerUserId, sdk: bindings.sdk, agents: agentList }),
    enabled: enabled && agentList.length > 0,
    staleTime: 30_000,
  });
  const partners: readonly HomeRecentChatPartner[] = recent.data ?? (recent.isError
    ? agentList.map((item) => ({
      localAgentRef: item.localAgentRef,
      displayName: item.displayName,
      avatarUrl: null,
      lastMessageText: null,
      conversationTitle: null,
      updatedAtMs: null,
      hasUnread: false,
    }))
    : []);
  const partnersPending = enabled && agentList.length > 0 && recent.isPending;
  const selected = partners.find((partner) => selection?.ownerUserId === ownerUserId && partner.localAgentRef === selection.id) ?? partners[0] ?? null;
  const { ref: stripRef, capacity } = useHomeRowCapacity({
    tileWidth: HOME_PARTNER_TILE_WIDTH,
    tileGap: HOME_PARTNER_TILE_GAP,
    limit: Math.max(1, Math.min(partners.length, HOME_PARTNER_TILE_LIMIT)),
  });

  const formatTime = useCallback((updatedAtMs: number): string => {
    const date = new Date(updatedAtMs);
    const now = new Date(i18n.now());
    const time = i18n.formatDate(updatedAtMs, { hour: '2-digit', minute: '2-digit' });
    if (sameDay(date, now)) {
      return time;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(date, yesterday)) {
      return t('runtimeConfig.overview.recentChats.yesterdayAt', { time });
    }
    if (date.getFullYear() === now.getFullYear()) {
      return i18n.formatDate(updatedAtMs, { month: 'short', day: 'numeric' });
    }
    return i18n.formatDate(updatedAtMs, { year: 'numeric', month: 'short', day: 'numeric' });
  }, [i18n, t]);

  const openConversation = useCallback(async (selectedItem: LocalAgentListItem | null | undefined, initialComposerText?: string) => {
    if (!selectedItem) return;
    const generation = navigation.getSnapshot().generation;
    const target = await resolveAgentTargetSnapshotForSourceRef({
      sourceRef: selectedItem.sourceRef,
      ownerUserId,
      sdk: bindings.sdk,
    }).catch(() => null);
    if (navigation.getSnapshot().generation !== generation) return;
    if (target) {
      await launchAgentConversationFromDisplay({
        target,
        initialComposerText: initialComposerText ?? null,
        navigation,

        setAgentConversationTargetSnapshot,
        setPendingAgentComposerPrefill,
      });
      return;
    }
    // Fall back to the agent chat list; it states unavailability explicitly.
    // The typed text is still prefilled by source key so it is not lost.
    if (initialComposerText) {
      setPendingAgentComposerPrefill({ sourceKey: selectedItem.sourceKey, text: initialComposerText });
    }
    void navigation.push({ id: 'chat', chat: { mode: 'agent' } });
  }, [
    bindings.sdk,
    ownerUserId,
    navigation,

    setAgentConversationTargetSnapshot,

    setPendingAgentComposerPrefill,

  ]);

  const state: HomeAgentCardState = !enabled || agents.isPending
    ? 'loading'
    : agents.isError
      ? 'unavailable'
      : agentList.length > 0
        ? 'ready'
        : 'none';
  return (
    <HomeAgentCardView
      key={ownerUserId}
      state={state}
      partners={partners}
      partnersPending={partnersPending}
      selectedId={selected?.localAgentRef ?? null}
      visibleCount={capacity}
      stripRef={stripRef}
      formatTime={formatTime}
      onSelectPartner={(id) => setSelection({ ownerUserId, id })}
      onOpenChat={(text) => void openConversation(selected ? agentItemsByRef.get(selected.localAgentRef) : null, text)}
      onOpenPartner={(id) => void openConversation(agentItemsByRef.get(id))}
      onOpenAll={() => navigation.push({ id: 'chat', chat: { mode: 'agent' } })}
      onExplore={() => navigation.push({ id: 'explore' })}
    />
  );
}
