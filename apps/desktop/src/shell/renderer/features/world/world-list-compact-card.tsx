import { Heart, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, IconButton, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { formatNum, worldInitial } from './world-list-atoms';
import { displayTags, sourceCount, statusLabel, type ViewMode } from './world-list-catalog-model';
import type { WorldListItem } from './world-list-model';

const COMPACT_WORLD_TAG_LABELS: Record<string, string | null> = {
  Historical: 'Historical',
  'Scholarly sources': null,
  历史世界: '历史',
  学术资料: null,
};

function isChineseWorldTagLanguage(language?: string): boolean {
  return language?.toLocaleLowerCase().startsWith('zh') ?? false;
}

function compactWorldTagLabel(tag: string, world: WorldListItem, language?: string): string | null {
  if (world.era && tag === world.era) {
    return isChineseWorldTagLanguage(language) ? '朝代' : 'Era';
  }
  if (Object.prototype.hasOwnProperty.call(COMPACT_WORLD_TAG_LABELS, tag)) {
    return COMPACT_WORLD_TAG_LABELS[tag] ?? null;
  }
  return tag;
}

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
      material="glass-regular"
      elevation="base"
      padding="sm"
      className={[
        'relative min-h-[88px] rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-material-glass-regular-bg)] shadow-none',
        selected ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]' : 'border-transparent',
      ].join(' ')}
      style={{ boxShadow: 'none' }}
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
          className={followed ? 'absolute top-2 right-2 z-10 text-[var(--nimi-status-danger-soft-text)]' : 'absolute top-2 right-2 z-10 text-[var(--nimi-text-muted)]'}
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
        style={{ gridTemplateColumns: listMode ? '72px minmax(0,1fr)' : '78px minmax(0,1fr)' }}
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <Avatar
          alt={world.name}
          src={world.bannerUrl}
          shape="rounded"
          size="lg"
          fallback={worldInitial(world.name)}
          fallbackClassName="bg-[image:var(--nimi-surface-hero)] text-[var(--nimi-action-primary-text)] text-2xl font-bold"
          className={listMode ? 'h-[68px] w-[72px]' : 'h-[68px] w-[78px]'}
        />
        <span className="grid min-w-0 gap-1.5">
          <NimiText as="span" role="card-title" className="truncate" title={world.name}>
            {world.name}
          </NimiText>
          <span className="flex min-w-0 items-center gap-2">
            <StatusBadge tone={world.status === 'FROZEN' ? 'warning' : 'success'} shape="dot" className="px-0 bg-transparent font-bold">
              {statusLabel(world)}
            </StatusBadge>
            <NimiText as="span" role="caption">{formatNum(sourceCount(world))}</NimiText>
          </span>
          <span className="flex min-w-0 flex-wrap gap-1.5 overflow-hidden">
            {tags.map((tag) => {
              const label = compactWorldTagLabel(tag, world, i18n.language);
              if (!label) {
                return null;
              }
              return (
                <StatusBadge key={tag} title={tag} tone="neutral" shape="outline" className="h-[18px] min-w-0 max-w-full justify-center border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-1.5 text-[length:var(--nimi-type-caption-size)]">
                  {label}
                </StatusBadge>
              );
            })}
          </span>
        </span>
      </button>
      <IconButton
        type="button"
        aria-label={t('World.card.view')}
        icon={<MoreHorizontal size={17} aria-hidden="true" />}
        tone="ghost"
        size="sm"
        className="absolute right-2 bottom-2"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      />
    </Surface>
  );
}
