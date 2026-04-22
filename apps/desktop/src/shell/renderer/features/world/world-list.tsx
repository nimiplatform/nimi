import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  fetchWorldListItems,
  prefetchWorldDetailAndHistory,
  worldListQueryKey,
} from './world-detail-queries';
import { prefetchWorldDetailPanel } from './world-detail-route-state';
import { isMainWorld, toWorldListItemFromTruth, type WorldListItem } from './world-list-model';
import { WorldChronoPanel } from './world-list-chrono-panel';
import { Chip, Kicker, Pulse, Seal, Stat, StatusDot, formatNum, pulseFromId, sealGradientFor } from './world-list-atoms';

type FilterId = 'all' | 'main' | 'sub' | 'archived';
type SortId = 'active' | 'recent' | 'alpha' | 'inhabitants';
type ViewMode = 'grid' | 'list';

const FROZEN_STATUS = 'FROZEN';

function isArchived(world: WorldListItem): boolean {
  return world.status === FROZEN_STATUS || Boolean(world.freezeReason);
}

function initialLetter(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '•';
  const codePoint = trimmed.codePointAt(0);
  return codePoint ? String.fromCodePoint(codePoint).toUpperCase() : '•';
}

function sortWorlds(list: WorldListItem[], sort: SortId): WorldListItem[] {
  const arr = [...list];
  if (sort === 'active') {
    arr.sort((a, b) => (b.scoreEwma ?? 0) - (a.scoreEwma ?? 0));
  } else if (sort === 'recent') {
    arr.sort((a, b) => {
      const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return tb - ta;
    });
  } else if (sort === 'alpha') {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'inhabitants') {
    arr.sort((a, b) => b.agentCount - a.agentCount);
  }
  return arr;
}

function matchesQuery(world: WorldListItem, q: string): boolean {
  if (!q) return true;
  const haystack = [
    world.name,
    world.description ?? '',
    world.tagline ?? '',
    world.genre ?? '',
    world.era ?? '',
    ...world.themes,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function applyFilter(list: WorldListItem[], filter: FilterId): WorldListItem[] {
  if (filter === 'main') return list.filter((w) => isMainWorld(w));
  if (filter === 'sub') return list.filter((w) => !isMainWorld(w));
  if (filter === 'archived') return list.filter((w) => isArchived(w));
  return list;
}

function worldTagline(world: WorldListItem): string {
  return world.tagline || world.motto || world.description || '';
}

function worldTags(world: WorldListItem): string[] {
  const out: string[] = [];
  if (world.genre) out.push(world.genre);
  if (world.era) out.push(world.era);
  for (const theme of world.themes) {
    if (!out.includes(theme)) out.push(theme);
  }
  return out;
}

function CoverBand({
  world,
  height,
  fadeStop,
}: {
  world: WorldListItem;
  height: number;
  fadeStop: number;
}) {
  if (!world.bannerUrl) return null;
  const backgroundStyle: CSSProperties = {
    position: 'relative',
    height,
    overflow: 'hidden',
    background: `linear-gradient(135deg, rgba(15,23,42,0.25), rgba(15,23,42,0.15)), url(${world.bannerUrl}) center/cover no-repeat`,
  };
  return (
    <div style={backgroundStyle}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, transparent 0%, transparent ${fadeStop}%, rgba(255,255,255,0.88) 100%)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

function FeaturedWorldCard({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 6);
  const tagline = worldTagline(world);

  return (
    <section
      className="nimi-material-glass-thick"
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--nimi-radius-xl)',
        border: '1px solid var(--nimi-material-glass-thick-border)',
        background: 'var(--nimi-material-glass-thick-bg)',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-strong))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-strong))',
        boxShadow: 'var(--nimi-elevation-raised)',
      }}
      data-nimi-material="glass-thick"
      data-nimi-tone="card"
    >
      <CoverBand world={world} height={180} fadeStop={40} />

      <div style={{ padding: 24, position: 'relative' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 28,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', minWidth: 0 }}>
            <Seal
              letter={initialLetter(world.name)}
              gradient={sealGradientFor(world.id)}
              imageUrl={world.iconUrl}
              size={68}
              radius={16}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 6,
                  flexWrap: 'wrap',
                }}
              >
                <h1
                  style={{
                    margin: 0,
                    fontFamily: 'var(--nimi-font-display)',
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    color: 'var(--nimi-text-primary)',
                  }}
                >
                  {world.name}
                </h1>
                <StatusDot
                  active={world.status !== FROZEN_STATUS}
                  activeLabel={t('World.status.active')}
                  idleLabel={t('World.status.idle')}
                />
                <Chip>{world.nativeCreationState}</Chip>
              </div>
              {tagline ? (
                <p
                  style={{
                    margin: '4px 0 12px',
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: 'var(--nimi-text-secondary)',
                    maxWidth: 560,
                  }}
                >
                  {tagline}
                </p>
              ) : null}
              {tags.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tags.map((tag) => (
                    <Chip key={tag}>{tag}</Chip>
                  ))}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={onOpen}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 16px',
                    borderRadius: 10,
                    border: '1px solid var(--nimi-action-primary-bg)',
                    background: 'var(--nimi-action-primary-bg)',
                    color: 'var(--nimi-action-primary-text)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 160ms, box-shadow 160ms',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'var(--nimi-action-primary-bg-hover)';
                    event.currentTarget.style.borderColor = 'var(--nimi-action-primary-bg-hover)';
                    event.currentTarget.style.boxShadow = 'var(--nimi-elevation-raised)';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'var(--nimi-action-primary-bg)';
                    event.currentTarget.style.borderColor = 'var(--nimi-action-primary-bg)';
                    event.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                  </svg>
                  {t('World.card.enter')}
                </button>
              </div>
            </div>
          </div>

          <div
            className="nimi-world-featured-chrono"
            style={{ minWidth: 260, maxWidth: 340 }}
          >
            <WorldChronoPanel world={world} />
          </div>
        </div>
      </div>
    </section>
  );
}

