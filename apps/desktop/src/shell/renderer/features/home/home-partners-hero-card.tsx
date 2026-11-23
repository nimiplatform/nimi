import { Button, IconButton, LoadingSkeleton, Tooltip } from '@nimiplatform/kit/ui';
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  UsersRound,
} from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RecentPartnerAvatar,
  useHomeRecentPartners,
  type HomeAgentCardState,
} from './home-agent-card.js';
import {
  normalizeHomeConversationTitle,
  type HomeRecentChatPartner,
} from './home-recent-conversations-model.js';

export const HOME_PARTNERS_HERO_LIMIT = 12;

export type HomePartnersHeroCardViewProps = {
  state: HomeAgentCardState;
  partners: readonly HomeRecentChatPartner[];
  partnersPending: boolean;
  formatTime: (updatedAtMs: number) => string;
  draftByPartner?: Readonly<Record<string, string>>;
  onOpenChatWithDraft: (partnerId: string, text: string) => void;
  onOpenPartner: (id: string) => void;
  onOpenAll: () => void;
  onExplore: () => void;
};

function realPreviewForPartner(
  partner: HomeRecentChatPartner,
  draftText: string,
  t: ReturnType<typeof useTranslation>['t'],
): { text: string; isDraft: boolean } | null {
  const trimmedDraft = draftText.trim();
  if (trimmedDraft) {
    return {
      text: `${t('runtimeConfig.overview.partnersHero.draftPrefix')}${trimmedDraft}`,
      isDraft: true,
    };
  }
  const normalizedTitle = normalizeHomeConversationTitle(partner.conversationTitle);
  const text = partner.lastMessageText ?? normalizedTitle ?? null;
  return text ? { text, isDraft: false } : null;
}

