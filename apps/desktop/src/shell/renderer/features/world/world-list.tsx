import { useMemo, useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, LoadingSkeleton, NimiText, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import { formatNum } from './world-list-atoms';
import { categoryMatches, matchesQuery, selectFeaturedWorlds, selectInitialWorld, sortWorlds, type CategoryId, type SortId, type ViewMode } from './world-list-catalog-model';
import { AtlasCategoryTabs } from './world-list-catalog-controls';
import { CompactWorldCard } from './world-list-compact-card';
import { FeaturedStrip } from './world-list-featured-strip';
import { SelectedWorldPanel } from './world-list-selected-panel';
import { useFollowedWorlds } from './world-follow-store';
import type { WorldListItem } from './world-list-model';

export function WorldsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <div className="mx-auto grid w-full max-w-[1540px] gap-5">
      <LoadingSkeleton lines={1} className="max-w-md" />
      <Surface tone="panel" material="glass-regular" padding="sm" className="h-14 shadow-none" style={{ boxShadow: 'none' }} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          <Surface tone="card" material="glass-regular" padding="md" className="h-60 shadow-none" style={{ boxShadow: 'none' }} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <Surface key={index} tone="card" material="glass-regular" padding="md" className="h-[88px] shadow-none" style={{ boxShadow: 'none' }}>
                <LoadingSkeleton lines={2} />
              </Surface>
            ))}
          </div>
        </div>
        <Surface tone="panel" material="glass-regular" padding="md" className="h-[660px] shadow-none" style={{ boxShadow: 'none' }}>
          <LoadingSkeleton lines={5} />
        </Surface>
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
      <NimiText role="body" className="text-[var(--nimi-status-danger)]">{t('World.loadError')}</NimiText>
    </div>
  );
}

export function WorldCatalogContent({
  worlds,
  onOpenWorld,
  embedded = false,
  searchQuery,
}: {
  worlds: WorldListItem[];
  onOpenWorld: (worldId: string) => void;
  embedded?: boolean;
  searchQuery?: string;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<CategoryId>('all');
  const [sort, setSort] = useState<SortId>('active');
  const [view, setView] = useState<ViewMode>('grid');
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(() => selectInitialWorld(worlds));
  const query = searchQuery ?? '';
  const followed = useFollowedWorlds();
  const isFollowedCategory = category === 'followed';

  const filteredWorlds = useMemo(() => {
    const searched = worlds
      .filter((world) => matchesQuery(world, query))
      .filter((world) => (category === 'followed' ? followed.isFollowed(world.id) : categoryMatches(world, category)));
    const sorted = sortWorlds(searched, category === 'new' ? 'recent' : sort);
    if (category === 'trending') {
      return sorted.slice(0, Math.max(1, Math.min(sorted.length, 18)));
    }
    return sorted;
  }, [category, query, sort, worlds, followed]);

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
      className="mx-auto grid w-full max-w-[1540px]"
      style={{ gap: 18 }}
    >
      <AtlasCategoryTabs
        active={category}
        onChange={setCategory}
        followedCount={followed.ids.length}
        view={view}
        onViewChange={setView}
        sort={sort}
        onSortChange={setSort}
      />

      <div
        className="grid items-start"
        style={{
          gridTemplateColumns: 'minmax(760px,1fr) minmax(288px,clamp(288px,24vw,320px))',
          gap: 18,
        }}
      >
        <main className="grid min-w-0 gap-6">
          <FeaturedStrip
            worlds={featuredWorlds}
            selectedWorldId={selectedWorld?.id ?? null}
            onSelectWorld={setSelectedWorldId}
            onOpenWorld={onOpenWorld}
          />
          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <NimiText as="h2" role="section-title" className="truncate">
                  {isFollowedCategory ? t('World.atlas.followed.title') : t('World.sidebar.filters.all')}
                </NimiText>
                <NimiText as="span" role="caption" className="shrink-0 font-bold">
                  {isFollowedCategory
                    ? t('World.atlas.followed.summary', { value: formatNum(followed.ids.length) })
                    : t('World.atlas.worldCount', { value: formatNum(filteredWorlds.length) })}
                </NimiText>
              </div>
              <NimiText as="span" role="caption" className="font-bold">
                {t('World.atlas.sourceDiscovery')}
              </NimiText>
            </div>
            {filteredWorlds.length === 0 ? (
              isFollowedCategory && !query ? (
                <EmptyState
                  data-testid="world-atlas-followed-empty"
                  icon={<Heart size={28} aria-hidden="true" />}
                  title={t('World.atlas.followed.empty.title')}
                  description={followed.available ? t('World.atlas.followed.empty.body') : t('World.atlas.followed.unavailable')}
                  action={(
                    <Button type="button" tone="primary" size="sm" onClick={() => setCategory('all')}>
                      {t('World.atlas.followed.empty.cta')}
                    </Button>
                  )}
                  className="shadow-none"
                  style={{ boxShadow: 'none' }}
                />
              ) : (
                <EmptyState
                  title={query ? t('World.noSearchResults') : t('World.card.noMatch')}
                  className="shadow-none"
                  style={{ boxShadow: 'none' }}
                />
              )
            ) : (
              <div
                data-testid="world-atlas-world-grid"
                className="grid"
                style={{
                  gridTemplateColumns: view === 'grid'
                    ? 'repeat(auto-fill, minmax(250px, 1fr))'
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
                    followed={followed.isFollowed(world.id)}
                    followAvailable={followed.available}
                    onToggleFollow={() => followed.toggle(world.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
        {selectedWorld ? (
          <SelectedWorldPanel
            world={selectedWorld}
            onOpen={() => onOpenWorld(selectedWorld.id)}
            followed={followed.isFollowed(selectedWorld.id)}
            followAvailable={followed.available}
            onToggleFollow={() => followed.toggle(selectedWorld.id)}
          />
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
