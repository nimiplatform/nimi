import { SettingsCard } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';

export function DemoRuntimeSurface({ runtime }: { runtime: HeroDemo['runtime'] }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-1 py-1">
      <p className="text-sm font-semibold tracking-tight text-[var(--nimi-text-primary)]">{runtime.title}</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--nimi-text-muted)]">{runtime.subtitle}</p>
      <div className="mt-3 space-y-3 pb-2">
        {runtime.groups.map((group) => (
          <div key={group.label}>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
              {group.label}
            </p>
            <SettingsCard className="mt-2">
              <ul className="divide-y divide-[var(--nimi-border-subtle)]">
                {group.rows.map((row) => (
                  <li key={row.label} className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-sm text-[var(--nimi-text-secondary)]">{row.label}</span>
                    <span className="rounded-full bg-[var(--nimi-surface-active)] px-2.5 py-1 text-[11px] font-semibold text-[var(--nimi-text-secondary)]">
                      {row.value}
                    </span>
                  </li>
                ))}
              </ul>
            </SettingsCard>
          </div>
        ))}
      </div>
    </div>
  );
}
