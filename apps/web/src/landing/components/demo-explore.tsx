import { useState } from 'react';
import { AppCardSurface, SearchField } from '@nimiplatform/kit/ui';
import type { HeroDemo } from '../content/landing-content.js';

export function DemoExploreSurface({ explore }: { explore: HeroDemo['explore'] }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-1 py-1">
      <SearchField
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={explore.searchPlaceholder}
        aria-label={explore.searchPlaceholder}
      />
      <div className="mt-4 space-y-4 pb-2">
        {explore.sections.map((section) => {
          const items = normalizedQuery
            ? section.items.filter((item) => (
              item.name.toLowerCase().includes(normalizedQuery)
              || item.meta.toLowerCase().includes(normalizedQuery)
            ))
            : section.items;
          if (items.length === 0) return null;
          return (
            <div key={section.label}>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
                {section.label}
              </p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {items.map((item) => (
                  <li key={`${section.label}-${item.name}-${item.meta}`}>
                    <AppCardSurface className="flex items-center gap-3 px-3.5 py-2.5">
                      <span
                        className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-[#e8fbf3] to-[#eaf5fe] ring-1 ring-white/80"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--nimi-text-primary)]">{item.name}</span>
                        <span className="block truncate text-[11px] text-[var(--nimi-text-muted)]">{item.meta}</span>
                      </span>
                    </AppCardSurface>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
