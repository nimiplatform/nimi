import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { FeaturedWorldCard, WorldCard, WorldListRow } from './world-list-cards';
import { isMainWorld, type WorldListItem } from './world-list-model';
import { Kicker } from './world-list-atoms';
import {
  isArchivedWorld,
  WorldCatalogSidebar,
  WorldCatalogToolbar,
  type FilterId,
  type SortId,
  type ViewMode,
} from './world-list-controls';
function sortWorlds(list: WorldListItem[], sort: SortId): WorldListItem[] {
  const arr = [...list];
  if (sort === 'active') {
    arr.sort((a, b) => (b.scoreEwma ?? 0) - (a.scoreEwma ?? 0));
  } else if (sort === 'recent') {
    arr.sort((a, b) => {
      const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return tb - ta;
    });
  } else if (sort === 'alpha') {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'inhabitants') {
    arr.sort((a, b) => b.agentCount - a.agentCount);
  }
  return arr;
}
function matchesQuery(world: WorldListItem, q: string): boolean {
  if (!q) return true;
  const haystack = [
    world.name,
    world.description ?? '',
    world.tagline ?? '',
    world.genre ?? '',
    world.era ?? '',
    ...world.themes,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}
function applyFilter(list: WorldListItem[], filter: FilterId): WorldListItem[] {
  if (filter === 'main') return list.filter((w) => isMainWorld(w));
  if (filter === 'sub') return list.filter((w) => !isMainWorld(w));
  if (filter === 'archived') return list.filter((w) => isArchivedWorld(w));
  return list;
}
export function WorldsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <div className="space-y-2">
        <div className="h-3 w-32 animate-pulse rounded bg-white/60" />
        <div className="h-7 w-40 animate-pulse rounded-lg bg-white/70" />
        <div className="h-4 w-80 animate-pulse rounded bg-white/50" />
      </div>
      <div className="h-48 animate-pulse rounded-3xl bg-white/60" />
      <div className="h-11 animate-pulse rounded-2xl bg-white/60" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-60 animate-pulse rounded-2xl bg-white/60" />
        ))}
      </div>
    </div>
  );
  if (embedded) {
    return <div className="py-6">{content}</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName="px-6 py-6">
        {content}
      </ScrollArea>
    </div>
  );
}

export function WorldsLoadError({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`flex ${embedded ? 'min-h-[220px]' : 'h-full'} items-center justify-center`}>
      <span className="text-sm text-red-600">{t('World.loadError')}</span>
    </div>
  );
}

export function WorldCatalogContent({
  worlds,
  onOpenWorld,
  embedded = false,
}: {
  worlds: WorldListItem[];
  onOpenWorld: (worldId: string) => void;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [sort, setSort] = useState<SortId>('active');
  const [view, setView] = useState<ViewMode>('grid');
  const mainWorld = worlds.find((world) => isMainWorld(world));
  const counts: Record<FilterId, number> = {
    all: worlds.length,
    main: worlds.filter((world) => isMainWorld(world)).length,
    sub: worlds.filter((world) => !isMainWorld(world)).length,
    archived: worlds.filter((world) => isArchivedWorld(world)).length,
  };
  const showFeaturedHero = !embedded && filter === 'all' && !query && Boolean(mainWorld);
  const filteredBase = embedded ? worlds : applyFilter(worlds, filter);
  const withoutHero = showFeaturedHero && mainWorld
    ? filteredBase.filter((world) => world.id !== mainWorld.id)
    : filteredBase;
  const searched = embedded ? withoutHero : withoutHero.filter((world) => matchesQuery(world, query));
  const sorted = sortWorlds(searched, embedded ? 'active' : sort);
  const content = (
    <div
      className="mx-auto grid w-full max-w-[1240px] gap-6"
      style={{ gridTemplateColumns: embedded ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 260px' }}
      data-testid="explore-worlds-catalog"
    >
      <div className="flex min-w-0 flex-col gap-6">
        {!embedded ? (
          <div className="px-0.5">
            <Kicker style={{ marginBottom: 4 }}>
              {t('World.header.kicker')}
            </Kicker>
            <h2
              style={{
                margin: 0,
                fontFamily: 'var(--nimi-font-display)',
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--nimi-text-primary)',
              }}
            >
              {t('World.title')}
            </h2>
          </div>
        ) : null}
        {showFeaturedHero && mainWorld ? (
          <FeaturedWorldCard world={mainWorld} onOpen={() => onOpenWorld(mainWorld.id)} />
        ) : null}
        {!embedded ? (
          <WorldCatalogToolbar
            view={view}
            setView={setView}
            sort={sort}
            setSort={setSort}
            query={query}
            setQuery={setQuery}
            count={sorted.length}
          />
        ) : null}
        {sorted.length === 0 ? (
          <div
            className="nimi-material-glass-regular backdrop-blur-[var(--nimi-backdrop-blur-regular)]"
            style={{
              padding: 48,
              textAlign: 'center',
              color: 'var(--nimi-text-muted)',
              fontSize: 13,
              background: 'var(--nimi-material-glass-regular-bg)',
              border: '1px solid var(--nimi-material-glass-regular-border)',
              borderRadius: 'var(--nimi-radius-lg)',
            }}
          >
            {query ? t('World.noSearchResults') : t('World.card.noMatch')}
          </div>
        ) : embedded || view === 'grid' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {sorted.map((world) => (
              <WorldCard key={world.id} world={world} onOpen={() => onOpenWorld(world.id)} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorted.map((world) => (
              <WorldListRow key={world.id} world={world} onOpen={() => onOpenWorld(world.id)} />
            ))}
          </div>
        )}
      </div>
      {!embedded ? (
        <WorldCatalogSidebar
          worlds={worlds}
          filter={filter}
          setFilter={setFilter}
          counts={counts}
        />
      ) : null}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea className="flex-1" contentClassName="px-6 pb-10 pt-6">
        {content}
      </ScrollArea>
    </div>
  );
}
