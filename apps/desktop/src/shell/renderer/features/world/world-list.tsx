import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, LoadingSkeleton, NimiText, ScrollArea, Surface } from '@nimiplatform/kit/ui';
import type { CharacterSourceRefV3 } from '@renderer/features/realm-source/realm-source-identity.js';
import type { WorldDetailNavigationOptions } from '@renderer/app-shell/providers/store-types';
import { formatNum } from './world-list-atoms';
import { categoryMatches, isWorldVisibleInAtlas, matchesQuery, selectFeaturedWorlds, selectInitialWorld, sortWorlds, type CategoryId, type SortId, type ViewMode } from './world-list-catalog-model';
import { AtlasCategoryTabs } from './world-list-catalog-controls';
import { CompactWorldCard } from './world-list-compact-card';
import { FeaturedStrip } from './world-list-featured-strip';
import { SelectedWorldPanel } from './world-list-selected-panel';
import { useFollowedWorlds } from './world-follow-store';
import { WORLD_EXPLORER_THEME } from './world-list-theme';
import type { WorldCharacter } from './world-detail-types';
import type { WorldListItem } from './world-list-model';

type WorldAtlasShellColumnsStyle = CSSProperties & Record<'--world-atlas-shell-columns', string>;

const WORLD_ATLAS_SHELL_COLUMNS_STYLE: WorldAtlasShellColumnsStyle = {
  '--world-atlas-shell-columns': 'minmax(0,1fr) minmax(324px,clamp(324px,24vw,360px))',
};

