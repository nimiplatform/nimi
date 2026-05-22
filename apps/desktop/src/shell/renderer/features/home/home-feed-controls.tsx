import type { PostFeedScope } from '@runtime/data-sync';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';

/**
 * Canonical Realm feed scopes presented on the Home feed surface.
 * Source of truth: `.nimi/spec/desktop/kernel/tables/home-feed-scopes.yaml`
 * (D-HOMEFEED-004) over Realm `R-FEED-005`.
 */
export const HOME_FEED_SCOPES: readonly PostFeedScope[] = ['personal', 'friends', 'agent_activity'];
export const DEFAULT_HOME_FEED_SCOPE: PostFeedScope = 'friends';

function scopeLabelDefault(scope: PostFeedScope): string {
  if (scope === 'personal') return 'Me';
  if (scope === 'friends') return 'Friends';
  return 'Agent';
}

function HomeFeedScopeIcon({ scope }: { scope: PostFeedScope }) {
  if (scope === 'personal') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  if (scope === 'friends') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 21a6 6 0 0 0-12 0" />
        <circle cx="10" cy="8" r="4" />
        <path d="M22 21a5 5 0 0 0-4-4.9" />
        <path d="M16 4.1a4 4 0 0 1 0 7.8" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 8V4" />
      <rect x="5" y="8" width="14" height="10" rx="4" />
      <path d="M9 13h.01" />
      <path d="M15 13h.01" />
      <path d="M9 21h6" />
    </svg>
  );
}

export function HomeFeedScopeNav({
  active,
  onSelect,
}: {
  active: PostFeedScope;
  onSelect: (scope: PostFeedScope) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('Home.feedScopeSelectorLabel', { defaultValue: 'Feed scope' })}
      className="flex min-w-0 items-center gap-3"
      data-testid="home-feed-scope-nav"
    >
      {HOME_FEED_SCOPES.map((scope) => {
        const selected = scope === active;
        return (
          <button
            key={scope}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`home-feed-scope-tab-${scope}`}
            data-mod-tab-interactive="true"
            onClick={() => onSelect(scope)}
            className="inline-flex h-10 items-center gap-2 rounded-2xl px-4 text-[15px] font-semibold transition-[background-color,color,box-shadow,border-color]"
            style={{
              fontFamily: 'var(--nimi-font-sans)',
              background: selected
                ? 'color-mix(in srgb, var(--nimi-accent) 12%, white 88%)'
                : 'transparent',
              color: selected ? 'var(--nimi-accent)' : 'var(--nimi-fg-2)',
              border: selected
                ? '1px solid color-mix(in srgb, var(--nimi-accent) 10%, white 70%)'
                : '1px solid transparent',
              boxShadow: selected ? '0 14px 34px rgba(78,204,163,0.10)' : undefined,
            }}
          >
            <span aria-hidden className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
              <HomeFeedScopeIcon scope={scope} />
            </span>
            {t(`Home.feedScopeHeaderLabels.${scope}`, { defaultValue: scopeLabelDefault(scope) })}
          </button>
        );
      })}
    </nav>
  );
}

export function HomeCreatePostButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t('Home.createPost', { defaultValue: 'Create Post' })} className="h-10">
      <button
        type="button"
        data-testid="home-create-post-header-button"
        data-mod-tab-interactive="true"
        onClick={onClick}
        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--nimi-accent)_14%,white)] bg-[color-mix(in_srgb,var(--nimi-accent)_14%,white)] text-[var(--nimi-accent)] shadow-[0_14px_34px_rgba(78,204,163,0.12)] transition hover:bg-[color-mix(in_srgb,var(--nimi-accent)_18%,white)]"
        aria-label={t('Home.createPost', { defaultValue: 'Create Post' })}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </Tooltip>
  );
}