function PartnerContextTile({
  partner,
  isPrimary,
  preview,
  savedDraft,
  formatTime,
  onOpenChatWithDraft,
  onOpenPartner,
  className = '',
}: {
  partner: HomeRecentChatPartner;
  isPrimary: boolean;
  preview: { text: string; isDraft: boolean } | null;
  savedDraft: string;
  formatTime: (updatedAtMs: number) => string;
  onOpenChatWithDraft: (partnerId: string, text: string) => void;
  onOpenPartner: (id: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  const handleOpen = () => {
    if (savedDraft.trim()) {
      onOpenChatWithDraft(partner.localAgentRef, savedDraft);
      return;
    }
    onOpenPartner(partner.localAgentRef);
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      aria-label={t('runtimeConfig.overview.recentChats.openConversation', { name: partner.displayName })}
      aria-description={partner.hasUnread ? t('NotificationPanel.unread') : undefined}
      data-testid={`home-partner-card:${partner.localAgentRef}`}
      data-variant="context"
      className={`group/tile flex min-w-0 flex-col gap-2.5 rounded-2xl bg-[var(--nimi-home-porcelain-card)] p-4 text-left shadow-[var(--nimi-home-porcelain-shadow)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${className}`}
    >
      <span className="flex min-w-0 items-center gap-3" data-testid={`home-recent-chat:${partner.localAgentRef}`}>
        <RecentPartnerAvatar partner={partner} />
        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]"
              data-testid={isPrimary ? 'home-agent-name' : undefined}
            >
              {partner.displayName}
            </span>
            {partner.hasUnread ? (
              <span className="shrink-0 rounded-full bg-[var(--nimi-status-info-soft-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--nimi-action-primary-bg)]">
                {t('NotificationPanel.unread')}
              </span>
            ) : null}
          </span>
          {partner.updatedAtMs !== null ? (
            <span
              className="shrink-0 text-xs tabular-nums text-[var(--nimi-text-muted)]"
              data-testid={isPrimary ? 'home-recent-chat-time' : undefined}
            >
              {formatTime(partner.updatedAtMs)}
            </span>
          ) : null}
        </span>
      </span>

      {preview ? (
        <span
          className={`block min-w-0 truncate text-xs ${
            preview.isDraft
              ? 'font-medium text-[var(--nimi-action-primary-bg)]'
              : partner.hasUnread
                ? 'font-medium text-[var(--nimi-text-primary)]'
                : 'text-[var(--nimi-text-secondary)]'
          }`}
          data-testid={isPrimary ? 'home-recent-chat-message' : undefined}
        >
          {preview.text}
        </span>
      ) : null}
    </button>
  );
}

function PartnerCompactChip({
  partner,
  isPrimary,
  formatTime,
  onOpenPartner,
}: {
  partner: HomeRecentChatPartner;
  isPrimary: boolean;
  formatTime: (updatedAtMs: number) => string;
  onOpenPartner: (id: string) => void;
}) {
  const { t } = useTranslation();
  const timeTooltip = partner.updatedAtMs !== null ? formatTime(partner.updatedAtMs) : undefined;

  const chip = (
    <button
      type="button"
      onClick={() => onOpenPartner(partner.localAgentRef)}
      aria-label={t('runtimeConfig.overview.recentChats.openConversation', { name: partner.displayName })}
      data-testid={`home-partner-card:${partner.localAgentRef}`}
      data-variant="compact"
      className="inline-flex max-w-full min-w-0 items-center gap-2.5 rounded-2xl bg-[var(--nimi-home-porcelain-card)] py-2 pr-4 pl-2.5 text-left shadow-[var(--nimi-home-porcelain-shadow)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[var(--nimi-home-porcelain-shadow-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
    >
      <span className="flex min-w-0 items-center gap-2.5" data-testid={`home-recent-chat:${partner.localAgentRef}`}>
        <RecentPartnerAvatar partner={partner} />
        <span
          className="max-w-36 truncate text-sm font-medium text-[var(--nimi-text-primary)]"
          data-testid={isPrimary ? 'home-agent-name' : undefined}
        >
          {partner.displayName}
        </span>
      </span>
    </button>
  );

  return timeTooltip ? (
    <Tooltip content={timeTooltip} placement="top">
      {chip}
    </Tooltip>
  ) : chip;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r015
// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
// @nimi-authority: rule.nimi.desktop.shell-ui.r029
export function HomePartnersHeroCardView({
  state,
  partners,
  partnersPending,
  formatTime,
  draftByPartner,
  onOpenChatWithDraft,
  onOpenPartner,
  onOpenAll,
  onExplore,
}: HomePartnersHeroCardViewProps) {
  const { t } = useTranslation();
  const railRef = useRef<HTMLDivElement>(null);

  const visiblePartners = partners.slice(0, HOME_PARTNERS_HERO_LIMIT);
  const hiddenCount = Math.max(0, partners.length - visiblePartners.length);
  const unreadCount = partners.filter((partner) => partner.hasUnread).length;
  const isReady = state === 'ready' && !partnersPending;

  const annotated = visiblePartners.map((partner, index) => {
    const savedDraft = draftByPartner?.[partner.localAgentRef] ?? '';
    const preview = realPreviewForPartner(partner, savedDraft, t);
    const hasContext = Boolean(preview || partner.hasUnread);
    return { partner, index, savedDraft, preview, hasContext };
  });
  const contextPartners = annotated.filter((item) => item.hasContext);
  const quietPartners = annotated.filter((item) => !item.hasContext);
  const isScrollableRail = isReady && contextPartners.length >= 4;

  const scrollRail = (direction: -1 | 1) => {
    railRef.current?.scrollBy({ left: direction * 296, behavior: 'smooth' });
  };

  return (
    <section
      aria-label={t('runtimeConfig.overview.partnersHero.title')}
      data-testid="home-partners-hero"
      data-state={state}
      className="flex min-w-0 flex-col gap-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.overview.partnersHero.title')}
          </h2>
          {isReady && unreadCount > 0 ? (
            <span
              className="rounded-full bg-[var(--nimi-status-info-soft-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--nimi-action-primary-bg)]"
              data-testid="home-partners-unread-summary"
            >
              {t('runtimeConfig.overview.partnersHero.unreadBadge', { count: unreadCount })}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {isScrollableRail ? (
            <div className="mr-1 flex items-center gap-1" data-testid="home-partners-rail-controls">
              <IconButton
                tone="ghost"
                size="sm"
                aria-label={t('runtimeConfig.overview.partnersHero.scrollPrev')}
                onClick={() => scrollRail(-1)}
                className="size-7 rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-base)] hover:text-[var(--nimi-text-primary)]"
                icon={<ChevronLeft size={14} aria-hidden="true" />}
              />
              <IconButton
                tone="ghost"
                size="sm"
                aria-label={t('runtimeConfig.overview.partnersHero.scrollNext')}
                onClick={() => scrollRail(1)}
                className="size-7 rounded-full bg-[var(--nimi-home-porcelain-card)] text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-base)] hover:text-[var(--nimi-text-primary)]"
                icon={<ChevronRight size={14} aria-hidden="true" />}
              />
            </div>
          ) : null}

          {isReady && partners.length > 0 ? (
            <button
              type="button"
              onClick={onOpenAll}
              data-testid="home-partners-all"
              className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {hiddenCount > 0
                ? `${t('runtimeConfig.overview.partnersHero.allCountAction', { total: partners.length })} →`
                : `${t('runtimeConfig.overview.partnersHero.allAction')} →`}
            </button>
          ) : null}
        </div>
      </header>

      {state === 'loading' || partnersPending ? (
        <LoadingSkeleton lines={2} label={t('Common.loading')} />
      ) : state === 'unavailable' ? (
        <p className="rounded-2xl bg-[var(--nimi-home-porcelain-card)] px-4 py-3 text-xs text-[var(--nimi-status-warning)] shadow-[var(--nimi-home-porcelain-shadow)]">
          {t('runtimeConfig.overview.agentCard.unavailable')}
        </p>
      ) : state === 'none' ? (
        <div
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--nimi-home-porcelain-card)] px-5 py-4 shadow-[var(--nimi-home-porcelain-shadow)]"
          data-testid="home-partners-empty"
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-home-soft-well)] text-[var(--nimi-action-primary-bg)]">
              <UsersRound size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{t('runtimeConfig.overview.agentCard.none')}</p>
              <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.overview.agentCard.noneBody')}</p>
            </div>
          </div>
          <Button tone="primary" size="sm" onClick={onExplore} data-testid="home-agent-explore">
            <Compass size={14} aria-hidden="true" />
            {t('runtimeConfig.overview.agentCard.explore')}
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {contextPartners.length > 0 ? (
            !isScrollableRail ? (
              <div
                className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
                data-testid="home-partners-grid"
              >
                {contextPartners.map(({ partner, index, savedDraft, preview }) => (
                  <PartnerContextTile
                    key={partner.localAgentRef}
                    partner={partner}
                    isPrimary={index === 0}
                    preview={preview}
                    savedDraft={savedDraft}
                    formatTime={formatTime}
                    onOpenChatWithDraft={onOpenChatWithDraft}
                    onOpenPartner={onOpenPartner}
                  />
                ))}
              </div>
            ) : (
              <div
                ref={railRef}
                className="flex min-w-0 gap-3 overflow-x-auto pb-1 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                data-testid="home-partners-rail"
              >
                {contextPartners.map(({ partner, index, savedDraft, preview }) => (
                  <PartnerContextTile
                    key={partner.localAgentRef}
                    partner={partner}
                    isPrimary={index === 0}
                    preview={preview}
                    savedDraft={savedDraft}
                    formatTime={formatTime}
                    onOpenChatWithDraft={onOpenChatWithDraft}
                    onOpenPartner={onOpenPartner}
                    className="w-[276px] shrink-0 snap-start"
                  />
                ))}
              </div>
            )
          ) : null}

          {quietPartners.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2.5"
              data-testid="home-partners-compact-row"
            >
              {quietPartners.map(({ partner, index }) => (
                <PartnerCompactChip
                  key={partner.localAgentRef}
                  partner={partner}
                  isPrimary={index === 0}
                  formatTime={formatTime}
                  onOpenPartner={onOpenPartner}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function HomePartnersHeroCard({ enabled }: { enabled: boolean }) {
  const { ownerUserId, onManagePartner: _onManagePartner, ...partnerProps } = useHomeRecentPartners(
    enabled,
    HOME_PARTNERS_HERO_LIMIT,
  );
  return <HomePartnersHeroCardView key={ownerUserId} {...partnerProps} />;
}
