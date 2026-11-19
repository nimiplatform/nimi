import { unreadCompanionReplies } from './home-app-activity-model.js';
import { homePartnerDraftKey } from './home-partner-draft.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { Avatar, Button, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowRight, Compass } from 'lucide-react';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { fetchLocalAgentList, localAgentListQueryKey, type LocalAgentListItem } from '../agents/local-agent-list-model.js';
import { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';
import { fetchHomeRecentChatPartners, withRecentChatUnread, type HomeRecentChatPartner } from './home-recent-conversations-model.js';
import { useHomeAppActivity } from '../system-entry/system-entry-context.js';
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
  draftText: string;
  onDraftChange: (text: string) => void;
  onOpenChat: (text: string) => void;
  onOpenPartner: (id: string) => void;
  onOpenAll: () => void;
  onExplore: () => void;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
function PartnerAvatar({ displayName, avatarUrl, media }: Pick<HomeRecentChatPartner, 'displayName' | 'avatarUrl' | 'media'>) {
  const asset = media?.assets.avatar ?? media?.assets.portrait ?? media?.assets.referenceImage ?? media?.assets.profileCover;
  const externalUrl = asset?.externalUrl ?? media?.external.avatarUrl ?? media?.external.portraitUrl
    ?? media?.external.referenceImageUrl ?? media?.external.profileCoverUrl ?? avatarUrl;
  const purposes = asset?.delivery?.images.map(set => set.purpose) ?? [];
  const purpose = (['avatar', 'card', 'detail', 'hero'] as const).find(value => purposes.includes(value)) ?? 'avatar';
  return (
    <Avatar
      alt={displayName}
      size="md"
      tone="accent"
      className="size-[34px] shrink-0 text-sm"
      fallback={(
        <MediaImage delivery={asset?.delivery} externalUrl={externalUrl} purpose={purpose} sizes="34px"
          alt={displayName} className="flex h-full w-full items-center justify-center object-cover"
          fallback={<span aria-hidden="true">{[...displayName.trim()][0] || '?'}</span>} />
      )}
    />
  );
}

function RecentPartnerAvatar({ partner }: { partner: HomeRecentChatPartner }) {
  return (
    <span className="relative shrink-0">
      <PartnerAvatar displayName={partner.displayName} avatarUrl={partner.avatarUrl} media={partner.media} />
      {partner.hasUnread ? (
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--nimi-action-primary-bg)] ring-2 ring-[var(--nimi-surface-card)]" data-testid={`home-recent-chat-unread:${partner.localAgentRef}`} aria-hidden="true" />
      ) : null}
    </span>
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
      <RecentPartnerAvatar partner={partner} />
      <span className="truncate text-sm">{partner.displayName}</span>
    </button>
  );
}

