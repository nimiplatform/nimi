import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/nimi-kit/ui';

// Canonical Explore section catalog. Fact source:
// .nimi/spec/desktop/kernel/tables/explore-sections.yaml (D-EXPL-002).
// The sections are fixed; do not add/remove/rename without updating the
// table and the explore-surface-contract.
export type ExploreSectionId = 'worlds' | 'agents' | 'activity';

export const EXPLORE_SECTION_IDS: readonly ExploreSectionId[] = [
  'worlds',
  'agents',
  'activity',
] as const;

type SectionMeta = {
  id: ExploreSectionId;
  labelKey: string;
  descKey: string;
  icon: ReactNode;
};

const ICON_WORLDS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ICON_AGENTS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ICON_ACTIVITY = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
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
    descKey: 'Explore.sectionWorldsDesc',
    icon: ICON_WORLDS,
  },
  agents: {
    id: 'agents',
    labelKey: 'Explore.sectionAgents',
    descKey: 'Explore.sectionAgentsDesc',
    icon: ICON_AGENTS,
  },
  activity: {
    id: 'activity',
    labelKey: 'Explore.sectionActivity',
    descKey: 'Explore.sectionActivityDesc',
    icon: ICON_ACTIVITY,
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
  const nav = (
    <div className={variant === 'topbar' ? 'flex min-w-0 items-center gap-3' : 'flex flex-wrap items-center gap-2'}>
      <nav
        aria-label={t('Explore.sectionNavLabel', { defaultValue: 'Explore sections' })}
        className={variant === 'topbar' ? 'flex min-w-0 items-center gap-3' : 'flex min-w-0 flex-wrap gap-1.5'}
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
              data-testid={`explore-section-tab-${id}`}
              data-mod-tab-interactive="true"
              onClick={() => onSelect(id)}
              className={variant === 'topbar'
                ? `inline-flex h-10 items-center gap-2 rounded-2xl px-4 text-[15px] transition-[color,transform,font-weight] duration-200 ease-out hover:-translate-y-0.5 hover:text-[color:var(--nimi-accent)] active:translate-y-0 active:scale-95 ${isActive ? 'font-bold text-[color:var(--nimi-accent)]' : 'font-semibold text-[color:var(--nimi-fg-2)]'}`
                : 'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors'}
              style={{
                fontFamily: 'var(--nimi-font-sans)',
                background: variant === 'topbar'
                  ? 'transparent'
                  : (isActive ? 'var(--nimi-accent)' : 'transparent'),
                color: variant === 'topbar'
                  ? undefined
                  : (isActive ? 'var(--nimi-accent-onAccent)' : 'var(--nimi-fg-2)'),
                border: variant === 'topbar'
                  ? '1px solid transparent'
                  : (isActive
                    ? '1px solid color-mix(in srgb, var(--nimi-accent) 80%, transparent)'
                    : '1px solid transparent'),
                boxShadow: undefined,
              }}
            >
              <span aria-hidden className="shrink-0">{meta.icon}</span>
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

  if (variant === 'topbar') {
    return nav;
  }

  return (
    <Surface
      tone="panel"
      material="glass-regular"
      padding="none"
      className="rounded-2xl border-white/60 p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.05)]"
    >
      {nav}
    </Surface>
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
  return (
    <div
      className="group relative flex h-10 items-center rounded-2xl border border-[color-mix(in_srgb,var(--nimi-border-subtle)_68%,white)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,white)] px-4 shadow-[0_14px_34px_rgba(15,23,42,0.05)] backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
      data-testid="explore-search-field"
      data-mod-tab-interactive="true"
    >
      <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-[color:var(--nimi-fg-3)] transition-colors group-focus-within:text-[color:var(--nimi-accent)]">
        {ICON_SEARCH}
      </span>
      <input
        type="search"
        className="w-full bg-transparent py-2 pl-8 pr-1 text-sm font-medium text-[color:var(--nimi-fg-1)] outline-none placeholder:text-[color:var(--nimi-fg-3)] focus:ring-0"
        style={{ fontFamily: 'var(--nimi-font-sans)' }}
        placeholder={placeholder ?? t('Explore.searchPlaceholder', { defaultValue: 'Search worlds, agents, posts...' })}
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
      <p
        className="mt-1.5"
        style={{
          fontFamily: 'var(--nimi-font-sans)',
          fontSize: 13,
          color: 'var(--nimi-fg-3)',
          margin: 0,
        }}
      >
        {t(meta.descKey)}
      </p>
    </div>
  );
}
