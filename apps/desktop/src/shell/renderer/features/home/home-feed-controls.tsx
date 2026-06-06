import { NIMI_REALM_FEED_SCOPES, type NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import { Tooltip } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';

/**
 * Canonical Realm feed scopes presented on the Home feed surface.
 * Source of truth: `.nimi/spec/desktop/kernel/tables/home-feed-scopes.yaml`
 * (D-HOMEFEED-004) over Realm `R-FEED-005`.
 */
export const HOME_FEED_SCOPES = NIMI_REALM_FEED_SCOPES;
export const DEFAULT_HOME_FEED_SCOPE: NimiRealmFeedScope = 'friends';

function scopeLabelDefault(scope: NimiRealmFeedScope): string {
  if (scope === 'personal') return 'Me';
  if (scope === 'friends') return 'Friends';
  return 'Agent';
}

export function HomeFeedScopeNav({
  active,
  onSelect,
}: {
  active: NimiRealmFeedScope;
  onSelect: (scope: NimiRealmFeedScope) => void;
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
            data-titlebar-interactive="true"
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
    <Tooltip content={t('Home.createPost', { defaultValue: 'Create Post' })} className="h-9">
      <button
        type="button"
        data-testid="home-create-post-header-button"
        data-titlebar-interactive="true"
        onClick={onClick}
        className="inline-flex h-9 items-center gap-1 rounded-full bg-transparent px-3 text-[13px] font-medium text-[color:var(--nimi-fg-2)] transition-colors duration-200 ease-out hover:text-[color:var(--nimi-accent)]"
        aria-label={t('Home.createPost', { defaultValue: 'Create Post' })}
        style={{ fontFamily: 'var(--nimi-font-sans)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>{t('Home.createPostShort', { defaultValue: 'Post' })}</span>
      </button>
    </Tooltip>
  );
}
