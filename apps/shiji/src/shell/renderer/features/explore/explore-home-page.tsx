import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { logRendererEvent } from '@nimiplatform/nimi-kit/telemetry';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { sqliteGetSessionsForLearner } from '@renderer/bridge/sqlite-bridge.js';
import { isValidPair, getClassification } from '@renderer/data/classification.js';
import { getActiveCatalogEntries } from '@renderer/data/world-catalog.js';
import type { WorldCatalogEntry } from '@renderer/data/world-catalog.js';
import { getWorlds } from '@renderer/data/world-client.js';
import { CharacterEncounter, useEncounterShouldShow } from './character-encounter.js';
import { ClassificationBadge } from './components/classification-badge.js';

type WorldListResult = RealmServiceResult<'WorldsService', 'worldControllerListWorlds'>;
type ApiWorld = WorldListResult extends (infer T)[] ? T : never;
type ExploreFilter = 'all' | 'explored' | 'unexplored';

type WorldTimelineNodeProps = {
  catalog: WorldCatalogEntry;
  apiWorld: ApiWorld | undefined;
  hasSession: boolean;
  isSelected: boolean;
  onClick: () => void;
};

function WorldTimelineNode({ catalog, apiWorld, hasSession, isSelected, onClick }: WorldTimelineNodeProps) {
  const classification = getClassification(catalog.contentType, catalog.truthMode);

  return (
    <Link
      to={`/explore/${catalog.worldId}`}
      onClick={onClick}
      className={[
        'flex-none w-48 overflow-hidden rounded-2xl border-2 bg-white transition-all duration-200',
        'flex flex-col',
        isSelected ? 'scale-[1.03] border-amber-500 shadow-lg' : 'border-transparent hover:border-amber-200',
        !hasSession ? 'opacity-80' : '',
      ].join(' ')}
    >
      <div className="relative h-24 overflow-hidden bg-neutral-100">
        {apiWorld?.bannerUrl ? (
          <img
            src={apiWorld.bannerUrl}
            alt={catalog.displayName}
            className={['h-full w-full object-cover', !hasSession ? 'grayscale' : ''].join(' ')}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-100 to-amber-50">
            <span className="text-2xl text-amber-400">史</span>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1">
          <p className="truncate text-xs font-medium text-white">{catalog.eraLabel}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-800">
          {apiWorld?.name ?? catalog.displayName}
        </h3>
        {apiWorld?.tagline ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-neutral-400">{apiWorld.tagline}</p>
        ) : null}
        {classification ? (
          <ClassificationBadge contentType={catalog.contentType} truthMode={catalog.truthMode} />
        ) : null}
        {hasSession ? <span className="mt-auto text-xs font-medium text-amber-600">已探索</span> : null}
      </div>
    </Link>
  );
}

export default function ExploreHomePage() {
  const { t } = useTranslation();
  const activeProfile = useAppStore((state) => state.activeProfile);
  const shouldShowEncounter = useEncounterShouldShow();
  const [encounterDismissed, setEncounterDismissed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<ExploreFilter>('all');
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const showEncounter = shouldShowEncounter && !encounterDismissed;

  const { data: apiWorlds, isLoading, error, refetch } = useQuery({
    queryKey: ['worlds'],
    queryFn: async () => {
      const result = await getWorlds();
      return result as WorldListResult;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: sessions } = useQuery({
    queryKey: ['sessions', activeProfile?.id],
    queryFn: async () => {
      if (!activeProfile) {
        return [];
      }
      return sqliteGetSessionsForLearner(activeProfile.id);
    },
    enabled: !!activeProfile,
  });

  const apiWorldMap = new Map<string, ApiWorld>();
  if (apiWorlds && Array.isArray(apiWorlds)) {
    for (const world of apiWorlds as ApiWorld[]) {
      if (world.id) {
        apiWorldMap.set(world.id, world);
      }
    }
  }

  const exploredWorldIds = new Set<string>();
  if (sessions) {
    for (const session of sessions) {
      exploredWorldIds.add(session.worldId);
    }
  }

  const catalogEntries = getActiveCatalogEntries().filter((entry) => {
    if (!isValidPair(entry.contentType, entry.truthMode)) {
      logRendererEvent({
        level: 'error',
        area: 'shiji-explore',
        message: 'catalog:invalid-classification-pair',
        details: {
          worldId: entry.worldId,
          contentType: entry.contentType,
          truthMode: entry.truthMode,
        },
      });
      return false;
    }
    return true;
  });

  const filteredEntries = catalogEntries.filter((entry) => {
    const apiWorld = apiWorldMap.get(entry.worldId);

    if (searchText.trim()) {
      const query = searchText.toLowerCase();
      const matchName = (apiWorld?.name ?? entry.displayName).toLowerCase().includes(query);
      const matchEra = entry.eraLabel.toLowerCase().includes(query);
      const matchTagline = (apiWorld?.tagline ?? '').toLowerCase().includes(query);
      if (!matchName && !matchEra && !matchTagline) {
        return false;
      }
    }

    if (statusFilter === 'explored') {
      return exploredWorldIds.has(entry.worldId);
    }
    if (statusFilter === 'unexplored') {
      return !exploredWorldIds.has(entry.worldId);
    }
    return true;
  });

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!filteredEntries.length) {
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const currentIndex = filteredEntries.findIndex((entry) => entry.worldId === selectedWorldId);
        const nextIndex = event.key === 'ArrowRight'
          ? Math.min(currentIndex + 1, filteredEntries.length - 1)
          : Math.max(currentIndex - 1, 0);
        if (filteredEntries[nextIndex]) {
          setSelectedWorldId(filteredEntries[nextIndex]!.worldId);
        }
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filteredEntries, selectedWorldId]);

  const emptyStateMessage = searchText.trim()
    ? '没有匹配的历史时期'
    : catalogEntries.length === 0
      ? '当前无可用世界'
      : t('explore.empty');

  return (
    <div className="flex h-full flex-col bg-amber-50/20">
      <div className="border-b border-amber-100 bg-white/80 px-6 py-4 backdrop-blur-sm">
        <h1 className="mb-3 text-xl font-bold text-neutral-800">{t('explore.title')}</h1>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索历史时期..."
              className="w-full rounded-xl border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-sm transition-colors focus:border-amber-400 focus:outline-none"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>

          <div className="flex gap-1">
            {(['all', 'explored', 'unexplored'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={[
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  statusFilter === filter
                    ? 'border-amber-600 bg-amber-600 text-white'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-amber-300',
                ].join(' ')}
              >
                {filter === 'all' ? '全部' : filter === 'explored' ? '已探索' : '未探索'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600" />
          </div>
        ) : null}

        {error && !isLoading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3">
            <p className="text-sm text-neutral-500">{t('explore.loadError')}</p>
            <button
              onClick={() => void refetch()}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
            >
              {t('explore.retry')}
            </button>
          </div>
        ) : null}

        {!isLoading && !error ? (
          <div className="px-6 py-6">
            {filteredEntries.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center text-neutral-400">
                <p className="text-sm">{emptyStateMessage}</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-2 text-xs text-neutral-400">
                  <span>
                    {filteredEntries[0]?.startYear
                      ? `${Math.abs(filteredEntries[0].startYear)} ${filteredEntries[0].startYear < 0 ? 'BCE' : 'CE'}`
                      : ''}
                  </span>
                  <div className="relative h-px flex-1 bg-amber-200">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="bg-amber-50/20 px-2 font-medium text-amber-600">时间长河</span>
                    </div>
                  </div>
                  <span>{filteredEntries.at(-1)?.endYear ? `${filteredEntries.at(-1)!.endYear} CE` : ''}</span>
                </div>

                <div
                  ref={timelineRef}
                  className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin"
                  style={{ scrollbarColor: '#d4b896 transparent' }}
                >
                  {filteredEntries.map((entry) => (
                    <WorldTimelineNode
                      key={entry.worldId}
                      catalog={entry}
                      apiWorld={apiWorldMap.get(entry.worldId)}
                      hasSession={exploredWorldIds.has(entry.worldId)}
                      isSelected={selectedWorldId === entry.worldId}
                      onClick={() => setSelectedWorldId(entry.worldId)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      {showEncounter ? <CharacterEncounter onDismiss={() => setEncounterDismissed(true)} /> : null}
    </div>
  );
}