/** One shallow container: recent message on the left, capsule reply on the right. */
function MiniChatBar({ partner, showAvatar, formatTime, text, onDraftChange, onOpenChat, onOpenPartner }: {
  partner: HomeRecentChatPartner;
  showAvatar: boolean;
  text: string;
  onDraftChange: (text: string) => void;
  formatTime: (updatedAtMs: number) => string;
  onOpenChat: (text: string) => void;
  onOpenPartner: (id: string) => void;
}) {
  const { t } = useTranslation();
  const hasDraft = text.trim().length > 0;
  const openLabel = hasDraft ? t('runtimeConfig.overview.recentChats.replySend')
    : t('runtimeConfig.overview.recentChats.openConversation', { name: partner.displayName });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onOpenChat(hasDraft ? text : '');
  };
  const message = partner.lastMessageText ?? partner.conversationTitle ?? (partner.updatedAtMs !== null
    ? t('runtimeConfig.overview.agentCard.continueChat')
    : t(partner.previewUnavailable ? 'runtimeConfig.overview.recentChats.previewUnavailable' : 'runtimeConfig.overview.recentChats.noMessageYet'));
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl bg-[var(--nimi-surface-panel)] p-3 sm:flex-row sm:items-center" data-testid="home-mini-chat">
      <button
        type="button"
        onClick={() => onOpenPartner(partner.localAgentRef)}
        aria-label={t('runtimeConfig.overview.recentChats.openConversation', { name: partner.displayName })}
        aria-description={partner.hasUnread ? t('NotificationPanel.unread') : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
        data-testid="home-recent-chat-preview"
      >
        {showAvatar ? <RecentPartnerAvatar partner={partner} /> : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold" data-testid="home-agent-name">{partner.displayName}</span>
            {partner.updatedAtMs !== null ? (
              <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]" data-testid="home-recent-chat-time">{formatTime(partner.updatedAtMs)}</span>
            ) : null}
          </span>
          <span className="truncate text-sm text-[var(--nimi-text-secondary)]" data-testid="home-recent-chat-message">{message}</span>
        </span>
      </button>
      <form onSubmit={submit} className="flex min-w-0 flex-1 items-center" data-testid="home-agent-composer">
        <label htmlFor="home-agent-composer-input" className="sr-only">{t('runtimeConfig.overview.recentChats.replyLabel', { name: partner.displayName })}</label>
        <span className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] pl-3.5 pr-1 focus-within:ring-2 focus-within:ring-[var(--nimi-focus-ring-color)]">
          <input
            id="home-agent-composer-input"
            value={text}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={t('runtimeConfig.overview.recentChats.replyPlaceholder', { name: partner.displayName })}
            className="min-w-0 flex-1 bg-transparent text-sm leading-6 text-[var(--nimi-field-text)] outline-none placeholder:text-[var(--nimi-field-placeholder)]"
          />
          <Button
            type="submit"
            tone="primary"
            aria-label={openLabel}
            title={openLabel}
            className={`size-7 min-h-0 shrink-0 rounded-full !p-0${hasDraft ? '' : ' border-transparent bg-[var(--nimi-surface-active)] text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-active)]'}`}
            data-testid="home-agent-send"
          >
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        </span>
      </form>
    </div>
  );
}

