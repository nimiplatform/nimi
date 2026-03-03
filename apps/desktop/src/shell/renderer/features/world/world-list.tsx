import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getStatusBadgeStyle, getStatusDotColor } from './shared.js';
import { WorldDetail } from './world-detail.js';

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

function toWorldListItem(raw: Record<string, unknown>): WorldListItem {
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
    type: typeof raw.type === 'string' ? raw.type : 'SUB',
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    levelUpdatedAt: typeof raw.levelUpdatedAt === 'string' ? raw.levelUpdatedAt : null,
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    creatorId: typeof raw.creatorId === 'string' ? raw.creatorId : null,
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

export function WorldList() {
  const { t } = useTranslation();
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const [searchText, setSearchText] = useState('');
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);

  const openWorldDetail = (worldId: string) => {
    setRuntimeFields({
      worldId,
    });
    setSelectedWorldId(worldId);
  };

  const worldsQuery = useQuery({
    queryKey: ['worlds-list'],
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

  const mainWorld = worlds.find((w) => w.type === 'MAIN');
  const subWorlds = filteredWorlds.filter((w) => w.type === 'SUB');

  if (selectedWorldId) {
    const selectedWorld = worlds.find((w) => w.id === selectedWorldId);
    if (selectedWorld) {
      return <WorldDetail world={selectedWorld} onBack={() => setSelectedWorldId(null)} />;
    }
  }

  if (worldsQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-mint-500" />
          <span className="text-sm">{t('World.loading')}</span>
        </div>
      </div>
    );
  }

  if (worldsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <span className="text-sm text-red-600">{t('World.loadError')}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header bar */}
      <div className="flex h-auto shrink-0 flex-col justify-center gap-1 bg-gray-50 px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">{t('World.title')}</h1>
        <span className="text-xs text-gray-400">Synced from Desktop</span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="mx-auto max-w-6xl px-6 py-6">
          {/* Main World Card */}
          {mainWorld && !searchText && (
            <div className="mb-6">
              <h2 className="text-[19px] font-semibold leading-7 text-gray-900 mb-3" style={{ fontFamily: '"Noto Sans SC", "Source Han Sans SC", sans-serif' }}>{t('World.mainWorld')}</h2>
              <div
                onClick={() => openWorldDetail(mainWorld.id)}
                className="cursor-pointer rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md"
              >
                {mainWorld.bannerUrl && (
                  <div className="relative -mx-6 -mt-6 mb-4 h-32 overflow-hidden rounded-t-2xl">
                    <img
                      src={mainWorld.bannerUrl}
                      alt={mainWorld.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  </div>
                )}

                <div className="flex items-start gap-4">
                  <div className="relative">
                    {mainWorld.iconUrl ? (
                      <img
                        src={mainWorld.iconUrl}
                        alt={mainWorld.name}
                        className="h-20 w-20 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-mint-100 to-mint-50 text-3xl font-bold text-mint-600">
                        {mainWorld.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {/* Status dot */}
                    <div
                      className={`absolute bottom-[1px] right-[1px] h-4 w-4 rounded-full border-2 border-white ${getStatusDotColor(mainWorld.status)}`}
                      title={mainWorld.status}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900">{mainWorld.name}</h3>
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
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

                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeStyle(mainWorld.status).bg} ${getStatusBadgeStyle(mainWorld.status).text}`}
                      >
                        {mainWorld.status}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${mainWorld.nativeCreationState === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}
                      >
                        {mainWorld.nativeCreationState}
                      </span>
                    </div>

                    {(mainWorld.genre || mainWorld.era || mainWorld.themes.length > 0) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {mainWorld.genre && (
                          <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                            {mainWorld.genre}
                          </span>
                        )}
                        {mainWorld.era && (
                          <span className="inline-block px-2 py-0.5 bg-purple-50 text-purple-600 rounded text-xs">
                            {mainWorld.era}
                          </span>
                        )}
                        {mainWorld.themes.slice(0, 3).map((theme, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-2 py-0.5 bg-amber-50 text-amber-600 rounded text-xs"
                          >
                            {theme}
                          </span>
                        ))}
                        {mainWorld.themes.length > 3 && (
                          <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                            +{mainWorld.themes.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    {mainWorld.description && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                        {mainWorld.description}
                      </p>
                    )}

                    {mainWorld.creatorId && (
                      <div className="mt-1 text-xs text-gray-400">
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
            <h2 className="text-[19px] font-semibold leading-7 text-gray-900 mb-3" style={{ fontFamily: '"Noto Sans SC", "Source Han Sans SC", sans-serif' }}>
              {searchText ? t('World.searchResults') : t('World.subWorlds')}
            </h2>
            {subWorlds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
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
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {subWorlds.map((world) => {
                  const statusStyle = getStatusBadgeStyle(world.status);
                  return (
                    <div
                      key={world.id}
                      onClick={() => openWorldDetail(world.id)}
                      className="cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md"
                    >
                      {world.bannerUrl && (
                        <div className="relative -mx-5 -mt-5 mb-3 h-20 overflow-hidden rounded-t-xl">
                          <img
                            src={world.bannerUrl}
                            alt={world.name}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {world.iconUrl ? (
                            <img
                              src={world.iconUrl}
                              alt={world.name}
                              className="h-14 w-14 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-mint-100 to-mint-50 text-xl font-bold text-mint-600">
                              {world.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          {/* Status dot */}
                          <div
                            className={`absolute bottom-[1px] right-[1px] h-3.5 w-3.5 rounded-full border-2 border-white ${getStatusDotColor(world.status)}`}
                            title={world.status}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="font-semibold text-gray-900 truncate">{world.name}</h3>
                            <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
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
                          <div className="flex items-center gap-1 mt-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}
                            >
                              {world.status}
                            </span>
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${world.nativeCreationState === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}
                            >
                              {world.nativeCreationState}
                            </span>
                          </div>
                          {(world.genre || world.era || world.themes.length > 0) && (
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                              {world.genre && (
                                <span className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px]">
                                  {world.genre}
                                </span>
                              )}
                              {world.era && (
                                <span className="inline-block px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-[10px]">
                                  {world.era}
                                </span>
                              )}
                              {world.themes.slice(0, 2).map((theme, idx) => (
                                <span
                                  key={idx}
                                  className="inline-block px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded text-[10px]"
                                >
                                  {theme}
                                </span>
                              ))}
                              {world.themes.length > 2 && (
                                <span className="inline-block px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">
                                  +{world.themes.length - 2}
                                </span>
                              )}
                            </div>
                          )}

                          {world.description && (
                            <p className="mt-2 text-xs text-gray-500 line-clamp-2">
                              {world.description}
                            </p>
                          )}

                          {world.freezeReason && (
                            <div className="mt-1 text-[10px] text-red-500">
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
