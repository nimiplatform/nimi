import { prefetchWorldDetailAndHistory } from './world-detail-queries';
import { prefetchWorldDetailPanel } from './world-detail-route-state';
import { formatNum } from './world-list-atoms';
import { displayTags, GLASS_CARD_CLASS, GLASS_CARD_STYLE, sourceCount, statusLabel, worldHeroBackground } from './world-list-catalog-model';
import { IconArrow, IconSpark } from './world-list-catalog-primitives';
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
  const banner = world.bannerUrl;
  const tags = displayTags(world, 2);
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      onMouseEnter={() => {
        prefetchWorldDetailPanel();
        prefetchWorldDetailAndHistory(world.id);
      }}
      style={{
        position: 'relative',
        minHeight: 154,
        borderRadius: 14,
        overflow: 'hidden',
        cursor: 'pointer',
        outline: selected ? '2px solid rgba(76,125,245,0.38)' : '1px solid rgba(255,255,255,0.28)',
        outlineOffset: 0,
        background: worldHeroBackground(banner),
        boxShadow: '0 18px 34px rgba(39,55,94,0.14)',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(15,23,42,0.12), rgba(15,23,42,0.05) 44%, rgba(15,23,42,0.26))' }} />
      <div
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 14,
          display: 'grid',
          gap: 8,
          color: '#ffffff',
        }}
      >
        <div style={{ minWidth: 0, paddingRight: 50 }}>
          <h3
            title={world.name}
            style={{
              margin: 0,
              minWidth: 0,
              maxWidth: '100%',
              fontSize: 17,
              fontWeight: 900,
              letterSpacing: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {world.name}
          </h3>
        </div>
        <button
          type="button"
          aria-label={`Open ${world.name}`}
          data-testid="world-atlas-featured-card-action"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 38,
            height: 38,
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.30)',
            background: 'rgba(255,255,255,0.72)',
            color: '#25334a',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <IconArrow />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: '#45d0aa' }} />
          <span>{statusLabel(world)}</span>
          <span>{formatNum(sourceCount(world))} sources</span>
        </div>
        {tags.length > 0 ? (
          <div style={{ display: 'flex', gap: 6, minWidth: 0, overflow: 'hidden' }}>
            {tags.map((tag, index) => (
              <span
                key={tag}
                title={tag}
                style={{
                  minWidth: 0,
                  maxWidth: index === 0 ? 'none' : '100%',
                  flex: index === 0 ? '0 0 auto' : '1 1 auto',
                  borderRadius: 999,
                  padding: '4px 9px',
                  background: 'rgba(255,255,255,0.28)',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 800,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
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
    <section
      className={GLASS_CARD_CLASS}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
      data-testid="world-atlas-featured-strip"
      style={{
        ...GLASS_CARD_STYLE,
        display: 'grid',
        gridTemplateColumns: '150px minmax(0, 1fr)',
        gap: 16,
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#111827', fontSize: 15, fontWeight: 900 }}>
          <span style={{ color: '#4c7df5', display: 'inline-grid', placeItems: 'center' }}><IconSpark /></span>
          Featured
        </div>
        <p style={{ margin: 0, color: '#526277', fontSize: 13, lineHeight: 1.45, fontWeight: 600 }}>
          Handpicked public worlds for source discovery and setting context.
        </p>
        <button
          type="button"
          style={{
            alignSelf: 'flex-start',
            border: 0,
            background: 'transparent',
            color: '#2563ff',
            fontSize: 12,
            fontWeight: 900,
            padding: 0,
            cursor: 'pointer',
          }}
        >
          View all
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
        }}
      >
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
      <div style={{ gridColumn: '2 / 3', display: 'flex', justifyContent: 'center', gap: 7, marginTop: -4 }}>
        {featured.map((world) => (
          <span
            key={world.id}
            style={{
              width: world.id === selectedWorldId ? 20 : 8,
              height: 4,
              borderRadius: 999,
              background: world.id === selectedWorldId ? '#4c7df5' : 'rgba(76,125,245,0.18)',
            }}
          />
        ))}
      </div>
    </section>
  );
}