/** Recent-chat composition; partner selection is local composition state, not Runtime agent state. */
export function HomeAgentCardView({ state, partners, partnersPending, selectedId, visibleCount, stripRef, formatTime, onSelectPartner, draftText, onDraftChange, onOpenChat, onOpenPartner, onOpenAll, onExplore }: HomeAgentCardViewProps) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <section className="flex min-h-[172px] flex-col justify-center gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" data-testid="home-agent-card" data-state={state}>
        <LoadingSkeleton lines={2} label={t('Common.loading')} />
      </section>
    );
  }
  if (state === 'unavailable') {
    return (
      <section className="flex min-h-[120px] flex-col justify-center gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" data-testid="home-agent-card" data-state={state}>
        <p className="text-sm text-[var(--nimi-status-warning)]">{t('runtimeConfig.overview.agentCard.unavailable')}</p>
      </section>
    );
  }
  if (state === 'none') {
    return (
      <section className="flex min-h-[120px] flex-col justify-center gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" data-testid="home-agent-card" data-state={state}>
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
    <section className="flex flex-col gap-2.5 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" data-testid="home-agent-card" data-state={state}>
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
          {partners.length > 1 || !selected ? (
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
          ) : null}
          {selected ? (
            <MiniChatBar
              key={selected.localAgentRef}
              partner={selected}
              showAvatar={partners.length === 1}
              text={draftText}
              onDraftChange={onDraftChange}
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
  const activity = useHomeAppActivity();
  const navigation = useHomeNavigation();
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const realmBaseUrl = useAppStore((state) => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const authorizationRevision = useAppStore((state) => state.auth.authorizationRevision);
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
  const partners: readonly HomeRecentChatPartner[] = recent.data ? withRecentChatUnread(recent.data, activity.recent.records) : (recent.isError
    ? agentList.map((item) => ({
      localAgentRef: item.localAgentRef,
      displayName: item.displayName,
      avatarUrl: null,
      lastMessageText: null,
      previewUnavailable: true,
      conversationTitle: null,
      updatedAtMs: null,
      hasUnread: false,
    }))
    : []);
  const partnersPending = enabled && agentList.length > 0 && recent.isPending;
  const selected = partners.find((partner) => selection?.ownerUserId === ownerUserId && partner.localAgentRef === selection.id) ?? partners[0] ?? null;
  // The Home shortcut keeps its own input across partner switches and management returns.
  // It never consumes or rewrites the destination App's persistent draft.
  const draftScope = selected ? JSON.stringify(['home', realmBaseUrl, selected.localAgentRef]) : '';
  const draftKey = homePartnerDraftKey(ownerUserId, draftScope);
  const draftText = useAppStore(state => draftKey ? state.homePartnerDrafts[draftKey] ?? '' : '');
  const setHomePartnerDraft = useAppStore(state => state.setHomePartnerDraft);
  const { ref: stripRef, capacity } = useHomeRowCapacity({
    tileWidth: HOME_PARTNER_TILE_WIDTH,
    tileGap: HOME_PARTNER_TILE_GAP,
    limit: Math.max(1, Math.min(partners.length, HOME_PARTNER_TILE_LIMIT)),
  });
  // Artwork is optional and loads independently of conversation previews. Share
  // the directory's account-scoped source cache, only for tiles that are visible.
  const artwork = useQueries({
    queries: partners.slice(0, capacity).map((partner) => {
      const sourceRef = agentItemsByRef.get(partner.localAgentRef)?.sourceRef;
      return {
        queryKey: ['partner-current-source', ownerUserId, `${realmBaseUrl}:${authorizationRevision}`, partner.localAgentRef, sourceRef],
        queryFn: () => resolveCurrentPartnerSource(bindings.sdk.realm(), sourceRef!),
        enabled: enabled && Boolean(sourceRef),
        staleTime: 60_000,
        retry: false,
      };
    }),
  });
  const partnersWithArtwork = partners.map((partner, index) => ({
    ...partner,
    media: artwork[index]?.data?.media,
  }));

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
    const activityRef = partners.find(partner => partner.localAgentRef === selectedItem.localAgentRef)?.activityAgentRef;
    const reply = !initialComposerText && activityRef
      ? unreadCompanionReplies(activity.recent.records).get(activityRef)?.find(record => record.key.startsWith('turn:'))
      : undefined;
    await navigation.push({ id: 'contacts', partnerChat: {
      localAgentRef: selectedItem.localAgentRef,
      ...(reply ? { turnId: reply.key.slice('turn:'.length) } : {}),
      ...(initialComposerText?.trim() ? { draft: { text: initialComposerText, source: JSON.stringify(['home', realmBaseUrl, selectedItem.localAgentRef]) } } : {}),
    } });
  }, [navigation, realmBaseUrl, partners, activity.recent.records]);

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
      partners={partnersWithArtwork}
      partnersPending={partnersPending}
      selectedId={selected?.localAgentRef ?? null}
      visibleCount={capacity}
      stripRef={stripRef}
      formatTime={formatTime}
      onSelectPartner={(id) => setSelection({ ownerUserId, id })}
      draftText={draftText}
      onDraftChange={text => setHomePartnerDraft(ownerUserId, draftScope, text)}
      onOpenChat={(text) => void openConversation(selected ? agentItemsByRef.get(selected.localAgentRef) : null, text).catch(error => emitFeedbackToast({ kind: 'error', message: String(error) }))}
      onOpenPartner={(id) => void openConversation(agentItemsByRef.get(id)).catch(error => emitFeedbackToast({ kind: 'error', message: String(error) }))}
      onOpenAll={() => { void navigation.push({ id: 'contacts', contactView: 'partners' }); }}
      onExplore={() => navigation.push({ id: 'explore', exploreSearchKind: 'characters' })}
    />
  );
}
