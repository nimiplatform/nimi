import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { APP_DISPLAY_SECTION_TITLE_CLASS, APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { prefetchWorldDetailAndEvents, worldListQueryKey } from './world-detail-queries';
import { prefetchWorldDetailPanel } from './world-detail-route-state';
import { isMainWorldType } from './shared';

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export type WorldAgentItem = {
  id: string;
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string | null;
  createdAt?: string;
};

export type WorldListItem = {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  themes: string[];
  era: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  type: string;
  status: string;
  level: number;
  levelUpdatedAt: string | null;
  agentCount: number;
  createdAt: string;
  updatedAt: string | null;
  creatorId: string | null;
  freezeReason: string | null;
  lorebookEntryLimit: number;
  nativeAgentLimit: number;
  nativeCreationState: string;
  scoreA: number;
  scoreC: number;
  scoreE: number;
  scoreEwma: number;
  scoreQ: number;
  timeFlowRatio: number;
  transitInLimit: number;
  agents?: WorldAgentItem[];
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveWorldType(raw: Record<string, unknown>): string {
  return (
    readString(raw.type) ??
    readString(raw.worldType) ??
    readString(raw.world_type) ??
    'CREATOR'
  );
}

function resolveCreatorId(raw: Record<string, unknown>): string | null {
  return (
    readString(raw.creatorId) ??
    readString(raw.worldCreatorId) ??
    readString(raw.world_creator_id) ??
    null
  );
}

function isMainWorld(item: Pick<WorldListItem, 'type' | 'creatorId'>): boolean {
  return isMainWorldType(item.type) || !item.creatorId;
}

export function toWorldListItem(raw: Record<string, unknown>): WorldListItem {
  let parsedAgents: WorldAgentItem[] | undefined;
  if (Array.isArray(raw.agents)) {
    parsedAgents = raw.agents.map((a: unknown) => {
      const agent = a as Record<string, unknown>;
      return {
        id: String(agent.id || ''),
        name: String(agent.name || 'Unknown'),
        handle: typeof agent.handle === 'string' ? agent.handle : undefined,
        bio: typeof agent.bio === 'string' ? agent.bio : undefined,
        avatarUrl: typeof agent.avatarUrl === 'string' ? agent.avatarUrl : null,
        createdAt: typeof agent.createdAt === 'string' ? agent.createdAt : undefined,
      };
    });
  }

  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Unknown World'),
    description: typeof raw.description === 'string' ? raw.description : null,
    genre: typeof raw.genre === 'string' ? raw.genre : null,
    themes: Array.isArray(raw.themes)
      ? raw.themes.filter((t): t is string => typeof t === 'string')
      : [],
    era: typeof raw.era === 'string' ? raw.era : null,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    bannerUrl: typeof raw.bannerUrl === 'string' ? raw.bannerUrl : null,
    type: resolveWorldType(raw),
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    levelUpdatedAt: typeof raw.levelUpdatedAt === 'string' ? raw.levelUpdatedAt : null,
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    creatorId: resolveCreatorId(raw),
    freezeReason: typeof raw.freezeReason === 'string' ? raw.freezeReason : null,
    lorebookEntryLimit: typeof raw.lorebookEntryLimit === 'number' ? raw.lorebookEntryLimit : 0,
    nativeAgentLimit: typeof raw.nativeAgentLimit === 'number' ? raw.nativeAgentLimit : 0,
    nativeCreationState:
      typeof raw.nativeCreationState === 'string' ? raw.nativeCreationState : 'OPEN',
    scoreA: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
    scoreC: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
    scoreE: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
    scoreEwma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    scoreQ: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
    timeFlowRatio: typeof raw.timeFlowRatio === 'number' ? raw.timeFlowRatio : 1,
    transitInLimit: typeof raw.transitInLimit === 'number' ? raw.transitInLimit : 0,
    agents: parsedAgents,
  };
}

const DEFAULT_TAG_STYLE: { bg: string; text: string } = { bg: 'bg-gray-100', text: 'text-gray-600' };

// Morandi color palette for tags
const tagStyles: Record<string, { bg: string; text: string }> = {
  genre: { bg: 'bg-slate-100', text: 'text-slate-600' },
  era: { bg: 'bg-stone-100', text: 'text-stone-600' },
  theme: DEFAULT_TAG_STYLE,
  active: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  draft: { bg: 'bg-amber-50', text: 'text-amber-600' },
  frozen: { bg: 'bg-rose-50', text: 'text-rose-600' },
  open: { bg: 'bg-teal-50', text: 'text-teal-600' },
  closed: { bg: 'bg-orange-50', text: 'text-orange-600' },
};

function getTagStyle(type: string, value?: string): { bg: string; text: string } {
  const key = value?.toLowerCase() || type.toLowerCase();
  return tagStyles[key] ?? DEFAULT_TAG_STYLE;
}

export function WorldList() {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const [searchText, setSearchText] = useState('');

  const openWorldDetail = (worldId: string) => {
    prefetchWorldDetailPanel();
    prefetchWorldDetailAndEvents(worldId);
    navigateToWorld(worldId);
  };

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => {
      const result = await dataSync.loadWorlds();
      return Array.isArray(result)
        ? result.map((item) => toWorldListItem(item as Record<string, unknown>))
        : [];
    },
  });

  const worlds = worldsQuery.data || [];

  const filteredWorlds = searchText.trim()
    ? worlds.filter(
        (w) =>
          w.name.toLowerCase().includes(searchText.toLowerCase()) ||
          (w.description && w.description.toLowerCase().includes(searchText.toLowerCase())),
      )
    : worlds;

  const mainWorld = worlds.find((w) => isMainWorld(w));
  const subWorlds = filteredWorlds.filter((w) => !isMainWorld(w));

  if (worldsQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: '#F0F4F8' }}>
        <div className="shrink-0 px-6 py-4">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="h-8 w-36 animate-pulse rounded-xl bg-white/80" />
              <div className="h-3 w-24 animate-pulse rounded bg-white/70" />
            </div>
            <div className="h-11 w-[300px] animate-pulse rounded-full bg-white/80" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-6xl space-y-8">
            <div className="space-y-4">
              <div className="h-6 w-28 animate-pulse rounded-lg bg-white/80" />
              <div className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="mb-5 h-40 animate-pulse rounded-[1.5rem] bg-slate-100" />
                <div className="flex items-start gap-5">
                  <div className="h-20 w-20 animate-pulse rounded-2xl bg-slate-100" />
                  <div className="flex-1 space-y-3">
                    <div className="h-6 w-56 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    <div className="flex gap-2">
                      <div className="h-7 w-20 animate-pulse rounded-full bg-slate-100" />
                      <div className="h-7 w-24 animate-pulse rounded-full bg-slate-100" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-6 w-32 animate-pulse rounded-lg bg-white/80" />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-3xl bg-white p-5 shadow-sm">
                    <div className="mb-4 h-32 animate-pulse rounded-[1.5rem] bg-slate-100" />
                    <div className="space-y-3">
                      <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (worldsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center" style={{ backgroundColor: '#F0F4F8' }}>
        <span className="text-sm text-red-600">{t('World.loadError')}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: '#F0F4F8' }}>
      {/* Header bar */}
      <div className="shrink-0 px-6 py-4" style={{ backgroundColor: '#F0F4F8' }}>
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className={APP_PAGE_TITLE_CLASS} style={{ color: '#1A1A1A' }}>{t('World.title')}</h1>
            <span className="text-xs" style={{ color: '#888888' }}>
              {t('World.syncedFromDesktop', { defaultValue: 'Synced from Desktop' })}
            </span>
          </div>
          <div className="w-[300px] shrink-0">
            <div className="group relative">
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-emerald-500">
                {ICON_SEARCH}
              </span>
              <input
                type="search"
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                }}
                placeholder={t('World.searchByNameOrDescription', {
                  defaultValue: 'Search worlds by name or description...',
                })}
                className="w-full rounded-full border border-white/70 bg-white/85 py-2.5 pl-11 pr-5 text-sm text-gray-900 placeholder:text-gray-400 shadow-[0_10px_30px_rgba(15,23,42,0.06)] outline-none backdrop-blur-xl transition-all focus:border-emerald-200 focus:bg-white focus:shadow-[0_14px_36px_rgba(16,185,129,0.10)] focus:ring-4 focus:ring-emerald-100/70"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="app-scroll-shell flex-1 overflow-y-auto px-6 py-6" style={{ backgroundColor: '#F0F4F8' }}>
        <div className="mx-auto max-w-6xl">
          {/* Main World Card */}
          {mainWorld && !searchText && (
            <div className="mb-8">
              <h2 className={`${APP_DISPLAY_SECTION_TITLE_CLASS} mb-4`} style={{ fontFamily: 'var(--font-display)', color: '#1A1A1A' }}>{t('World.mainWorld')}</h2>
              <div
                onClick={() => openWorldDetail(mainWorld.id)}
                className="group cursor-pointer rounded-3xl bg-white p-6 transition-all duration-300 hover:-translate-y-1"
                style={{ 
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.04)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.04)';
                }}
              >
                {mainWorld.bannerUrl && (
                  <div className="relative -mx-6 -mt-6 mb-5 h-40 overflow-hidden rounded-t-3xl">
                    <img
                      src={mainWorld.bannerUrl}
                      alt={mainWorld.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
                  </div>
                )}

                <div className="flex items-start gap-5">
                  <div className="relative shrink-0">
                    {mainWorld.iconUrl ? (
                      <img
                        src={mainWorld.iconUrl}
                        alt={mainWorld.name}
                        className="h-20 w-20 rounded-2xl object-cover shadow-sm"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl text-3xl font-bold text-white shadow-sm"
                        style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)' }}>
                        {mainWorld.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-semibold truncate" style={{ color: '#1A1A1A', fontWeight: 600 }}>{mainWorld.name}</h3>
                      <span className="inline-flex items-center gap-1 text-xs shrink-0" style={{ color: '#666666' }}>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="11" width="18" height="10" rx="2" />
                          <circle cx="12" cy="5" r="2" />
                          <path d="M12 7v4" />
                          <line x1="8" y1="16" x2="8" y2="16" />
                          <line x1="16" y1="16" x2="16" y2="16" />
                        </svg>
                        {mainWorld.agentCount}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${getTagStyle('status', mainWorld.status).bg} ${getTagStyle('status', mainWorld.status).text}`}
                        style={{ borderRadius: '9999px' }}
                      >
                        {mainWorld.status}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${getTagStyle('creation', mainWorld.nativeCreationState).bg} ${getTagStyle('creation', mainWorld.nativeCreationState).text}`}
                        style={{ borderRadius: '9999px' }}
                      >
                        {mainWorld.nativeCreationState}
                      </span>
                    </div>

                    {(mainWorld.genre || mainWorld.era || mainWorld.themes.length > 0) && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {mainWorld.genre && (
                          <span 
                            className={`inline-block px-3 py-1 text-xs font-medium ${getTagStyle('genre').bg} ${getTagStyle('genre').text}`}
                            style={{ borderRadius: '9999px' }}
                          >
                            {mainWorld.genre}
                          </span>
                        )}
                        {mainWorld.era && (
                          <span 
                            className={`inline-block px-3 py-1 text-xs font-medium ${getTagStyle('era').bg} ${getTagStyle('era').text}`}
                            style={{ borderRadius: '9999px' }}
                          >
                            {mainWorld.era}
                          </span>
                        )}
                        {mainWorld.themes.slice(0, 3).map((theme, idx) => (
                          <span
                            key={idx}
                            className={`inline-block px-3 py-1 text-xs font-medium ${getTagStyle('theme').bg} ${getTagStyle('theme').text}`}
                            style={{ borderRadius: '9999px' }}
                          >
                            {theme}
                          </span>
                        ))}
                        {mainWorld.themes.length > 3 && (
                          <span 
                            className="inline-block px-3 py-1 text-xs font-medium bg-gray-100 text-gray-500"
                            style={{ borderRadius: '9999px' }}
                          >
                            +{mainWorld.themes.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    {mainWorld.description && (
                      <p 
                        className="mt-3 text-sm line-clamp-2"
                        style={{ color: '#666666', lineHeight: 1.5 }}
                      >
                        {mainWorld.description}
                      </p>
                    )}

                    {mainWorld.creatorId && (
                      <div className="mt-2 text-xs" style={{ color: '#888888' }}>
                        {t('WorldDetail.creatorId', { id: mainWorld.creatorId })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub Worlds Grid */}
          <div>
            <h2 className={`${APP_DISPLAY_SECTION_TITLE_CLASS} mb-4`} style={{ fontFamily: 'var(--font-display)', color: '#1A1A1A' }}>
              {searchText ? t('World.searchResults') : t('World.subWorlds')}
            </h2>
            {subWorlds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: '#888888' }}>
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  className="mb-4 opacity-30"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <p className="text-sm">
                  {searchText ? t('World.noSearchResults') : t('World.noWorlds')}
                </p>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {subWorlds.map((world) => {
                  return (
                    <div
                      key={world.id}
                      onClick={() => openWorldDetail(world.id)}
                      className="group cursor-pointer rounded-2xl bg-white p-5 transition-all duration-300 hover:-translate-y-1"
                      style={{ 
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.04)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.04)';
                      }}
                    >
                      {world.bannerUrl && (
                        <div className="relative -mx-5 -mt-5 mb-4 h-24 overflow-hidden rounded-t-2xl">
                          <img
                            src={world.bannerUrl}
                            alt={world.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {world.iconUrl ? (
                            <img
                              src={world.iconUrl}
                              alt={world.name}
                              className="h-14 w-14 rounded-xl object-cover shadow-sm"
                            />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold text-white shadow-sm"
                              style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)' }}>
                              {world.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="font-semibold truncate" style={{ color: '#1A1A1A', fontWeight: 600 }}>{world.name}</h3>
                            <span className="inline-flex items-center gap-1 text-[10px] shrink-0" style={{ color: '#666666' }}>
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <rect x="3" y="11" width="18" height="10" rx="2" />
                                <circle cx="12" cy="5" r="2" />
                                <path d="M12 7v4" />
                                <line x1="8" y1="16" x2="8" y2="16" />
                                <line x1="16" y1="16" x2="16" y2="16" />
                              </svg>
                              {world.agentCount}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span
                              className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('status', world.status).bg} ${getTagStyle('status', world.status).text}`}
                              style={{ borderRadius: '9999px' }}
                            >
                              {world.status}
                            </span>
                            <span
                              className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('creation', world.nativeCreationState).bg} ${getTagStyle('creation', world.nativeCreationState).text}`}
                              style={{ borderRadius: '9999px' }}
                            >
                              {world.nativeCreationState}
                            </span>
                          </div>
                          {(world.genre || world.era || world.themes.length > 0) && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              {world.genre && (
                                <span 
                                  className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('genre').bg} ${getTagStyle('genre').text}`}
                                  style={{ borderRadius: '9999px' }}
                                >
                                  {world.genre}
                                </span>
                              )}
                              {world.era && (
                                <span 
                                  className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('era').bg} ${getTagStyle('era').text}`}
                                  style={{ borderRadius: '9999px' }}
                                >
                                  {world.era}
                                </span>
                              )}
                              {world.themes.slice(0, 2).map((theme, idx) => (
                                <span
                                  key={idx}
                                  className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('theme').bg} ${getTagStyle('theme').text}`}
                                  style={{ borderRadius: '9999px' }}
                                >
                                  {theme}
                                </span>
                              ))}
                              {world.themes.length > 2 && (
                                <span 
                                  className="inline-block px-2.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500"
                                  style={{ borderRadius: '9999px' }}
                                >
                                  +{world.themes.length - 2}
                                </span>
                              )}
                            </div>
                          )}

                          {world.description && (
                            <p 
                              className="mt-2.5 text-xs line-clamp-2"
                              style={{ color: '#666666', lineHeight: 1.5 }}
                            >
                              {world.description}
                            </p>
                          )}

                          {world.freezeReason && (
                            <div className="mt-1 text-[10px]" style={{ color: '#e11d48' }}>
                              {t('WorldDetail.freezeReason', { reason: world.freezeReason })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
