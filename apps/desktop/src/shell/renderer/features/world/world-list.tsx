import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { formatNum } from './world-list-atoms';
import { categoryMatches, GLASS_CARD_CLASS, GLASS_CARD_STYLE, matchesQuery, selectFeaturedWorlds, selectInitialWorld, sortWorlds, type CategoryId, type SortId, type ViewMode } from './world-list-catalog-model';
import { AtlasCategoryTabs, AtlasSearch, ViewToggle } from './world-list-catalog-controls';
import { CompactWorldCard } from './world-list-compact-card';
import { FeaturedStrip } from './world-list-featured-strip';
import { SelectedWorldPanel } from './world-list-selected-panel';
import type { WorldListItem } from './world-list-model';

export function WorldsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <div className="mx-auto w-full max-w-[1540px] space-y-5">
      <div className="h-12 w-56 animate-pulse rounded-2xl bg-white/55" />
      <div className="h-14 animate-pulse rounded-2xl bg-white/55" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <div className="h-60 animate-pulse rounded-[22px] bg-white/55" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <div key={index} className="h-[88px] animate-pulse rounded-2xl bg-white/55" />
            ))}
          </div>
        </div>
        <div className="h-[660px] animate-pulse rounded-[22px] bg-white/55" />
      </div>
    </div>
  );
  if (embedded) {
    return <div className="py-3">{content}</div>;
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
  searchQuery,
  onSearchQueryChange,
}: {
  worlds: WorldListItem[];
  onOpenWorld: (worldId: string) => void;
  embedded?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [localQuery, setLocalQuery] = useState('');
  const [category, setCategory] = useState<CategoryId>('all');
  const [sort, setSort] = useState<SortId>('active');
  const [view, setView] = useState<ViewMode>('grid');
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(() => selectInitialWorld(worlds));
  const query = searchQuery ?? localQuery;
  const setQuery = onSearchQueryChange ?? setLocalQuery;

  const filteredWorlds = useMemo(() => {
    const searched = worlds
      .filter((world) => matchesQuery(world, query))
      .filter((world) => categoryMatches(world, category));
    const sorted = sortWorlds(searched, category === 'new' ? 'recent' : sort);
    if (category === 'trending') {
      return sorted.slice(0, Math.max(1, Math.min(sorted.length, 18)));
    }
    return sorted;
  }, [category, query, sort, worlds]);

  const featuredWorlds = useMemo(() => selectFeaturedWorlds(worlds), [worlds]);

  const selectedWorld = useMemo(() => {
    return (
      filteredWorlds.find((world) => world.id === selectedWorldId)
      ?? filteredWorlds[0]
      ?? worlds[0]
      ?? null
    );
  }, [filteredWorlds, selectedWorldId, worlds]);

  const content = (
    <div
      data-testid="world-atlas-glass-layout"
      style={{
        width: '100%',
        maxWidth: 1540,
        margin: '0 auto',
        display: 'grid',
        gap: 18,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'end',
          justifyContent: 'space-between',
          gap: 18,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 220 }}>
          <h1 style={{ margin: 0, color: '#111827', fontSize: 28, lineHeight: 1.05, fontWeight: 950, letterSpacing: 0 }}>
            {t('World.toolbar.heading')}
          </h1>
          <p style={{ margin: '6px 0 0', color: '#7a8799', fontSize: 13, fontWeight: 800 }}>
            {t('World.atlas.countSummary', { value: formatNum(worlds.length) })}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 520px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <AtlasSearch value={query} onChange={setQuery} />
          <ViewToggle view={view} onChange={setView} />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortId)}
            style={{
              height: 40,
              borderRadius: 14,
              border: '1px solid rgba(129,145,169,0.14)',
              background: 'rgba(255,255,255,0.58)',
              color: '#41516a',
              padding: '0 13px',
              fontSize: 12,
              fontWeight: 850,
              fontFamily: 'var(--nimi-font-sans)',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="active">{t('World.atlas.sort.active')}</option>
            <option value="recent">{t('World.atlas.sort.recent')}</option>
            <option value="sources">{t('World.atlas.sort.sources')}</option>
            <option value="alpha">{t('World.atlas.sort.alpha')}</option>
          </select>
        </div>
      </header>

      <AtlasCategoryTabs active={category} onChange={setCategory} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(300px, 352px)',
          gap: 22,
          alignItems: 'start',
        }}
      >
        <main style={{ minWidth: 0, display: 'grid', gap: 24 }}>
          <FeaturedStrip
            worlds={featuredWorlds}
            selectedWorldId={selectedWorld?.id ?? null}
            onSelectWorld={setSelectedWorldId}
            onOpenWorld={onOpenWorld}
          />
          <section style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <h2 style={{ margin: 0, color: '#111827', fontSize: 20, lineHeight: 1, fontWeight: 950, letterSpacing: 0 }}>{t('World.sidebar.filters.all')}</h2>
                <span style={{ color: '#8a95a8', fontSize: 12, fontWeight: 850 }}>{t('World.atlas.worldCount', { value: formatNum(filteredWorlds.length) })}</span>
              </div>
              <div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>
                {t('World.atlas.sourceDiscovery')}
              </div>
            </div>
            {filteredWorlds.length === 0 ? (
              <div
                className={GLASS_CARD_CLASS}
                data-nimi-material="glass-regular"
                data-nimi-tone="card"
                style={{
                  ...GLASS_CARD_STYLE,
                  borderRadius: 18,
                  padding: 46,
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {query ? t('World.noSearchResults') : t('World.card.noMatch')}
              </div>
            ) : (
              <div
                data-testid="world-atlas-world-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: view === 'grid'
                    ? 'repeat(auto-fill, minmax(230px, 1fr))'
                    : 'minmax(0, 1fr)',
                  gap: 12,
                }}
              >
                {filteredWorlds.map((world) => (
                  <CompactWorldCard
                    key={world.id}
                    world={world}
                    selected={world.id === selectedWorld?.id}
                    view={view}
                    onSelect={() => setSelectedWorldId(world.id)}
                    onOpen={() => onOpenWorld(world.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
        {selectedWorld ? (
          <SelectedWorldPanel world={selectedWorld} onOpen={() => onOpenWorld(selectedWorld.id)} />
        ) : null}
      </div>
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