function WorldCard({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 3);
  const extraTagCount = Math.max(0, worldTags(world).length - tags.length);
  const pulse = useMemo(() => pulseFromId(world.id), [world.id]);
  const tagline = worldTagline(world);
  const hasCover = Boolean(world.bannerUrl);

  return (
    <article
      className="nimi-material-glass-regular"
      onClick={onOpen}
      onMouseEnter={(event) => {
        prefetchWorldDetailPanel();
        prefetchWorldDetailAndHistory(world.id);
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-raised)';
        event.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-base)';
        event.currentTarget.style.transform = 'translateY(0)';
      }}
      style={{
        padding: 0,
        cursor: 'pointer',
        transition: 'transform 200ms, box-shadow 200ms',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 244,
        background: 'var(--nimi-material-glass-regular-bg)',
        border: '1px solid var(--nimi-material-glass-regular-border)',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
    >
      <CoverBand world={world} height={72} fadeStop={40} />

      <div
        style={{
          padding: 16,
          paddingTop: hasCover ? 0 : 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            marginTop: hasCover ? -22 : 0,
          }}
        >
          <Seal
            letter={initialLetter(world.name)}
            gradient={sealGradientFor(world.id)}
            imageUrl={world.iconUrl}
            size={44}
            radius={12}
          />
          <div style={{ flex: 1, minWidth: 0, paddingTop: hasCover ? 22 : 0 }}>
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--nimi-font-display)',
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: 'var(--nimi-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 3,
              }}
              title={world.name}
            >
              {world.name}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot
                active={world.status !== FROZEN_STATUS}
                activeLabel={t('World.status.active')}
                idleLabel={t('World.status.idle')}
              />
              <span
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 999,
                  background: 'rgba(148,163,184,0.6)',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--nimi-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontWeight: 600,
                }}
              >
                {world.nativeCreationState}
              </span>
            </div>
          </div>
        </div>

        {tagline ? (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--nimi-text-secondary)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {tagline}
          </p>
        ) : null}

        {(tags.length > 0 || extraTagCount > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
            {extraTagCount > 0 ? <Chip muted>+{extraTagCount}</Chip> : null}
          </div>
        )}

        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 12,
            borderTop: '1px solid var(--nimi-border-subtle)',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 16 }}>
            <Stat label={t('World.stats.online')} value={formatNum(world.agentCount)} valueSize={13} />
            <Stat label={t('World.stats.day')} value={String(world.level)} valueSize={13} />
            <Stat
              label={t('World.stats.flow')}
              value={`${world.computed.time.flowRatio.toFixed(2)}×`}
              valueSize={13}
            />
          </div>
          <Pulse data={pulse} width={84} height={24} gradientId={`pulse-${world.id}`} />
        </div>
      </div>
    </article>
  );
}

