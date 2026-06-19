import { prefetchWorldDetailAndHistory } from './world-detail-queries';
import { prefetchWorldDetailPanel } from './world-detail-route-state';
import { formatNum, worldInitial } from './world-list-atoms';
import { displayTags, GLASS_CARD_CLASS, GLASS_CARD_STYLE, sourceCount, statusLabel, worldThumbBackground, type ViewMode } from './world-list-catalog-model';
import type { WorldListItem } from './world-list-model';

export function CompactWorldCard({
  world,
  selected,
  view,
  onSelect,
  onOpen,
}: {
  world: WorldListItem;
  selected: boolean;
  view: ViewMode;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const image = world.bannerUrl;
  const tags = displayTags(world, 3);
  const listMode = view === 'list';
  return (
    <article
      className={GLASS_CARD_CLASS}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
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
        ...GLASS_CARD_STYLE,
        minHeight: listMode ? 88 : 88,
        borderRadius: 16,
        padding: 10,
        display: 'grid',
        gridTemplateColumns: listMode ? '72px minmax(0,1fr) auto' : '78px minmax(0,1fr) 20px',
        gap: 12,
        alignItems: 'center',
        cursor: 'pointer',
        outline: selected ? '2px solid rgba(76,125,245,0.30)' : '0 solid transparent',
        transition: 'transform 160ms ease, box-shadow 160ms ease',
      }}
    >
      <div
        style={{
          width: listMode ? 72 : 78,
          height: 68,
          borderRadius: 12,
          background: worldThumbBackground(image),
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.36)',
          display: 'grid',
          placeItems: 'center',
          color: '#ffffff',
          fontSize: 24,
          fontWeight: 950,
        }}
      >
        {image ? null : worldInitial(world.name)}
      </div>
      <div style={{ minWidth: 0, display: 'grid', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <h3
            title={world.name}
            style={{
              margin: 0,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: '#152033',
              fontSize: 13,
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            {world.name}
          </h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, color: '#64748b', fontSize: 11, fontWeight: 700 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#19b987' }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#45d0aa' }} />
            {statusLabel(world)}
          </span>
          <span>{formatNum(sourceCount(world))}</span>
        </div>
        <div style={{ display: 'flex', gap: 5, minWidth: 0, overflow: 'hidden' }}>
          {tags.map((tag, index) => (
            <span
              key={tag}
              title={tag}
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 auto',
                border: `1px solid ${index % 2 === 0 ? 'rgba(69,208,170,0.42)' : 'rgba(138,120,255,0.42)'}`,
                color: index % 2 === 0 ? '#1aa37f' : '#7657dc',
                fontSize: 9,
                fontWeight: 900,
                background: 'rgba(255,255,255,0.42)',
              }}
            >
              {tag.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Open ${world.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        style={{
          border: 0,
          background: 'transparent',
          color: '#66758b',
          width: 22,
          height: 28,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
    </article>
  );
}
