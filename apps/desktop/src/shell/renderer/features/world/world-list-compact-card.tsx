import { Heart, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { displayTags, type ViewMode } from './world-list-catalog-model';
import { WorldCover } from './world-list-cover';
import { WORLD_EXPLORER_SHADOWS, WORLD_EXPLORER_THEME } from './world-list-theme';
import type { WorldListItem } from './world-list-model';

export function CompactWorldCard({
  world,
  selected,
  view,
  onSelect,
  onOpen,
  followed = false,
  followAvailable = false,
  onToggleFollow,
}: {
  world: WorldListItem;
  selected: boolean;
  view: ViewMode;
  onSelect: () => void;
  onOpen: () => void;
  followed?: boolean;
  followAvailable?: boolean;
  onToggleFollow?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tags = displayTags(world, 3, i18n.language);
  const listMode = view === 'list';
  return (
    <Surface
      as="article"
      tone="card"
      material="solid"
      elevation="base"
      padding="sm"
      className={[
        'relative min-h-[96px] rounded-[20px] transition duration-200 hover:-translate-y-0.5',
        selected ? 'world-card--selected' : '',
      ].join(' ')}
      style={{
        ...(selected ? WORLD_EXPLORER_THEME.selectedCard : WORLD_EXPLORER_THEME.card),
        boxShadow: selected ? WORLD_EXPLORER_SHADOWS.selected : WORLD_EXPLORER_SHADOWS.card,
      }}
    >
      {onToggleFollow ? (
        <IconButton
          type="button"
          data-testid="world-card-follow-toggle"
          aria-label={followed ? t('World.atlas.followed.unfollow') : t('World.atlas.followed.follow')}
          aria-pressed={followed}
          title={followAvailable ? undefined : t('World.atlas.followed.unavailable')}
          disabled={!followAvailable}
          icon={<Heart size={15} fill={followed ? 'currentColor' : 'none'} aria-hidden="true" />}
          tone="ghost"
          size="sm"
          className={followed
            ? 'absolute top-2.5 right-2.5 z-10 rounded-full text-[var(--world-explorer-favorite)] hover:bg-[var(--world-explorer-surface-weak)]'
            : 'absolute top-2.5 right-2.5 z-10 rounded-full text-[var(--world-explorer-text-muted)] hover:bg-[var(--world-explorer-surface-weak)]'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFollow();
          }}
        />
      ) : null}
      <button
        type="button"
        aria-pressed={selected}
        className="grid w-full min-w-0 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 pr-8 text-left"
        style={{ gridTemplateColumns: listMode ? '86px minmax(0,1fr)' : '86px minmax(0,1fr)' }}
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <WorldCover world={world} variant="thumb" className={listMode ? 'h-[72px]' : ''} />
        <span className="grid min-w-0 gap-1.5">
          <NimiText as="span" role="card-title" className="truncate text-[15px] font-bold text-[var(--world-explorer-text)]" title={world.name}>
            {world.name}
          </NimiText>
          {tags.length > 0 ? (
            <span className="flex min-w-0 flex-wrap gap-1.5 overflow-hidden">
              {tags.map((tag) => (
                <StatusBadge key={tag} title={tag} tone="neutral" shape="outline" className="h-[20px] min-w-0 max-w-full justify-center border-[var(--world-explorer-border)] bg-[var(--world-explorer-surface-weak)] px-2 text-[length:var(--nimi-type-caption-size)] text-[var(--world-explorer-text-secondary)]">
                  {tag}
                </StatusBadge>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      <IconButton
        type="button"
        aria-label={t('World.card.view')}
        icon={<MoreHorizontal size={17} aria-hidden="true" />}
        tone="ghost"
        size="sm"
        className="absolute right-2.5 bottom-2.5 rounded-full text-[var(--world-explorer-text-muted)] hover:bg-[var(--world-explorer-surface-weak)] hover:text-[var(--world-explorer-text)]"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      />
    </Surface>
  );
}