function WorldListRow({ world, onOpen }: { world: WorldListItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const tags = worldTags(world).slice(0, 2);
  const pulse = useMemo(() => pulseFromId(world.id), [world.id]);

  return (
    <article
      className="nimi-material-glass-regular"
      onClick={onOpen}
      onMouseEnter={(event) => {
        prefetchWorldDetailPanel();
        prefetchWorldDetailAndHistory(world.id);
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-raised)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.boxShadow = 'var(--nimi-elevation-base)';
      }}
      style={{
        padding: '14px 18px',
        cursor: 'pointer',
        display: 'grid',
        gridTemplateColumns: '44px 1.4fr 1fr 0.8fr 0.8fr 0.8fr 100px 24px',
        gap: 18,
        alignItems: 'center',
        transition: 'box-shadow 160ms',
        background: 'var(--nimi-material-glass-regular-bg)',
        border: '1px solid var(--nimi-material-glass-regular-border)',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
    >
      <Seal
        letter={initialLetter(world.name)}
        gradient={sealGradientFor(world.id)}
        imageUrl={world.iconUrl}
        size={40}
        radius={10}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--nimi-font-display)',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            marginBottom: 2,
            color: 'var(--nimi-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {world.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--nimi-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {worldTagline(world)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', overflow: 'hidden' }}>
        {tags.map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>
      <Stat label={t('World.stats.online')} value={formatNum(world.agentCount)} valueSize={13} />
      <Stat label={t('World.stats.day')} value={String(world.level)} valueSize={13} />
      <Stat
        label={t('World.stats.flow')}
        value={`${world.computed.time.flowRatio.toFixed(2)}×`}
        valueSize={13}
      />
      <Pulse data={pulse} width={92} height={26} gradientId={`pulse-row-${world.id}`} />
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--nimi-text-muted)' }}
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </article>
  );
}

