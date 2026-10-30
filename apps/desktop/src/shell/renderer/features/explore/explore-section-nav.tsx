import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '../../testability/e2e-ids';

// Authority: .nimi/spec/desktop/product-surfaces.authority.yaml
// (rule.nimi.desktop.product-surfaces.r002). Keep this closed UI vocabulary
// aligned with the nearest owner behavior tests.
export type ExploreSectionId = 'worlds' | 'partners';

export const EXPLORE_SECTION_IDS: readonly ExploreSectionId[] = [
  'worlds',
  'partners',
] as const;

type SectionMeta = {
  id: ExploreSectionId;
  labelKey: string;
  icon: ReactNode;
};

const ICON_WORLDS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ICON_PERSONAS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ICON_SEARCH = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const SECTION_META: Record<ExploreSectionId, SectionMeta> = {
  worlds: {
    id: 'worlds',
    labelKey: 'Explore.sectionWorlds',
    icon: ICON_WORLDS,
  },
  partners: {
    id: 'partners',
    labelKey: 'runtimeConfig.partners.title',
    icon: ICON_PERSONAS,
  },
};

export function ExploreSectionNav({
  active,
  onSelect,
  trailing,
  variant = 'panel',
}: {
  active: ExploreSectionId;
  onSelect: (section: ExploreSectionId) => void;
  trailing?: ReactNode;
  variant?: 'panel' | 'topbar';
}) {
  const { t } = useTranslation();
  return (
    <div className={variant === 'topbar' ? 'flex min-w-0 shrink-0 items-center gap-4 sm:gap-8' : 'flex min-w-0 items-center gap-2'}>
      <nav
        aria-label={t('Explore.sectionNavLabel', { defaultValue: 'Explore sections' })}
        className={variant === 'topbar' ? 'flex min-w-0 items-center gap-4 sm:gap-8' : 'flex min-w-0 items-center gap-7'}
        data-testid="explore-section-nav"
      >
        {EXPLORE_SECTION_IDS.map((id) => {
          const meta = SECTION_META[id];
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={E2E_IDS.exploreSectionTab(id)}
              data-titlebar-interactive="true"
              onClick={() => onSelect(id)}
              className={variant === 'topbar'
                ? `inline-flex h-10 shrink-0 items-center text-[15px] transition-colors duration-200 ease-out hover:text-[color:var(--nimi-fg-1)] ${isActive ? 'font-semibold text-[color:var(--nimi-accent)]' : 'font-medium text-[color:var(--nimi-fg-2)]'}`
                : `relative inline-flex h-12 shrink-0 items-center gap-2 text-[15px] transition-colors duration-200 ease-out after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors hover:text-[color:var(--nimi-fg-1)] ${isActive ? 'font-semibold text-[color:var(--nimi-accent)] after:bg-[color:var(--nimi-accent)]' : 'font-medium text-[color:var(--nimi-fg-2)] after:bg-transparent'}`}
              style={{ fontFamily: 'var(--nimi-font-sans)', background: 'transparent' }}
            >
              {variant === 'topbar' ? null : (
                <span aria-hidden className="shrink-0">{meta.icon}</span>
              )}
              {t(meta.labelKey)}
            </button>
          );
        })}
      </nav>
      {trailing && (
        <div className={variant === 'topbar' ? 'min-w-[260px] flex-1' : 'ml-auto w-full min-w-[220px] sm:w-[300px] sm:flex-none'}>
          {trailing}
        </div>
      )}
    </div>
  );
}

export function ExploreSearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('Explore.searchPlaceholder', { defaultValue: 'Search worlds, personas, posts...' });
  return (
    <div
      className="nimi-material-glass-regular group relative mx-auto flex h-11 w-full max-w-[480px] items-center rounded-xl border border-white/60 bg-white/45 pl-4 pr-3 shadow-[0_2px_10px_rgba(0,0,0,0.02)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] transition-all duration-200 focus-within:border-white/90 focus-within:bg-white/70 focus-within:shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
      data-testid="explore-search-field"
      data-titlebar-interactive="true"
    >
      <span className="pointer-events-none mr-3 text-[color:var(--nimi-fg-3)] transition-colors group-focus-within:text-[color:var(--nimi-accent)]">
        {ICON_SEARCH}
      </span>
      <input
        type="search"
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[color:var(--nimi-fg-1)] outline-none placeholder:text-[color:var(--nimi-fg-3)] focus:ring-0"
        style={{ fontFamily: 'var(--nimi-font-sans)' }}
        aria-label={resolvedPlaceholder}
        placeholder={resolvedPlaceholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function ExploreSectionHeader({ section }: { section: ExploreSectionId }) {
  const { t } = useTranslation();
  const meta = SECTION_META[section];
  return (
    <div className="mb-5">
      <h2
        className="m-0"
        style={{
          fontFamily: 'var(--nimi-font-display)',
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: 'var(--nimi-fg-1)',
          lineHeight: 1.1,
        }}
      >
        {t(meta.labelKey)}
      </h2>
    </div>
  );
}
