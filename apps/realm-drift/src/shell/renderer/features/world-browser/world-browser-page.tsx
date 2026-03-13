import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMyWorldsQuery } from './world-browser-queries.js';
import { WorldCard } from './world-card.js';

export function WorldBrowserPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: worlds, isLoading, error } = useMyWorldsQuery();
  const [search, setSearch] = useState('');

  const filteredWorlds = useMemo(() => {
    if (!worlds) return [];
    const term = search.toLowerCase().trim();
    if (!term) return worlds;
    return worlds.filter(
      (w) =>
        w.name.toLowerCase().includes(term) ||
        (w.genre?.toLowerCase().includes(term) ?? false) ||
        (w.era?.toLowerCase().includes(term) ?? false),
    );
  }, [worlds, search]);

  const handleWorldClick = (worldId: string) => {
    navigate(`/world/${worldId}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with drag region for macOS title bar */}
      <div className="flex items-center gap-4 px-6 pt-10 pb-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <h1 className="text-xl font-bold" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {t('browser.title')}
        </h1>
        <div className="flex-1" />
        <input
          type="text"
          placeholder={t('browser.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-white placeholder:text-neutral-500 focus:border-white focus:outline-none"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {isLoading && (
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden animate-pulse">
                <div className="aspect-video bg-neutral-800" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-neutral-800" />
                  <div className="h-3 w-1/2 rounded bg-neutral-800" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
            <p className="text-red-400">{error instanceof Error ? error.message : t('error.networkError')}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-neutral-800 px-4 py-2 text-sm hover:bg-neutral-700 transition-colors"
            >
              {t('error.retry')}
            </button>
          </div>
        )}

        {!isLoading && !error && filteredWorlds.length === 0 && (
          <div className="flex items-center justify-center py-20 text-neutral-500">
            {t('browser.empty')}
          </div>
        )}

        {!isLoading && !error && filteredWorlds.length > 0 && (
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            {filteredWorlds.map((world) => (
              <WorldCard key={world.id} world={world} onClick={handleWorldClick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
