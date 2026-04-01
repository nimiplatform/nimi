import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CharacterEncounter, useEncounterShouldShow } from './character-encounter.js';
import { getWorlds } from '@renderer/data/world-client.js';
import { getActiveCatalogEntries } from '@renderer/data/world-catalog.js';
import { isValidPair, getClassification } from '@renderer/data/classification.js';
import { ClassificationBadge } from './components/classification-badge.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { sqliteGetSessionsForLearner } from '@renderer/bridge/sqlite-bridge.js';
import type { WorldCatalogEntry } from '@renderer/data/world-catalog.js';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type WorldListResult = RealmServiceResult<'WorldsService', 'worldControllerListWorlds'>;
type ApiWorld = WorldListResult extends (infer T)[] ? T : never;

// ── World timeline node ─────────────────────────────────────────────────────

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
        'flex-none w-48 rounded-2xl border-2 overflow-hidden transition-all duration-200',
        'flex flex-col bg-white',
        isSelected ? 'border-amber-500 shadow-lg scale-[1.03]' : 'border-transparent hover:border-amber-200',
        !hasSession ? 'opacity-80' : '',
      ].join(' ')}
    >
      {/* Banner */}
      <div className="h-24 bg-neutral-100 relative overflow-hidden">
        {apiWorld?.bannerUrl ? (
          <img
            src={apiWorld.bannerUrl}
            alt={catalog.displayName}
            className={['w-full h-full object-cover', !hasSession ? 'grayscale' : ''].join(' ')}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-100 to-amber-50">
            <span className="text-amber-400 text-2xl">历</span>
          </div>
        )}
        {/* Era badge */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1">
          <p className="text-white text-xs font-medium truncate">{catalog.eraLabel}</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-neutral-800 leading-snug line-clamp-2">
          {apiWorld?.name ?? catalog.displayName}
        </h3>
        {apiWorld?.tagline && (
          <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">{apiWorld.tagline}</p>
        )}
        {classification && (
          <ClassificationBadge contentType={catalog.contentType} truthMode={catalog.truthMode} />
        )}
        {hasSession && (
          <span className="text-xs text-amber-600 font-medium mt-auto">已探索</span>
        )}
      </div>
    </Link>
  );
}

// ── Explore Home Page ───────────────────────────────────────────────────────

type ExploreFilter = 'all' | 'explored' | 'unexplored';

