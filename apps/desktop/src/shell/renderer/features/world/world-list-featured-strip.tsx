import { useTranslation } from 'react-i18next';
import { NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { displayTags } from './world-list-catalog-model';
import { WorldCover } from './world-list-cover';
import { WORLD_EXPLORER_SHADOWS, WORLD_EXPLORER_THEME } from './world-list-theme';
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
  const { i18n } = useTranslation();
  const tags = displayTags(world, 2, i18n.language);
  return (
    <Surface
      as="article"
      tone="card"
      material="solid"
      elevation="base"
      padding="none"
      className={[
        'relative min-h-[182px] min-w-0 max-w-full overflow-hidden rounded-[18px] transition duration-200 hover:-translate-y-0.5',
        selected ? 'ring-2 ring-[var(--world-explorer-brand)] ring-offset-0' : '',
      ].join(' ')}
      data-testid="world-atlas-featured-card"
      style={{
        ...WORLD_EXPLORER_THEME.card,
        boxShadow: selected ? WORLD_EXPLORER_SHADOWS.selected : WORLD_EXPLORER_SHADOWS.card,
      }}
    >
      <WorldCover world={world} variant="featured" />
      <button
        type="button"
        aria-pressed={selected}
        className="absolute inset-0 min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left"
        onClick={onSelect}
        onDoubleClick={onOpen}
      >
        <span className="absolute inset-0" style={WORLD_EXPLORER_THEME.featuredOverlay} />
        <span className="absolute right-4 bottom-4 left-4 grid gap-2 text-white">
          <NimiText
            as="span"
            role="card-title"
            className="block max-w-full truncate text-[length:var(--nimi-type-section-title-size)] font-bold text-current"
            title={world.name}
          >
            {world.name}
          </NimiText>
          {tags.length > 0 ? (
            <span className="flex min-w-0 gap-1.5 overflow-hidden">
              {tags.map((tag) => (
                <StatusBadge key={tag} title={tag} tone="neutral" shape="soft" className="min-w-0 max-w-full truncate bg-white/25 text-current">
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
  const featured = worlds.slice(0, 3);
  if (featured.length === 0) {
    return null;
  }
  return (
    <div
      data-testid="world-atlas-featured-strip"
      className="grid min-w-0 max-w-full"
      style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}
    >
      <div className="grid min-w-0 max-w-full grid-cols-1 gap-4 min-[860px]:[grid-template-columns:repeat(3,minmax(0,1fr))]">
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
      <div className="flex justify-center gap-2">
        {featured.map((world) => (
          <span
            key={world.id}
            className={world.id === selectedWorldId
              ? 'h-1 w-5 rounded-full bg-[var(--world-explorer-brand)]'
              : 'h-1 w-2 rounded-full bg-[var(--world-explorer-brand-soft)]'}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}
