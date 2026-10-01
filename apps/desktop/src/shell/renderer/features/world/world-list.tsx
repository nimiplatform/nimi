import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, LoadingSkeleton, NimiText, Surface } from '@nimiplatform/kit/ui';
import { selectInitialWorld } from './world-list-catalog-model';
import { WorldDetail } from './world-detail';
import { WorldCatalogRail } from './world-list-rail';
import { useFollowedWorlds } from './world-follow-store-context.js';
import { WORLD_EXPLORER_THEME } from './world-list-theme';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { WorldListItem } from './world-list-model';

export function WorldsLoadingSkeleton({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const loadingLabel = t('Common.loading', { defaultValue: 'Loading…' });
  const content = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:flex-row" style={WORLD_EXPLORER_THEME.root}>
      <Surface
        tone="panel"
        material="solid"
        padding="md"
        className="w-full shrink-0 rounded-[24px] lg:w-[272px] lg:self-stretch"
        style={WORLD_EXPLORER_THEME.panel}
      >
        <LoadingSkeleton lines={2} className="max-w-[180px]" label={loadingLabel} />
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Surface key={index} tone="card" material="solid" padding="sm" className="h-12 rounded-[14px]" style={WORLD_EXPLORER_THEME.card} />
          ))}
        </div>
      </Surface>
      <Surface
        tone="panel"
        material="solid"
        padding="none"
        className="min-h-[420px] w-full flex-1 overflow-hidden rounded-[24px]"
        style={WORLD_EXPLORER_THEME.panel}
      >
        <div className="h-[220px] w-full sm:h-[280px]" style={WORLD_EXPLORER_THEME.weakBlock} />
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          <LoadingSkeleton lines={5} />
        </div>
      </Surface>
    </div>
  );
  if (embedded) {
    return content;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3" style={WORLD_EXPLORER_THEME.page}>
      {content}
    </div>
  );
}

export function WorldsLoadError({
  embedded = false,
  offline = false,
  onRetry,
}: {
  embedded?: boolean;
  offline?: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`flex ${embedded ? 'min-h-[220px]' : 'h-full'} flex-col items-center justify-center gap-3`}>
      <NimiText role="body" className="text-[var(--nimi-status-danger)]">
        {offline ? t('World.atlas.searchUnavailableOffline') : t('World.loadError')}
      </NimiText>
      {onRetry ? (
        <Button type="button" tone="secondary" size="sm" onClick={onRetry}>
          {t('NotificationPanel.refresh', { defaultValue: 'Refresh' })}
        </Button>
      ) : null}
    </div>
  );
}

export type WorldCatalogPaging = {
  totalCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  offlineIncomplete: boolean;
  onLoadMore: () => void;
};

export function WorldCatalogContent({
  worlds,
  paging,
  embedded = false,
  searchQuery,
  onSearchQueryChange,
  railFlap,
}: {
  worlds: WorldListItem[];
  paging: WorldCatalogPaging;
  embedded?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  railFlap?: ReactNode;
}) {
  const { t } = useTranslation();
  // The catalog selection lives in the UI slice so it survives the Explore
  // panel unmount during the source-detail round trip (navigateBack restores
  // only the tab; local state would reset to selectInitialWorld).
  const storeSelectedWorldId = useAppStore((state) => state.exploreSelectedWorldId);
  const setExploreSelectedWorldId = useAppStore((state) => state.setExploreSelectedWorldId);
  const fallbackWorldId = useMemo(() => selectInitialWorld(worlds), [worlds]);
  const selectedWorldId = storeSelectedWorldId ?? fallbackWorldId;
  const query = searchQuery ?? '';
  const followed = useFollowedWorlds();

  // Worlds arrive in server order; search and paging happen on the server, so the rail never
  // re-sorts or filters a loaded page as if it were the complete catalog.
  const selectedWorld = useMemo(() => {
    return (
      worlds.find((world) => world.id === selectedWorldId)
      ?? worlds[0]
      ?? null
    );
  }, [worlds, selectedWorldId]);

  const emptyState = worlds.length === 0 ? (
    <EmptyState
      title={query ? t('World.noSearchResults') : t('World.card.noMatch')}
      style={WORLD_EXPLORER_THEME.card}
    />
  ) : null;

  const content = (
    <div
      data-testid="world-atlas-glass-layout"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:flex-row"
      style={WORLD_EXPLORER_THEME.root}
    >
      <WorldCatalogRail
        totalCount={paging.totalCount}
        worlds={worlds}
        paging={paging}
        searchQuery={query}
        onSearchChange={(value) => onSearchQueryChange?.(value)}
        selectedWorldId={selectedWorld?.id ?? null}
        onSelectWorld={setExploreSelectedWorldId}
        isFollowed={followed.isFollowed}
        followAvailable={followed.available}
        onToggleFollow={followed.toggle}
        listEmptyLabel={query ? t('World.noSearchResults') : t('World.card.noMatch')}
        flap={railFlap}
      />
      <Surface
        as="main"
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden rounded-[24px] border-[var(--nimi-border-subtle)] shadow-[var(--nimi-elevation-base)] max-lg:min-h-[420px]"
      >
        {emptyState ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {emptyState}
          </div>
        ) : selectedWorld ? (
          <WorldDetail key={selectedWorld.id} world={selectedWorld} />
        ) : null}
      </Surface>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3" style={WORLD_EXPLORER_THEME.page}>
      {content}
    </div>
  );
}
