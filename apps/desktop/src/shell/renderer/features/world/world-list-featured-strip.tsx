import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { formatNum } from './world-list-atoms';
import { displayTags, sourceCount, statusLabel, worldHeroBackground } from './world-list-catalog-model';
import type { WorldListItem } from './world-list-model';

function FeaturedCard({
  world,
  selected,
  onSelect,
  onOpen,
}: {
  world: WorldListItem;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tags = displayTags(world, 2, i18n.language);
  return (
    <Surface
      as="article"
      tone="card"
      material="solid"
      elevation="base"
      padding="none"
      className={[
        'relative min-h-[154px] overflow-hidden rounded-[var(--nimi-radius-lg)] shadow-none',
        selected ? 'ring-2 ring-[var(--nimi-status-info)] ring-offset-0' : 'border-[var(--nimi-material-glass-thin-border)]',
      ].join(' ')}
      data-testid="world-atlas-featured-card"
      style={{ boxShadow: 'none' }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: worldHeroBackground(world.bannerUrl) }}
      />
      <button
        type="button"
        aria-pressed={selected}
        className="absolute inset-0 cursor-pointer border-0 bg-transparent p-0 text-left"
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <span className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,black_38%,transparent),color-mix(in_srgb,black_12%,transparent)_44%,color-mix(in_srgb,black_50%,transparent))]" />
        <span className="absolute right-4 bottom-3 left-4 grid gap-2 text-white">
          <NimiText
            as="span"
            role="card-title"
            className="block max-w-full truncate text-[length:var(--nimi-type-section-title-size)] font-bold text-current"
            title={world.name}
          >
            {world.name}
          </NimiText>
          <span className="flex min-w-0 items-center gap-2 text-[length:var(--nimi-type-caption-size)] font-bold">
            <StatusBadge tone={world.status === 'FROZEN' ? 'warning' : 'success'} shape="dot" className="bg-transparent px-0 text-current">
              {statusLabel(world)}
            </StatusBadge>
            <span className="truncate">{t('World.atlas.sourceCount', { value: formatNum(sourceCount(world)) })}</span>
          </span>
          {tags.length > 0 ? (
            <span className="flex min-w-0 gap-1.5 overflow-hidden">
              {tags.map((tag) => (
                <StatusBadge key={tag} title={tag} tone="neutral" shape="soft" className="min-w-0 max-w-full truncate bg-white/25 text-current backdrop-blur-[var(--nimi-backdrop-blur-thin)]">
                  {tag}
                </StatusBadge>
              ))}
            </span>
          ) : null}
        </span>
      </button>
    </Surface>
  );
}

export function FeaturedStrip({
  worlds,
  selectedWorldId,
  onSelectWorld,
  onOpenWorld,
}: {
  worlds: WorldListItem[];
  selectedWorldId: string | null;
  onSelectWorld: (worldId: string) => void;
  onOpenWorld: (worldId: string) => void;
}) {
  const { t } = useTranslation();
  const featured = worlds.slice(0, 3);
  if (featured.length === 0) {
    return null;
  }
  return (
    <Surface
      as="section"
      tone="card"
      material="glass-regular"
      elevation="base"
      padding="md"
      data-testid="world-atlas-featured-strip"
      className="grid rounded-[var(--nimi-radius-xl)] border-transparent bg-[var(--nimi-material-glass-regular-bg)] shadow-none"
      style={{ gridTemplateColumns: '112px minmax(0, 1fr)', gap: 12, boxShadow: 'none' }}
    >
      <div className="flex flex-col justify-center gap-2.5">
        <NimiText as="h2" role="card-title" className="flex items-center gap-2">
          <Sparkles size={16} aria-hidden="true" className="text-[var(--nimi-action-primary-bg)]" />
          {t('World.atlas.featured.title')}
        </NimiText>
        <NimiText role="helper" className="font-semibold">
          {t('World.atlas.featured.body')}
        </NimiText>
        <Button tone="ghost" size="sm" className="self-start px-0 text-[var(--nimi-status-info)]">
          {t('World.atlas.featured.viewAll')}
        </Button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(190px, 1fr))', gap: 12 }}>
        {featured.map((world) => (
          <FeaturedCard
            key={world.id}
            world={world}
            selected={world.id === selectedWorldId}
            onSelect={() => onSelectWorld(world.id)}
            onOpen={() => onOpenWorld(world.id)}
          />
        ))}
      </div>
      <div className="col-start-2 flex justify-center gap-2">
        {featured.map((world) => (
          <span
            key={world.id}
            className={world.id === selectedWorldId
              ? 'h-1 w-5 rounded-full bg-[var(--nimi-action-primary-bg)]'
              : 'h-1 w-2 rounded-full bg-[var(--nimi-surface-active)]'}
            aria-hidden="true"
          />
        ))}
      </div>
    </Surface>
  );
}
