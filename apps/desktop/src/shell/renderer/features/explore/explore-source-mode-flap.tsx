import { Globe, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type ExploreSourceMode = 'worlds' | 'personas';

/**
 * Compact mode flap rendered inside the Explore source rail header, switching
 * the rail between the world list and the persona list.
 */
export function ExploreSourceModeFlap({
  mode,
  onChange,
}: {
  mode: ExploreSourceMode;
  onChange: (mode: ExploreSourceMode) => void;
}) {
  const { t } = useTranslation();
  const items: readonly { id: ExploreSourceMode; label: string; icon: React.ReactNode }[] = [
    { id: 'worlds', label: t('Explore.sectionWorlds'), icon: <Globe size={14} aria-hidden="true" /> },
    { id: 'personas', label: t('Explore.sectionPersonas'), icon: <Users size={14} aria-hidden="true" /> },
  ];
  return (
    <div
      data-testid="explore-source-mode-flap"
      role="group"
      aria-label={t('Explore.sectionNavLabel')}
      className="desktop-source-mode-switch flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-active)_45%,transparent)] p-0.5"
    >
      {items.map((item) => {
        const active = item.id === mode;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            data-testid={`explore-source-mode-${item.id}`}
            title={item.label}
            aria-label={item.label}
            onClick={() => onChange(item.id)}
            className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] ${active
              ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-sm'
              : 'text-[color:var(--nimi-text-muted)] hover:text-[color:var(--nimi-text-primary)]'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
