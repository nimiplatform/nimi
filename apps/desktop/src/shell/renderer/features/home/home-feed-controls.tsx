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
      className="flex min-w-0 items-center gap-8"
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
            className={`inline-flex h-10 items-center text-[15px] transition-colors duration-200 ease-out hover:text-[color:var(--nimi-fg-1)] ${selected ? 'font-semibold text-[color:var(--nimi-accent)]' : 'font-medium text-[color:var(--nimi-fg-2)]'}`}
            style={{
              fontFamily: 'var(--nimi-font-sans)',
              background: 'transparent',
              border: 'none',
              boxShadow: undefined,
            }}
          >
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