function ToolBar({
  view,
  setView,
  sort,
  setSort,
  query,
  setQuery,
  count,
}: {
  view: ViewMode;
  setView: (view: ViewMode) => void;
  sort: SortId;
  setSort: (sort: SortId) => void;
  query: string;
  setQuery: (query: string) => void;
  count: number;
}) {
  const { t } = useTranslation();
  const toggleBtnStyle = (active: boolean): CSSProperties => ({
    padding: '5px 8px',
    border: 0,
    background: active ? 'var(--nimi-surface-card)' : 'transparent',
    borderRadius: 8,
    color: active ? 'var(--nimi-text-primary)' : 'var(--nimi-text-muted)',
    boxShadow: active ? 'var(--nimi-elevation-base)' : 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
  });
  return (
    <div
      className="nimi-material-glass-regular"
      style={{
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--nimi-material-glass-regular-bg)',
        border: '1px solid var(--nimi-material-glass-regular-border)',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
      data-nimi-material="glass-regular"
      data-nimi-tone="card"
    >
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--nimi-font-display)',
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: 'var(--nimi-text-primary)',
        }}
      >
        {t('World.toolbar.heading')}
      </h2>
      <Chip
        style={{
          fontFamily: 'var(--nimi-font-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </Chip>
      <div style={{ flex: 1 }} />
      <div style={{ position: 'relative', width: 220 }}>
        <svg
          width={13}
          height={13}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ position: 'absolute', left: 10, top: 9, color: 'var(--nimi-text-muted)' }}
          aria-hidden="true"
        >
          <circle cx={11} cy={11} r={7} />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          placeholder={t('World.toolbar.filterPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{
            paddingLeft: 30,
            height: 32,
            fontSize: 12,
            width: '100%',
            borderRadius: 10,
            border: '1px solid var(--nimi-border-subtle)',
            background: 'rgba(255,255,255,0.7)',
            color: 'var(--nimi-text-primary)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <select
        value={sort}
        onChange={(event) => setSort(event.target.value as SortId)}
        style={{
          height: 32,
          fontSize: 12,
          padding: '4px 10px',
          borderRadius: 10,
          border: '1px solid var(--nimi-border-subtle)',
          background: 'rgba(255,255,255,0.7)',
          color: 'var(--nimi-text-primary)',
          outline: 'none',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <option value="active">{t('World.toolbar.sort.active')}</option>
        <option value="recent">{t('World.toolbar.sort.recent')}</option>
        <option value="alpha">{t('World.toolbar.sort.alpha')}</option>
        <option value="inhabitants">{t('World.toolbar.sort.inhabitants')}</option>
      </select>
      <div
        style={{
          display: 'flex',
          padding: 2,
          background: 'rgba(148,163,184,0.12)',
          borderRadius: 10,
          gap: 2,
        }}
      >
        <button
          type="button"
          onClick={() => setView('grid')}
          title={t('World.toolbar.gridView')}
          aria-label={t('World.toolbar.gridView')}
          aria-pressed={view === 'grid'}
          style={toggleBtnStyle(view === 'grid')}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setView('list')}
          title={t('World.toolbar.listView')}
          aria-label={t('World.toolbar.listView')}
          aria-pressed={view === 'list'}
          style={toggleBtnStyle(view === 'list')}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </button>
      </div>
    </div>
  );
}

type CollectionEntry = { id: string; label: string; count: number; hue: string };

const COLLECTION_HUES = ['#ec4899', '#06b6d4', '#8b5cf6', '#4ECCA3', '#f59e0b', '#0ea5e9'];

function buildCollections(worlds: WorldListItem[]): CollectionEntry[] {
  const map = new Map<string, number>();
  for (const world of worlds) {
    if (world.genre) {
      map.set(world.genre, (map.get(world.genre) ?? 0) + 1);
    }
  }
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return entries.map(([label, count], index) => ({
    id: label,
    label,
    count,
    hue: COLLECTION_HUES[index % COLLECTION_HUES.length] ?? COLLECTION_HUES[0]!,
  }));
}

function Sidebar({
  worlds,
  filter,
  setFilter,
  counts,
}: {
  worlds: WorldListItem[];
  filter: FilterId;
  setFilter: (filter: FilterId) => void;
  counts: Record<FilterId, number>;
}) {
  const { t } = useTranslation();
  const collections = useMemo(() => buildCollections(worlds), [worlds]);
  const totalAgents = useMemo(() => worlds.reduce((sum, world) => sum + world.agentCount, 0), [worlds]);
  const activeCount = useMemo(() => worlds.filter((world) => !isArchived(world)).length, [worlds]);

  const filters: { id: FilterId; label: string; count: number }[] = [
    { id: 'all', label: t('World.sidebar.filters.all'), count: counts.all },
    { id: 'main', label: t('World.sidebar.filters.main'), count: counts.main },
    { id: 'sub', label: t('World.sidebar.filters.sub'), count: counts.sub },
    { id: 'archived', label: t('World.sidebar.filters.archived'), count: counts.archived },
  ];

  const panelStyle: CSSProperties = {
    background: 'var(--nimi-material-glass-regular-bg)',
    border: '1px solid var(--nimi-material-glass-regular-border)',
    backdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
    WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
    borderRadius: 'var(--nimi-radius-lg)',
    boxShadow: 'var(--nimi-elevation-base)',
    padding: 8,
  };

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        position: 'sticky',
        top: 16,
        alignSelf: 'start',
      }}
    >
      <button
        type="button"
        disabled
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: '100%',
          height: 40,
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 10,
          border: '1px solid var(--nimi-action-primary-bg)',
          background: 'var(--nimi-action-primary-bg)',
          color: 'var(--nimi-action-primary-text)',
          cursor: 'not-allowed',
          opacity: 0.7,
        }}
        title={t('World.sidebar.create')}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {t('World.sidebar.create')}
      </button>

      <nav className="nimi-material-glass-regular" style={panelStyle} data-nimi-material="glass-regular">
        <Kicker style={{ padding: '8px 10px 6px' }}>{t('World.sidebar.library')}</Kicker>
        {filters.map((entry) => {
          const active = filter === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '7px 10px',
                border: 0,
                textAlign: 'left',
                background: active ? 'var(--nimi-surface-active)' : 'transparent',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--nimi-text-primary)' : 'var(--nimi-text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span>{entry.label}</span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--nimi-text-muted)',
                  fontFamily: 'var(--nimi-font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {entry.count}
              </span>
            </button>
          );
        })}
      </nav>

      <nav className="nimi-material-glass-regular" style={panelStyle} data-nimi-material="glass-regular">
        <Kicker style={{ padding: '8px 10px 6px' }}>{t('World.sidebar.collections')}</Kicker>
        {collections.length === 0 ? (
          <div style={{ padding: '7px 10px', fontSize: 12, color: 'var(--nimi-text-muted)' }}>
            {t('World.sidebar.noCollections')}
          </div>
        ) : (
          collections.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--nimi-text-secondary)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: entry.hue,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.label}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--nimi-text-muted)',
                  fontFamily: 'var(--nimi-font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {entry.count}
              </span>
            </div>
          ))
        )}
      </nav>

      <div
        className="nimi-material-glass-regular"
        style={{ ...panelStyle, padding: 16 }}
        data-nimi-material="glass-regular"
      >
        <Kicker style={{ marginBottom: 10 }}>{t('World.sidebar.pulse')}</Kicker>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Stat
            label={t('World.sidebar.activeWorlds')}
            value={String(activeCount)}
            sub={t('World.sidebar.activeWorldsSub', { total: worlds.length })}
          />
          <div style={{ height: 1, background: 'var(--nimi-border-subtle)' }} />
          <Stat
            label={t('World.sidebar.inhabitants')}
            value={formatNum(totalAgents)}
            sub={t('World.sidebar.inhabitantsSub')}
          />
        </div>
      </div>
    </aside>
  );
}

function WorldsLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName="px-6 py-6">
        <div className="mx-auto max-w-[1240px] space-y-6">
          <div className="space-y-2">
            <div className="h-3 w-32 animate-pulse rounded bg-white/60" />
            <div className="h-7 w-40 animate-pulse rounded-lg bg-white/70" />
            <div className="h-4 w-80 animate-pulse rounded bg-white/50" />
          </div>
          <div className="h-48 animate-pulse rounded-3xl bg-white/60" />
          <div className="h-11 animate-pulse rounded-2xl bg-white/60" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-60 animate-pulse rounded-2xl bg-white/60" />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export function WorldList() {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [sort, setSort] = useState<SortId>('active');
  const [view, setView] = useState<ViewMode>('grid');

  const openWorldDetail = (worldId: string) => {
    prefetchWorldDetailPanel();
    prefetchWorldDetailAndHistory(worldId);
    navigateToWorld(worldId);
  };

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => (await fetchWorldListItems()).map((item) => toWorldListItemFromTruth(item)),
  });

  if (worldsQuery.isPending) {
    return <WorldsLoadingSkeleton />;
  }

  if (worldsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-red-600">{t('World.loadError')}</span>
      </div>
    );
  }

  const worlds = worldsQuery.data ?? [];
  const mainWorld = worlds.find((world) => isMainWorld(world));
  const counts: Record<FilterId, number> = {
    all: worlds.length,
    main: worlds.filter((world) => isMainWorld(world)).length,
    sub: worlds.filter((world) => !isMainWorld(world)).length,
    archived: worlds.filter((world) => isArchived(world)).length,
  };

  const showFeaturedHero = filter === 'all' && !query && Boolean(mainWorld);
  const filteredBase = applyFilter(worlds, filter);
  const withoutHero = showFeaturedHero && mainWorld
    ? filteredBase.filter((world) => world.id !== mainWorld.id)
    : filteredBase;
  const searched = withoutHero.filter((world) => matchesQuery(world, query));
  const sorted = sortWorlds(searched, sort);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea className="flex-1" contentClassName="px-6 pb-10 pt-6">
        <div
          className="mx-auto grid w-full max-w-[1240px] gap-6"
          style={{ gridTemplateColumns: 'minmax(0, 1fr) 260px' }}
        >
          <div className="flex min-w-0 flex-col gap-6">
            <div className="px-0.5">
              <Kicker style={{ marginBottom: 4 }}>{t('World.header.kicker')}</Kicker>
              <h1
                style={{
                  margin: 0,
                  fontFamily: 'var(--nimi-font-display)',
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--nimi-text-primary)',
                }}
              >
                {t('World.title')}
              </h1>
            </div>

            {showFeaturedHero && mainWorld ? (
              <FeaturedWorldCard world={mainWorld} onOpen={() => openWorldDetail(mainWorld.id)} />
            ) : null}

            <ToolBar
              view={view}
              setView={setView}
              sort={sort}
              setSort={setSort}
              query={query}
              setQuery={setQuery}
              count={sorted.length}
            />

            {sorted.length === 0 ? (
              <div
                className="nimi-material-glass-regular"
                style={{
                  padding: 48,
                  textAlign: 'center',
                  color: 'var(--nimi-text-muted)',
                  fontSize: 13,
                  background: 'var(--nimi-material-glass-regular-bg)',
                  border: '1px solid var(--nimi-material-glass-regular-border)',
                  backdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
                  WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-regular))',
                  borderRadius: 'var(--nimi-radius-lg)',
                }}
              >
                {query ? t('World.noSearchResults') : t('World.card.noMatch')}
              </div>
            ) : view === 'grid' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 16,
                }}
              >
                {sorted.map((world) => (
                  <WorldCard key={world.id} world={world} onOpen={() => openWorldDetail(world.id)} />
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sorted.map((world) => (
                  <WorldListRow key={world.id} world={world} onOpen={() => openWorldDetail(world.id)} />
                ))}
              </div>
            )}
          </div>

          <Sidebar worlds={worlds} filter={filter} setFilter={setFilter} counts={counts} />
        </div>
      </ScrollArea>
    </div>
  );
}