export function WorldsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <div className="mx-auto min-w-0 w-full max-w-[min(100%,1390px)]" style={WORLD_EXPLORER_THEME.root}>
      <div
        className="grid min-w-0 items-start gap-[18px] min-[1180px]:[grid-template-columns:var(--world-atlas-shell-columns)]"
        style={WORLD_ATLAS_SHELL_COLUMNS_STYLE}
      >
        <Surface
          tone="panel"
          material="glass-regular"
          padding="none"
          className="min-w-0 max-w-full rounded-[32px] p-4 sm:p-5 xl:p-6"
          style={WORLD_EXPLORER_THEME.discoveryPanel}
        >
          <LoadingSkeleton lines={2} className="max-w-md" />
          <Surface tone="panel" material="solid" padding="sm" className="mt-5 h-14 rounded-[24px]" style={WORLD_EXPLORER_THEME.weakBlock} />
          <div className="mt-6 grid min-w-0 gap-6">
            <Surface tone="card" material="solid" padding="md" className="h-[182px] rounded-[18px]" style={WORLD_EXPLORER_THEME.card} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Surface key={index} tone="card" material="solid" padding="md" className="h-[112px] rounded-[20px]" style={WORLD_EXPLORER_THEME.card}>
                  <LoadingSkeleton lines={2} />
                </Surface>
              ))}
            </div>
          </div>
        </Surface>
        <Surface tone="panel" material="solid" padding="md" className="h-[720px] rounded-[32px]" style={WORLD_EXPLORER_THEME.panel}>
          <LoadingSkeleton lines={5} />
        </Surface>
      </div>
    </div>
  );
  if (embedded) {
    return <div className="py-3">{content}</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={WORLD_EXPLORER_THEME.page}>
      <ScrollArea className="flex-1" contentClassName="min-w-0 max-w-full px-3 py-4 sm:px-6 sm:py-6">
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
  onOpenPerson,
  onMaterializePerson,
  embedded = false,
  searchQuery,
}: {
  worlds: WorldListItem[];
  onOpenWorld: (worldId: string, options?: WorldDetailNavigationOptions) => void;
  onOpenPerson?: (sourceRef: CharacterSourceRefV3) => void;
  onMaterializePerson?: (character: WorldCharacter) => Promise<void> | void;
  embedded?: boolean;
  searchQuery?: string;
}) {
  const { t } = useTranslation();
  const visibleWorlds = useMemo(() => worlds.filter(isWorldVisibleInAtlas), [worlds]);
  const [category, setCategory] = useState<CategoryId>('all');
  const [sort, setSort] = useState<SortId>('active');
  const [view, setView] = useState<ViewMode>('grid');
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(() => selectInitialWorld(visibleWorlds));
  const query = searchQuery ?? '';
  const followed = useFollowedWorlds();
  const isFollowedCategory = category === 'followed';

  const filteredWorlds = useMemo(() => {
    const searched = visibleWorlds
      .filter((world) => matchesQuery(world, query))
      .filter((world) => (category === 'followed' ? followed.isFollowed(world.id) : categoryMatches(world, category)));
    const sorted = sortWorlds(searched, category === 'new' ? 'recent' : sort);
    if (category === 'trending') {
      return sorted.slice(0, Math.max(1, Math.min(sorted.length, 18)));
    }
    return sorted;
  }, [category, query, sort, visibleWorlds, followed]);

  const featuredWorlds = useMemo(() => selectFeaturedWorlds(visibleWorlds), [visibleWorlds]);

  const selectedWorld = useMemo(() => {
    return (
      filteredWorlds.find((world) => world.id === selectedWorldId)
      ?? filteredWorlds[0]
      ?? visibleWorlds[0]
      ?? null
    );
  }, [filteredWorlds, selectedWorldId, visibleWorlds]);

  const content = (
    <div
      data-testid="world-atlas-glass-layout"
      className="mx-auto min-w-0 w-full max-w-[min(100%,1390px)]"
      style={WORLD_EXPLORER_THEME.root}
    >
      <div
        className={[
          'grid min-w-0 items-start gap-[18px]',
          selectedWorld ? 'min-[1180px]:[grid-template-columns:var(--world-atlas-shell-columns)]' : '',
        ].join(' ')}
        style={selectedWorld ? WORLD_ATLAS_SHELL_COLUMNS_STYLE : undefined}
      >
        <Surface
          as="section"
          data-testid="world-atlas-discovery-panel"
          tone="panel"
          material="glass-regular"
          elevation="floating"
          padding="none"
          className="min-w-0 max-w-full rounded-[32px] p-4 sm:p-5 xl:p-6"
          style={WORLD_EXPLORER_THEME.discoveryPanel}
        >
          <header className="mb-5 flex min-w-0 flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <NimiText
                as="h1"
                role="page-title"
                className="truncate text-[24px] font-extrabold leading-8 text-[var(--world-explorer-text)]"
              >
                {t('World.atlas.discovery.title')}
              </NimiText>
              <NimiText
                as="p"
                role="body"
                className="mt-1 text-[13px] font-medium text-[var(--world-explorer-text-secondary)]"
              >
                {t('World.atlas.discovery.subtitle')}
              </NimiText>
            </div>
          </header>

          <AtlasCategoryTabs
            active={category}
            onChange={setCategory}
            followedCount={followed.ids.length}
            view={view}
            onViewChange={setView}
            sort={sort}
            onSortChange={setSort}
          />

          <main className="mt-6 grid min-w-0 max-w-full gap-6">
            <FeaturedStrip
              worlds={featuredWorlds}
              selectedWorldId={selectedWorld?.id ?? null}
              onSelectWorld={setSelectedWorldId}
              onOpenWorld={onOpenWorld}
            />
            <section className="grid min-w-0 gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <NimiText as="h2" role="section-title" className="truncate text-[18px] font-bold text-[var(--world-explorer-text)]">
                    {isFollowedCategory ? t('World.atlas.followed.title') : t('World.sidebar.filters.all')}
                  </NimiText>
                  <NimiText as="span" role="caption" className="shrink-0 font-semibold text-[var(--world-explorer-text-muted)]">
                    {isFollowedCategory
                      ? t('World.atlas.followed.summary', { value: formatNum(followed.ids.length) })
                      : t('World.atlas.worldCount', { value: formatNum(filteredWorlds.length) })}
                  </NimiText>
                </div>
              </div>
              {filteredWorlds.length === 0 ? (
                isFollowedCategory && !query ? (
                  <EmptyState
                    data-testid="world-atlas-followed-empty"
                    icon={<Heart size={28} aria-hidden="true" />}
                    title={t('World.atlas.followed.empty.title')}
                    description={followed.available ? t('World.atlas.followed.empty.body') : t('World.atlas.followed.unavailable')}
                    action={(
                      <Button
                        type="button"
                        tone="primary"
                        size="sm"
                        className="bg-[var(--world-explorer-brand)] text-white hover:bg-[var(--world-explorer-brand-hover)]"
                        onClick={() => setCategory('all')}
                      >
                        {t('World.atlas.followed.empty.cta')}
                      </Button>
                    )}
                    style={WORLD_EXPLORER_THEME.card}
                  />
                ) : (
                  <EmptyState
                    title={query ? t('World.noSearchResults') : t('World.card.noMatch')}
                    style={WORLD_EXPLORER_THEME.card}
                  />
                )
              ) : (
                <div
                  data-testid="world-atlas-world-grid"
                  className="grid min-w-0 max-w-full"
                  style={{
                    gridTemplateColumns: view === 'grid'
                      ? 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))'
                      : 'minmax(0, 1fr)',
                    gap: 16,
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
              {filteredWorlds.length > 0 ? (
                <div className="flex justify-center pt-3">
                  <Button
                    type="button"
                    data-testid="world-atlas-discover-more"
                    tone="secondary"
                    size="md"
                    trailingIcon={<ChevronDown size={15} aria-hidden="true" />}
                    className="rounded-full border-transparent bg-[var(--world-explorer-surface)] px-8 text-[var(--world-explorer-text-secondary)] hover:bg-[var(--world-explorer-brand-soft)] hover:text-[var(--world-explorer-brand)]"
                    style={WORLD_EXPLORER_THEME.discoverMore}
                    onClick={() => {
                      setCategory((current) => (current === 'all' ? 'trending' : 'all'));
                      setSort('active');
                    }}
                  >
                    {t('World.atlas.discoverMore')}
                  </Button>
                </div>
              ) : null}
            </section>
          </main>
        </Surface>
        {selectedWorld ? (
          <SelectedWorldPanel
            world={selectedWorld}
            onOpen={() => onOpenWorld(selectedWorld.id)}
            onOpenPerson={onOpenPerson}
            onMaterializePerson={onMaterializePerson}
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
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" style={WORLD_EXPLORER_THEME.page}>
      <ScrollArea className="flex-1" contentClassName="min-w-0 max-w-full px-3 pb-8 pt-4 sm:px-6 sm:pb-10 sm:pt-6">
        {content}
      </ScrollArea>
    </div>
  );
}
