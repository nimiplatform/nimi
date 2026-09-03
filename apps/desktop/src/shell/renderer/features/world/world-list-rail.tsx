import { Fragment, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Heart, ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ActionMenu,
  EmptyState,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchField,
  SidebarShell,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import { formatNum } from './world-list-atoms';
import { displayTags, type SortId } from './world-list-catalog-model';
import { WorldCover } from './world-list-cover';
import type { WorldListItem } from './world-list-model';

const SORT_MENU_IDS = ['recent', 'sources', 'alpha'] as const;
type SortMenuId = (typeof SORT_MENU_IDS)[number];
const SORT_LABEL_KEYS: Readonly<Record<SortMenuId, string>> = {
  recent: 'World.atlas.sort.recent',
  sources: 'World.atlas.sort.sources',
  alpha: 'World.atlas.sort.alpha',
};

type WorldCatalogRailProps = {
  totalCount: number;
  worlds: readonly WorldListItem[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sort: SortId;
  onSortChange: (sort: SortId) => void;
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
  searchQuery,
  onSearchChange,
  sort,
  onSortChange,
  selectedWorldId,
  onSelectWorld,
  isFollowed,
  followAvailable,
  onToggleFollow,
  listEmptyLabel,
  flap,
}: WorldCatalogRailProps) {
  const { t } = useTranslation();
  // The rail menu never offers the internal 'active' score ranking; fall back
  // to the default criterion for display if a caller still passes it.
  const menuSort: SortMenuId = sort === 'active' ? 'recent' : sort;
  const sortMenuItems: NimiMenuItem[] = SORT_MENU_IDS.map((id) => ({
    id,
    label: t(SORT_LABEL_KEYS[id]),
    trailingIcon: id === menuSort ? <Check className="h-4 w-4" aria-hidden="true" /> : undefined,
    onSelect: () => onSortChange(id),
  }));
  const pinnedCount = worlds.reduce((count, item) => (isFollowed(item.id) ? count + 1 : count), 0);
  const showFollowedGroup = pinnedCount > 0 && pinnedCount < worlds.length;

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
          <p className="truncate text-[11px] text-[color:var(--nimi-text-muted)]">
            {t('World.atlas.worldCount', { value: formatNum(totalCount) })}
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
          placeholder={t('World.searchPlaceholder')}
          aria-label={t('World.searchPlaceholder')}
          className="min-h-8 flex-1"
          inputClassName="text-xs"
        />
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              data-testid="world-rail-sort-menu"
              icon={<ListFilter className="h-3.5 w-3.5" aria-hidden="true" />}
              tone="ghost"
              size="sm"
              aria-label={t('World.toolbar.sortLabel')}
              title={`${t('World.toolbar.sortLabel')} · ${t(SORT_LABEL_KEYS[menuSort])}`}
              className="h-8 w-8 shrink-0"
            />
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="p-1">
            <ActionMenu items={sortMenuItems} ariaLabel={t('World.toolbar.sortLabel')} />
          </PopoverContent>
        </Popover>
      </div>

      <div
        data-world-rail-list
        className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-2 pb-2 lg:flex-col lg:gap-0 lg:overflow-x-hidden lg:overflow-y-auto"
      >
        {worlds.length === 0 ? (
          <EmptyState className="m-2 lg:mx-1" title={listEmptyLabel} />
        ) : (
          <div className="flex gap-2 lg:flex-col lg:gap-0.5">
            {showFollowedGroup ? (
              <div className="hidden px-2 pb-1 text-[11px] font-medium text-[color:var(--nimi-text-muted)] lg:block">
                {t('World.atlas.category.followed')}
              </div>
            ) : null}
            {worlds.map((world, index) => (
              <Fragment key={world.id}>
                {showFollowedGroup && index === pinnedCount ? (
                  <div
                    aria-hidden="true"
                    className="mx-2 my-1 hidden border-t border-[color:var(--nimi-border-subtle)] lg:block"
                  />
                ) : null}
                {renderRow(world, index)}
              </Fragment>
            ))}
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
  const { t, i18n } = useTranslation();
  const eraTag = displayTags(world, 1, i18n.language)[0] ?? null;
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
          {eraTag ? (
            <span className="block truncate text-[11px] leading-4 text-[color:var(--nimi-text-muted)]">{eraTag}</span>
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
