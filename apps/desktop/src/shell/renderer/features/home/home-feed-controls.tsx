import { NIMI_REALM_FEED_SCOPES, type NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import { Tooltip } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';

/**
 * Canonical Realm feed scopes presented on the Home feed surface.
 * Authority: `.nimi/spec/canonical/desktop/product-surfaces.authority.yaml`
 * (`rule.nimi.desktop.product-surfaces.r018`) over Realm `R-FEED-005`.
 * Machine projection: `config/desktop-product-surfaces-home-feed-scopes.yaml`.
 */
export const HOME_FEED_SCOPES = NIMI_REALM_FEED_SCOPES;
export const DEFAULT_HOME_FEED_SCOPE: NimiRealmFeedScope = 'friends';

function scopeLabelDefault(scope: NimiRealmFeedScope): string {
  if (scope === 'personal') return 'Me';
  if (scope === 'friends') return 'Friends';
  if (scope === 'persona_activity') return 'Personas';
  return 'World Characters';
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
            className={`inline-flex h-10 items-center text-[16px] font-semibold leading-none transition-colors duration-200 ease-out hover:text-[color:var(--nimi-fg-1)] ${selected ? 'text-[color:var(--nimi-accent)]' : 'text-[color:var(--nimi-fg-2)]'}`}
            style={{
              fontFamily: 'var(--nimi-font-display)',
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
        className="inline-flex h-9 items-center gap-1 rounded-full bg-transparent px-3 text-[14px] font-semibold leading-none text-[color:var(--nimi-fg-2)] transition-colors duration-200 ease-out hover:text-[color:var(--nimi-accent)]"
        aria-label={t('Home.createPost', { defaultValue: 'Create Post' })}
        style={{ fontFamily: 'var(--nimi-font-display)' }}
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
