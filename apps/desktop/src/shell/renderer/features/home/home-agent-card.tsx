import { unreadCompanionReplies } from './home-app-activity-model.js';
import { homePartnerDraftKey } from './home-partner-draft.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { AppCardSurface, Avatar, Button, IconButton, LoadingSkeleton, Tooltip } from '@nimiplatform/kit/ui';
import { MediaImage } from '@nimiplatform/kit/features/media';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowRight, Compass, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { fetchLocalAgentList, localAgentListQueryKey, type LocalAgentListItem } from '../agents/local-agent-list-model.js';
import { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';
import {
  fetchHomeRecentChatPartners,
  normalizeHomeConversationTitle,
  withRecentChatUnread,
  type HomeRecentChatPartner,
} from './home-recent-conversations-model.js';
import { useHomeAppActivity } from '../system-entry/system-entry-context.js';

export type HomeAgentCardState = 'loading' | 'none' | 'unavailable' | 'ready';

export const HOME_RECENT_CONVERSATIONS_LIMIT = 5;
const PROMPT_KEYS = ['introduce', 'thinking', 'story'] as const;

export type HomeAgentCardViewProps = {
  state: HomeAgentCardState;
  partners: readonly HomeRecentChatPartner[];
  partnersPending: boolean;
  /** Maximum number of recent conversation rows rendered simultaneously (defaults to 5). */
  visibleCount?: number;
  formatTime: (updatedAtMs: number) => string;
  /** Optional per-partner unsent draft lookup; never sends automatically. */
  draftByPartner?: Readonly<Record<string, string>>;
  /** Preserved unsent draft fallback for single-partner tests. */
  draftText?: string;
  onOpenChatWithDraft: (partnerId: string, text: string) => void;
  onOpenPartner: (id: string) => void;
  onManagePartner?: (id: string) => void;
  onOpenAll: () => void;
  onExplore: () => void;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
export function PartnerAvatar({
  displayName,
  avatarUrl,
  media,
  className = 'size-10 text-sm',
  sizes = '40px',
}: Pick<HomeRecentChatPartner, 'displayName' | 'avatarUrl' | 'media'> & { className?: string; sizes?: string }) {
  const asset = media?.assets.avatar ?? media?.assets.portrait ?? media?.assets.referenceImage ?? media?.assets.profileCover;
  const externalUrl = asset?.externalUrl ?? media?.external.avatarUrl ?? media?.external.portraitUrl
    ?? media?.external.referenceImageUrl ?? media?.external.profileCoverUrl ?? avatarUrl;
  const purposes = asset?.delivery?.images.map((set) => set.purpose) ?? [];
  const purpose = (['avatar', 'card', 'detail', 'hero'] as const).find((value) => purposes.includes(value)) ?? 'avatar';
  return (
    <Avatar
      alt={displayName}
      size="md"
      tone="accent"
      className={`${className} shrink-0 shadow-[var(--nimi-elevation-base)]`}
      fallback={(
        <MediaImage
          delivery={asset?.delivery}
          externalUrl={externalUrl}
          purpose={purpose}
          sizes={sizes}
          alt={displayName}
          className="flex h-full w-full items-center justify-center object-cover"
          fallback={<span aria-hidden="true">{[...displayName.trim()][0] || '?'}</span>}
        />
      )}
    />
  );
}

export function RecentPartnerAvatar({ partner, size = 'md' }: { partner: HomeRecentChatPartner; size?: 'xs' | 'md' | 'lg' }) {
  const sizeClass = size === 'xs'
    ? 'size-5 text-[10.5px]'
    : size === 'lg'
      ? 'size-12 text-base'
      : 'size-10 text-sm';
  const sizesAttr = size === 'xs' ? '20px' : size === 'lg' ? '48px' : '40px';
  const dotClass = size === 'xs'
    ? 'absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--nimi-action-primary-bg)] ring-[1.5px] ring-[var(--nimi-surface-card)]'
    : 'absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[var(--nimi-action-primary-bg)] ring-2 ring-[var(--nimi-surface-card)]';
  return (
    <span className="relative inline-flex shrink-0">
      <PartnerAvatar
        displayName={partner.displayName}
        avatarUrl={partner.avatarUrl}
        media={partner.media}
        className={sizeClass}
        sizes={sizesAttr}
      />
      {partner.hasUnread ? (
        <span
          className={dotClass}
          data-testid={`home-recent-chat-unread:${partner.localAgentRef}`}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

export function hasConversationHistory(partner: HomeRecentChatPartner): boolean {
  return Boolean(partner.lastMessageText || normalizeHomeConversationTitle(partner.conversationTitle) || partner.updatedAtMs !== null);
}

function PartnerConversationRow({
  partner,
  isPrimary,
  showPrompts,
  formatTime,
  draftText,
  onOpenChatWithDraft,
  onOpenPartner,
  onManagePartner,
}: {
  partner: HomeRecentChatPartner;
  isPrimary: boolean;
  showPrompts: boolean;
  formatTime: (updatedAtMs: number) => string;
  draftText: string;
  onOpenChatWithDraft: (partnerId: string, text: string) => void;
  onOpenPartner: (id: string) => void;
  onManagePartner?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const hasHistory = hasConversationHistory(partner);
  const hasDraft = draftText.trim().length > 0;
  const normalizedTitle = normalizeHomeConversationTitle(partner.conversationTitle);
  const message = partner.lastMessageText
    ?? normalizedTitle
    ?? (partner.updatedAtMs !== null
      ? t('runtimeConfig.overview.agentCard.continueChat')
      : t(partner.previewUnavailable ? 'runtimeConfig.overview.recentChats.previewUnavailable' : 'runtimeConfig.overview.recentChats.noMessageYet'));

  const handlePrimaryOpen = () => {
    if (hasDraft) {
      onOpenChatWithDraft(partner.localAgentRef, draftText);
      return;
    }
    onOpenPartner(partner.localAgentRef);
  };

  return (
    <li
      className="group/row flex min-w-0 flex-col gap-2"
      data-testid={`home-recent-chat-row:${partner.localAgentRef}`}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-[var(--nimi-home-soft-well)] px-3.5 py-3 transition-colors hover:bg-[var(--nimi-home-soft-well-hover)]">
        <button
          type="button"
          onClick={handlePrimaryOpen}
          aria-label={t('runtimeConfig.overview.recentChats.openConversation', { name: partner.displayName })}
          aria-description={partner.hasUnread ? t('NotificationPanel.unread') : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          data-testid={`home-recent-chat:${partner.localAgentRef}`}
        >
          <RecentPartnerAvatar partner={partner} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5" data-testid={isPrimary ? 'home-recent-chat-preview' : undefined}>
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]" data-testid={isPrimary ? 'home-agent-name' : undefined}>
                  {partner.displayName}
                </span>
                {partner.hasUnread ? (
                  <span className="shrink-0 rounded-full bg-[var(--nimi-status-info-soft-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--nimi-action-primary-bg)]">
                    {t('NotificationPanel.unread')}
                  </span>
                ) : null}
              </span>
              {partner.updatedAtMs !== null ? (
                <span className="shrink-0 text-xs tabular-nums text-[var(--nimi-text-muted)]" data-testid={isPrimary ? 'home-recent-chat-time' : undefined}>
                  {formatTime(partner.updatedAtMs)}
                </span>
              ) : null}
            </span>
            <span
              className={`truncate text-xs ${
                partner.hasUnread ? 'font-medium text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-secondary)]'
              }`}
              data-testid={isPrimary ? 'home-recent-chat-message' : undefined}
            >
              {message}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {onManagePartner ? (
            <Tooltip content={t('runtimeConfig.overview.partnerActions.manage')} placement="top">
              <IconButton
                tone="ghost"
                size="sm"
                aria-label={`${partner.displayName} · ${t('runtimeConfig.overview.partnerActions.manage')}`}
                onClick={() => onManagePartner(partner.localAgentRef)}
                data-testid={isPrimary ? 'home-agent-manage' : `home-agent-manage:${partner.localAgentRef}`}
                className="size-8 rounded-lg text-[var(--nimi-text-secondary)] opacity-70 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                icon={<SlidersHorizontal size={14} aria-hidden="true" />}
              />
            </Tooltip>
          ) : null}
          <Button
            tone={isPrimary && (partner.hasUnread || !hasHistory) ? 'primary' : 'secondary'}
            size="sm"
            onClick={handlePrimaryOpen}
            data-testid={isPrimary ? 'home-agent-open-chat' : `home-agent-open-chat:${partner.localAgentRef}`}
          >
            {t(hasHistory ? 'runtimeConfig.overview.agentCard.continueChat' : 'runtimeConfig.overview.partnerActions.startChat')}
            <ArrowRight size={13} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {showPrompts ? (
        <div className="flex flex-wrap items-center gap-1.5 px-1 pt-0.5" data-testid="home-agent-prompts">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--nimi-text-secondary)]">
            <Sparkles size={12} aria-hidden="true" />
            {t('runtimeConfig.overview.tryPrompts')}
          </span>
          {PROMPT_KEYS.map((promptKey) => {
            const promptText = t(`runtimeConfig.overview.prompts.${promptKey}`);
            return (
              <button
                key={promptKey}
                type="button"
                onClick={() => onOpenChatWithDraft(partner.localAgentRef, promptText)}
                data-testid={`home-agent-prompt:${promptKey}`}
                className="rounded-full bg-[var(--nimi-home-soft-well)] px-3 py-1 text-xs text-[var(--nimi-text-primary)] transition-colors hover:bg-[var(--nimi-home-soft-well-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
              >
                {promptText}
              </button>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r029
/** Multi-row recent conversations feed (shows up to 5 recent conversations simultaneously). */
export function HomeAgentCardView({
  state,
  partners,
  partnersPending,
  visibleCount = HOME_RECENT_CONVERSATIONS_LIMIT,
  formatTime,
  draftByPartner,
  draftText = '',
  onOpenChatWithDraft,
  onOpenPartner,
  onManagePartner,
  onOpenAll,
  onExplore,
}: HomeAgentCardViewProps) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <AppCardSurface
        kind="operational-solid"
        className="flex h-full min-h-32 flex-col justify-center gap-2.5 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
        data-testid="home-agent-card"
        data-state={state}
      >
        <LoadingSkeleton lines={3} label={t('Common.loading')} />
      </AppCardSurface>
    );
  }
  if (state === 'unavailable') {
    return (
      <AppCardSurface
        kind="operational-solid"
        className="flex h-full min-h-24 flex-col justify-center gap-2.5 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
        data-testid="home-agent-card"
        data-state={state}
      >
        <p className="text-sm text-[var(--nimi-status-warning)]">{t('runtimeConfig.overview.agentCard.unavailable')}</p>
      </AppCardSurface>
    );
  }
  if (state === 'none') {
    return (
      <AppCardSurface
        kind="operational-solid"
        className="flex h-full min-w-0 flex-col justify-between gap-5 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
        data-testid="home-agent-card"
        data-state={state}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
              {t('runtimeConfig.overview.agentCard.title')}
            </h2>
            <span className="text-xs text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.overview.agentCard.none')}
            </span>
          </div>
        </header>

        <div className="flex flex-1 flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--nimi-home-soft-well)] p-5">
          <div className="min-w-0 max-w-xs space-y-1">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.overview.agentCard.none')}</p>
            <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.agentCard.noneBody')}</p>
          </div>
          <button
            type="button"
            onClick={onExplore}
            data-testid="home-agent-explore"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--nimi-text-primary)] px-4 py-2 text-xs font-medium text-[var(--nimi-surface-card)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            <Compass size={14} aria-hidden="true" />
            <span>{t('runtimeConfig.overview.agentCard.explore')}</span>
          </button>
        </div>
      </AppCardSurface>
    );
  }

  const limit = Math.max(1, Math.min(HOME_RECENT_CONVERSATIONS_LIMIT, visibleCount));
  const visiblePartners = partners.slice(0, limit);
  const anyHistory = visiblePartners.some(hasConversationHistory);

  return (
    <AppCardSurface
      kind="operational-solid"
      className="flex h-full min-w-0 flex-col gap-4 rounded-3xl border-transparent! bg-[var(--nimi-home-porcelain-card)]! p-6 shadow-[var(--nimi-home-porcelain-shadow)]!"
      data-testid="home-agent-card"
      data-state={state}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]" data-testid="home-recent-chats-title">
            {t('runtimeConfig.overview.recentChats.title')}
          </h2>
          {!partnersPending && partners.length > 0 ? (
            <span className="text-xs tabular-nums text-[var(--nimi-text-secondary)]">
              {partners.length > limit
                ? t('runtimeConfig.overview.recentChats.countSliced', { shown: visiblePartners.length, total: partners.length })
                : t('runtimeConfig.overview.recentChats.countTotal', { total: partners.length })}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button tone="ghost" size="sm" onClick={onOpenAll} data-testid="home-recent-chats-open-all">
            {t('runtimeConfig.overview.recentChats.openAll')}
          </Button>
        </div>
      </header>

      {partnersPending ? (
        <LoadingSkeleton lines={3} label={t('Common.loading')} />
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="home-recent-chats-list">
          {visiblePartners.map((partner, index) => {
            const partnerHasHistory = hasConversationHistory(partner);
            const showPrompts = !anyHistory && index === 0 && !partnerHasHistory && !partner.previewUnavailable;
            const resolvedDraft = draftByPartner?.[partner.localAgentRef] ?? (index === 0 ? draftText : '');
            return (
              <PartnerConversationRow
                key={partner.localAgentRef}
                partner={partner}
                isPrimary={index === 0}
                showPrompts={showPrompts}
                draftText={resolvedDraft}
                formatTime={formatTime}
                onOpenChatWithDraft={onOpenChatWithDraft}
                onOpenPartner={onOpenPartner}
                onManagePartner={onManagePartner}
              />
            );
          })}
        </ul>
      )}
    </AppCardSurface>
  );
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/** Shared live controller for Home partner conversations (Runtime truth + Realm artwork + saved drafts). */
export function useHomeRecentPartners(active = true, maxPartners = HOME_RECENT_CONVERSATIONS_LIMIT) {
  const activity = useHomeAppActivity();
  const navigation = useHomeNavigation();
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => String(state.auth.user?.id || '').trim());
  const realmBaseUrl = useAppStore((state) => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const authorizationRevision = useAppStore((state) => state.auth.authorizationRevision);
  const homePartnerDrafts = useAppStore((state) => state.homePartnerDrafts);
  const enabled = active && authStatus === 'authenticated' && Boolean(ownerUserId);

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
  const partners: readonly HomeRecentChatPartner[] = recent.data
    ? withRecentChatUnread(recent.data, activity.recent.records)
    : recent.isError
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
      : [];
  const partnersPending = enabled && agentList.length > 0 && recent.isPending;

  const artwork = useQueries({
    queries: partners.slice(0, maxPartners).map((partner) => {
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

  const draftByPartner = useMemo(() => {
    const map: Record<string, string> = {};
    for (const partner of partners.slice(0, maxPartners)) {
      const scope = JSON.stringify(['home', realmBaseUrl, partner.localAgentRef]);
      const key = homePartnerDraftKey(ownerUserId, scope);
      const saved = key ? homePartnerDrafts[key] : undefined;
      if (saved) map[partner.localAgentRef] = saved;
    }
    return map;
  }, [partners, maxPartners, realmBaseUrl, ownerUserId, homePartnerDrafts]);

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
    const activityRef = partners.find((partner) => partner.localAgentRef === selectedItem.localAgentRef)?.activityAgentRef;
    const reply = !initialComposerText && activityRef
      ? unreadCompanionReplies(activity.recent.records).get(activityRef)?.find((record) => record.key.startsWith('turn:'))
      : undefined;
    await navigation.push({
      id: 'contacts',
      partnerChat: {
        localAgentRef: selectedItem.localAgentRef,
        ...(reply ? { turnId: reply.key.slice('turn:'.length) } : {}),
        ...(initialComposerText?.trim()
          ? { draft: { text: initialComposerText, source: JSON.stringify(['home', realmBaseUrl, selectedItem.localAgentRef]) } }
          : {}),
      },
    });
  }, [navigation, realmBaseUrl, partners, activity.recent.records]);

  const state: HomeAgentCardState = !enabled || agents.isPending
    ? 'loading'
    : agents.isError
      ? 'unavailable'
      : agentList.length > 0
        ? 'ready'
        : 'none';

  return {
    ownerUserId,
    state,
    partners: partnersWithArtwork,
    partnersPending,
    formatTime,
    draftByPartner,
    onOpenChatWithDraft: (partnerId: string, text: string) =>
      void openConversation(agentItemsByRef.get(partnerId), text).catch((error) =>
        emitFeedbackToast({ kind: 'error', message: String(error) }),
      ),
    onOpenPartner: (id: string) =>
      void openConversation(agentItemsByRef.get(id)).catch((error) =>
        emitFeedbackToast({ kind: 'error', message: String(error) }),
      ),
    onManagePartner: (id: string) => {
      void navigation.push({ id: 'contacts', contactView: 'partners', partner: { localAgentRef: id } });
    },
    onOpenAll: () => {
      void navigation.push({ id: 'contacts', contactView: 'partners' });
    },
    onExplore: () => {
      void navigation.push({ id: 'explore', exploreSearchKind: 'characters' });
    },
  };
}

/** Live wrapper used by Home. Conversation truth comes from Runtime; prompt actions route into the agent conversation with text prefilled. */
export function HomeAgentCard() {
  const { ownerUserId, ...partnerProps } = useHomeRecentPartners(true);
  return (
    <HomeAgentCardView
      key={ownerUserId}
      {...partnerProps}
      visibleCount={HOME_RECENT_CONVERSATIONS_LIMIT}
    />
  );
}
