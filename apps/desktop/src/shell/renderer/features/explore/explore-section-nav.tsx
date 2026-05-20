import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/nimi-kit/ui';

// Canonical Explore section catalog. Fact source:
// .nimi/spec/desktop/kernel/tables/explore-sections.yaml (D-EXPL-002).
// The four sections are fixed; do not add/remove/rename without updating the
// table and the explore-surface-contract.
export type ExploreSectionId = 'worlds' | 'agents' | 'activity' | 'create-agent';

export const EXPLORE_SECTION_IDS: readonly ExploreSectionId[] = [
  'worlds',
  'agents',
  'activity',
  'create-agent',
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

const ICON_CREATE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
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
  'create-agent': {
    id: 'create-agent',
    labelKey: 'Explore.sectionCreateAgent',
    descKey: 'Explore.sectionCreateAgentDesc',
    icon: ICON_CREATE,
  },
};

export function ExploreSectionNav({
  active,
  onSelect,
}: {
  active: ExploreSectionId;
  onSelect: (section: ExploreSectionId) => void;
}) {
  const { t } = useTranslation();
  return (
    <Surface
      tone="panel"
      material="glass-regular"
      padding="none"
      className="rounded-2xl border-white/60 p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.05)]"
    >
      <nav
        aria-label={t('Explore.sectionNavLabel', { defaultValue: 'Explore sections' })}
        className="flex flex-wrap gap-1.5"
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
              onClick={() => onSelect(id)}
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors"
              style={{
                fontFamily: 'var(--nimi-font-sans)',
                background: isActive ? 'var(--nimi-accent)' : 'transparent',
                color: isActive ? 'var(--nimi-accent-onAccent)' : 'var(--nimi-fg-2)',
                border: isActive
                  ? '1px solid color-mix(in srgb, var(--nimi-accent) 80%, transparent)'
                  : '1px solid transparent',
              }}
            >
              <span aria-hidden className="shrink-0">{meta.icon}</span>
              {t(meta.labelKey)}
            </button>
          );
        })}
      </nav>
    </Surface>
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