export default function ExploreHomePage() {
  const { t } = useTranslation();
  const activeProfile = useAppStore((s) => s.activeProfile);
  const shouldShowEncounter = useEncounterShouldShow();
  const [encounterDismissed, setEncounterDismissed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<ExploreFilter>('all');
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const showEncounter = shouldShowEncounter && !encounterDismissed;

  // Fetch all worlds from Realm API — SJ-EXPL-001:2
  const { data: apiWorlds, isLoading, error, refetch } = useQuery({
    queryKey: ['worlds'],
    queryFn: async () => {
      const result = await getWorlds();
      return result as WorldListResult;
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });

  // Fetch learner's sessions to determine exploration status — SJ-EXPL-002:3
  const { data: sessions } = useQuery({
    queryKey: ['sessions', activeProfile?.id],
    queryFn: async () => {
      if (!activeProfile) return [];
      return sqliteGetSessionsForLearner(activeProfile.id);
    },
    enabled: !!activeProfile,
  });

  // Build API world lookup map
  const apiWorldMap = new Map<string, ApiWorld>();
  if (apiWorlds && Array.isArray(apiWorlds)) {
    for (const w of apiWorlds as ApiWorld[]) {
      if (w.id) apiWorldMap.set(w.id, w);
    }
  }

  // Build explored world set
  const exploredWorldIds = new Set<string>();
  if (sessions) {
    for (const s of sessions) {
      exploredWorldIds.add(s.worldId);
    }
  }

  // Get catalog-eligible worlds — SJ-EXPL-007, SJ-EXPL-010
  const catalogEntries = getActiveCatalogEntries().filter((entry) => {
    // SJ-EXPL-010: validate classification pair
    if (!isValidPair(entry.contentType, entry.truthMode)) {
      // Log operational visibility, exclude from UI
      console.warn('[shiji:explore] Invalid classification pair excluded:', entry.worldId, entry.contentType, entry.truthMode);
      return false;
    }
    return true;
  });

  // Apply search and status filters — SJ-EXPL-003
  const filteredEntries = catalogEntries.filter((entry) => {
    const apiWorld = apiWorldMap.get(entry.worldId);
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      const matchName = (apiWorld?.name ?? entry.displayName).toLowerCase().includes(q);
      const matchEra = entry.eraLabel.toLowerCase().includes(q);
      const matchTagline = (apiWorld?.tagline ?? '').toLowerCase().includes(q);
      if (!matchName && !matchEra && !matchTagline) return false;
    }
    if (statusFilter === 'explored') return exploredWorldIds.has(entry.worldId);
    if (statusFilter === 'unexplored') return !exploredWorldIds.has(entry.worldId);
    return true;
  });

  // Timeline keyboard navigation — SJ-EXPL-002:5
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!filteredEntries.length) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const idx = filteredEntries.findIndex((entry) => entry.worldId === selectedWorldId);
        const next = e.key === 'ArrowRight'
          ? Math.min(idx + 1, filteredEntries.length - 1)
          : Math.max(idx - 1, 0);
        if (filteredEntries[next]) {
          setSelectedWorldId(filteredEntries[next]!.worldId);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filteredEntries, selectedWorldId]);

  return (
    <div className="h-full flex flex-col bg-amber-50/20">
      {/* Header */}
      <div className="px-6 py-4 border-b border-amber-100 bg-white/80 backdrop-blur-sm">
        <h1 className="text-xl font-bold text-neutral-800 mb-3">{t('explore.title')}</h1>

        {/* Search + Filter row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Text search */}
          <div className="relative flex-1 min-w-48">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="搜索历史时期..."
              className="w-full rounded-xl border border-neutral-200 pl-9 pr-3 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-400 transition-colors"
            />
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </div>

          {/* Status filter */}
          <div className="flex gap-1">
            {(['all', 'explored', 'unexplored'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={[
                  'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  statusFilter === f
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-white text-neutral-600 border-neutral-200 hover:border-amber-300',
                ].join(' ')}
              >
                {f === 'all' ? '全部' : f === 'explored' ? '已探索' : '未探索'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
          </div>
        )}

        {/* Error — SJ-EXPL-001:5 */}
        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <p className="text-neutral-500 text-sm">{t('explore.loadError')}</p>
            <button
              onClick={() => void refetch()}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
            >
              {t('explore.retry')}
            </button>
          </div>
        )}

        {/* Timeline — SJ-EXPL-002 */}
        {!isLoading && !error && (
          <div className="px-6 py-6">
            {filteredEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-neutral-400">
                <p className="text-sm">{searchText ? '没有匹配的历史时期' : t('explore.empty')}</p>
              </div>
            ) : (
              <>
                {/* Timeline header with year range */}
                {filteredEntries.length > 0 && (
                  <div className="flex items-center gap-2 mb-4 text-xs text-neutral-400">
                    <span>{filteredEntries[0]?.startYear ? `${Math.abs(filteredEntries[0].startYear)} ${filteredEntries[0].startYear < 0 ? 'BCE' : 'CE'}` : ''}</span>
                    <div className="flex-1 h-px bg-amber-200 relative">
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="bg-amber-50/20 px-2 text-amber-600 font-medium">时间长河</span>
                      </div>
                    </div>
                    <span>{filteredEntries.at(-1)?.endYear ? `${filteredEntries.at(-1)!.endYear} CE` : ''}</span>
                  </div>
                )}

                {/* Horizontal scrollable timeline — SJ-EXPL-002:1 */}
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
        )}
      </div>

      {/* Character Encounter overlay — SJ-SHELL-009 */}
      {showEncounter && (
        <CharacterEncounter onDismiss={() => setEncounterDismissed(true)} />
      )}
    </div>
  );
}
