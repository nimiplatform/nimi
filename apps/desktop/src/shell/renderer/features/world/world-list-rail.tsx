import { type KeyboardEvent, type ReactNode } from 'react';
import { Heart, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  EmptyState,
  IconButton,
  InlineAlert,
  SearchField,
  SidebarShell,
} from '@nimiplatform/kit/ui';
import { formatNum } from './world-list-atoms';
import { displayTags } from './world-list-catalog-model';
import { WorldCover } from './world-list-cover';
import type { WorldListItem } from './world-list-model';
import type { WorldCatalogPaging } from './world-list';

type WorldCatalogRailProps = {
  totalCount: number;
  worlds: readonly WorldListItem[];
  paging: WorldCatalogPaging;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedWorldId: string | null;
  onSelectWorld: (worldId: string) => void;
  isFollowed: (worldId: string) => boolean;
  followAvailable: boolean;
  onToggleFollow: (worldId: string) => void;
  listEmptyLabel: string;
  flap?: ReactNode;
};

export function WorldCatalogRail({
  totalCount,
  worlds,
  paging,
  searchQuery,
  onSearchChange,
  selectedWorldId,
  onSelectWorld,
  isFollowed,
  followAvailable,
  onToggleFollow,
  listEmptyLabel,
  flap,
}: WorldCatalogRailProps) {
  const { t } = useTranslation();

  const renderRow = (world: WorldListItem, index: number) => (
    <RailWorldRow
      key={world.id}
      world={world}
      selected={world.id === selectedWorldId}
      tabIndex={world.id === selectedWorldId || (!selectedWorldId && index === 0) ? 0 : -1}
      onSelect={() => onSelectWorld(world.id)}
      onKeyDown={handleRailKeyDown}
      followed={isFollowed(world.id)}
      followAvailable={followAvailable}
      onToggleFollow={() => onToggleFollow(world.id)}
    />
  );

  return (
    <SidebarShell className="min-h-0 w-full lg:w-[272px]" data-testid="world-rail">
      <div className="flex min-h-[var(--nimi-sidebar-header-height)] shrink-0 items-center gap-2.5 px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-6 text-[color:var(--nimi-text-primary)]">
            {t('World.atlas.discovery.title')}
          </h1>
          <p className="truncate text-[11px] text-[color:var(--nimi-text-muted)]" data-testid="world-rail-count">
            {worlds.length < totalCount
              ? t('World.atlas.loadedCount', { loaded: formatNum(worlds.length), total: formatNum(totalCount) })
              : t('World.atlas.worldCount', { value: formatNum(totalCount) })}
          </p>
        </div>
        {flap}
      </div>

      <div className="flex shrink-0 items-center gap-1 px-2 pb-2" data-testid="world-rail-search">
        <SearchField
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onSearchChange('');
          }}
          trailing={searchQuery ? (
            <IconButton
              data-testid="world-rail-search-clear"
              icon={<X className="h-3 w-3" aria-hidden="true" />}
              tone="ghost"
              size="sm"
              aria-label={t('World.clearSearch')}
              title={t('World.clearSearch')}
              className="h-5 w-5 min-h-0 shrink-0 rounded-full text-[var(--nimi-text-muted)]"
              onClick={() => onSearchChange('')}
            />
          ) : undefined}
          placeholder={t('World.searchPlaceholder')}
          aria-label={t('World.searchPlaceholder')}
          className="min-h-8 flex-1"
          inputClassName="text-xs"
        />
      </div>
      {paging.offlineIncomplete ? (
        <div className="shrink-0 px-2 pb-2" data-testid="world-rail-offline-incomplete">
          <InlineAlert tone="warning">{t('World.atlas.offlineIncomplete')}</InlineAlert>
        </div>
      ) : null}

      <div
        data-world-rail-list
        className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-2 pb-2 lg:flex-col lg:gap-0 lg:overflow-x-hidden lg:overflow-y-auto"
      >
        {worlds.length === 0 ? (
          <EmptyState className="m-2 lg:mx-1" title={listEmptyLabel} />
        ) : (
          <div className="flex gap-2 lg:flex-col lg:gap-0.5">
            {worlds.map((world, index) => renderRow(world, index))}
            {paging.hasMore && !paging.offlineIncomplete ? (
              <div className="flex shrink-0 flex-col items-stretch gap-1 px-1 py-2" data-testid="world-rail-load-more">
                {paging.loadMoreFailed ? (
                  <span className="text-[11px] text-[var(--nimi-status-danger)]">{t('World.atlas.loadMoreError')}</span>
                ) : null}
                <Button
                  type="button"
                  tone="secondary"
                  size="sm"
                  disabled={paging.loadingMore}
                  onClick={paging.onLoadMore}
                >
                  {paging.loadingMore ? t('World.atlas.loadingMore') : t('World.atlas.loadMore')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </SidebarShell>
  );
}

function RailWorldRow({
  world,
  selected,
  tabIndex,
  onSelect,
  onKeyDown,
  followed,
  followAvailable,
  onToggleFollow,
}: {
  world: WorldListItem;
  selected: boolean;
  tabIndex?: number;
  onSelect: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  followed: boolean;
  followAvailable: boolean;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();
  const leadTag = displayTags(world, 1)[0] ?? null;
  return (
    <div className="relative w-[208px] shrink-0 lg:w-auto">
      <button
        type="button"
        data-world-row
        data-testid={`world-rail-entry-${world.id}`}
        aria-pressed={selected}
        tabIndex={tabIndex}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 pr-7 text-left transition-colors focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)] ${selected
          ? 'bg-[var(--nimi-surface-active)]'
          : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)]'
        }`}
      >
        <WorldCover world={world} variant="row" />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[13px] leading-5 text-[color:var(--nimi-text-primary)] ${selected ? 'font-semibold' : 'font-medium'}`}
            title={world.name}
          >
            {world.name}
          </span>
          {leadTag ? (
            <span className="block truncate text-[11px] leading-4 text-[color:var(--nimi-text-muted)]">{leadTag}</span>
          ) : null}
        </span>
      </button>
      <IconButton
        type="button"
        data-testid={`world-rail-follow-${world.id}`}
        aria-label={followed ? t('World.atlas.followed.unfollow') : t('World.atlas.followed.follow')}
        aria-pressed={followed}
        title={followAvailable ? undefined : t('World.atlas.followed.unavailable')}
        disabled={!followAvailable}
        icon={<Heart size={14} fill={followed ? 'currentColor' : 'none'} aria-hidden="true" />}
        tone="ghost"
        size="sm"
        className={`absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full ${followed
          ? 'text-[var(--world-explorer-favorite)]'
          : 'text-[color:var(--nimi-text-muted)]'
        }`}
        onClick={onToggleFollow}
      />
    </div>
  );
}

function handleRailKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const list = event.currentTarget.closest<HTMLElement>('[data-world-rail-list]');
  const rows = Array.from(list?.querySelectorAll<HTMLButtonElement>('[data-world-row]') ?? []);
  const currentIndex = rows.indexOf(event.currentTarget);
  if (currentIndex < 0 || rows.length === 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? rows.length - 1
      : event.key === 'ArrowDown'
        ? (currentIndex + 1) % rows.length
        : (currentIndex - 1 + rows.length) % rows.length;
  // Arrow keys move focus only; Enter/Space activates the focused row through
  // native button behavior, so browsing no longer hijacks the detail surface.
  rows[nextIndex]?.focus();
}
