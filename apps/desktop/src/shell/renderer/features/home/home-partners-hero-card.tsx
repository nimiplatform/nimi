import { Tooltip } from '@nimiplatform/kit/ui';
import { Compass, UsersRound } from 'lucide-react';
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

export const HOME_PARTNERS_HERO_LIMIT = 4;

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

function PartnerWhisperPill({
  partner,
  isPrimary,
  preview,
  savedDraft,
  formatTime,
  onOpenChatWithDraft,
  onOpenPartner,
}: {
  partner: HomeRecentChatPartner;
  isPrimary: boolean;
  preview: { text: string; isDraft: boolean } | null;
  savedDraft: string;
  formatTime: (updatedAtMs: number) => string;
  onOpenChatWithDraft: (partnerId: string, text: string) => void;
  onOpenPartner: (id: string) => void;
}) {
  const { t } = useTranslation();
  const hasContext = Boolean(preview || partner.hasUnread);
  const formattedTime = partner.updatedAtMs !== null ? formatTime(partner.updatedAtMs) : null;
  const tooltipParts = [
    formattedTime,
    preview?.text ?? (partner.hasUnread ? t('NotificationPanel.unread') : null),
  ].filter(Boolean);
  const tooltipContent = tooltipParts.length > 0 ? tooltipParts.join(' · ') : undefined;

  const handleOpen = () => {
    if (savedDraft.trim()) {
      onOpenChatWithDraft(partner.localAgentRef, savedDraft);
      return;
    }
    onOpenPartner(partner.localAgentRef);
  };

  const pill = (
    <button
      type="button"
      onClick={handleOpen}
      aria-label={t('runtimeConfig.overview.recentChats.openConversation', { name: partner.displayName })}
      aria-description={partner.hasUnread ? t('NotificationPanel.unread') : undefined}
      data-testid={`home-partner-card:${partner.localAgentRef}`}
      data-variant={hasContext ? 'context' : 'compact'}
      className={`inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[var(--nimi-home-whisper-border)] pl-1.5 pr-3 text-left transition-[transform,background-color,border-color,box-shadow,color] duration-150 hover:bg-[var(--nimi-home-whisper-surface-hover)] hover:shadow-[var(--nimi-elevation-base)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
        hasContext
          ? 'bg-[color-mix(in_srgb,var(--nimi-home-whisper-surface-hover)_82%,transparent)] text-[var(--nimi-text-primary)]'
          : 'bg-[var(--nimi-home-whisper-surface)] text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5" data-testid={`home-recent-chat:${partner.localAgentRef}`}>
        <RecentPartnerAvatar partner={partner} size="xs" />
        <span
          className="max-w-32 truncate text-xs font-medium"
          data-testid={isPrimary ? 'home-agent-name' : undefined}
        >
          {partner.displayName}
        </span>
      </span>

      {preview ? (
        <span
          className={`max-w-[92px] truncate text-[11.5px] ${
            preview.isDraft
              ? 'font-medium text-[var(--nimi-action-primary-bg)]'
              : partner.hasUnread
                ? 'font-medium text-[var(--nimi-text-primary)]'
                : 'text-[var(--nimi-text-muted)]'
          }`}
          data-testid={isPrimary ? 'home-recent-chat-message' : undefined}
        >
          · {preview.text}
        </span>
      ) : null}
    </button>
  );

  return tooltipContent ? (
    <Tooltip content={tooltipContent} placement="top">
      {pill}
    </Tooltip>
  ) : pill;
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

  const visiblePartners = partners.slice(0, HOME_PARTNERS_HERO_LIMIT);
  const hiddenCount = Math.max(0, partners.length - visiblePartners.length);
  const unreadCount = partners.filter((partner) => partner.hasUnread).length;
  const isReady = state === 'ready' && !partnersPending;

  return (
    <section
      aria-label={t('runtimeConfig.overview.partnersHero.title')}
      data-testid="home-partners-hero"
      data-state={state}
      className="flex w-full min-w-0 items-center justify-center"
    >
      {state === 'loading' || partnersPending ? (
        <div className="flex h-8 items-center justify-center gap-2" aria-label={t('Common.loading')}>
          <span className="h-7 w-24 animate-pulse rounded-full bg-[var(--nimi-home-whisper-surface)] motion-reduce:animate-none" />
          <span className="h-7 w-20 animate-pulse rounded-full bg-[var(--nimi-home-whisper-surface)] motion-reduce:animate-none" />
          <span className="h-7 w-20 animate-pulse rounded-full bg-[var(--nimi-home-whisper-surface)] motion-reduce:animate-none" />
        </div>
      ) : state === 'unavailable' ? (
        <p className="rounded-full border border-[var(--nimi-home-whisper-border)] bg-[var(--nimi-home-whisper-surface)] px-3.5 py-1.5 text-xs text-[var(--nimi-status-warning)]">
          {t('runtimeConfig.overview.agentCard.unavailable')}
        </p>
      ) : state === 'none' ? (
        <div
          className="inline-flex flex-wrap items-center justify-center gap-2.5 rounded-full border border-[var(--nimi-home-whisper-border)] bg-[var(--nimi-home-whisper-surface)] py-1 pr-1.5 pl-3 text-xs text-[var(--nimi-text-secondary)]"
          data-testid="home-partners-empty"
        >
          <span className="inline-flex items-center gap-1.5">
            <UsersRound size={13} aria-hidden="true" className="text-[var(--nimi-text-muted)]" />
            <span>{t('runtimeConfig.overview.agentCard.none')}</span>
          </span>
          <button
            type="button"
            onClick={onExplore}
            data-testid="home-agent-explore"
            className="inline-flex h-6 items-center gap-1 rounded-full bg-[var(--nimi-status-info-soft-bg)] px-2.5 text-[11.5px] font-medium text-[var(--nimi-action-primary-bg)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            <Compass size={12} aria-hidden="true" />
            <span>{t('runtimeConfig.overview.agentCard.explore')}</span>
          </button>
        </div>
      ) : (
        <div
          className="flex min-w-0 flex-wrap items-center justify-center gap-2"
          data-testid="home-partners-compact-row"
        >
          <h2 className="mr-0.5 text-[11.5px] font-medium text-[var(--nimi-text-muted)]">
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

          {visiblePartners.map((partner, index) => {
            const savedDraft = draftByPartner?.[partner.localAgentRef] ?? '';
            const preview = realPreviewForPartner(partner, savedDraft, t);
            return (
              <PartnerWhisperPill
                key={partner.localAgentRef}
                partner={partner}
                isPrimary={index === 0}
                preview={preview}
                savedDraft={savedDraft}
                formatTime={formatTime}
                onOpenChatWithDraft={onOpenChatWithDraft}
                onOpenPartner={onOpenPartner}
              />
            );
          })}

          {isReady && partners.length > 0 ? (
            <button
              type="button"
              onClick={onOpenAll}
              data-testid="home-partners-all"
              className="ml-0.5 rounded-full px-2 py-1 text-[11.5px] font-medium text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
            >
              {hiddenCount > 0
                ? `${t('runtimeConfig.overview.partnersHero.allCountAction', { total: partners.length })} →`
                : `${t('runtimeConfig.overview.partnersHero.allAction')} →`}
            </button>
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
