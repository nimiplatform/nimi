import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getStatusBadgeStyle } from './shared.js';

type WorldListItem = {
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
};

function toWorldListItem(raw: Record<string, unknown>): WorldListItem {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Unknown World'),
    description: typeof raw.description === 'string' ? raw.description : null,
    genre: typeof raw.genre === 'string' ? raw.genre : null,
    themes: Array.isArray(raw.themes) ? raw.themes.filter((t): t is string => typeof t === 'string') : [],
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
    nativeCreationState: typeof raw.nativeCreationState === 'string' ? raw.nativeCreationState : 'OPEN',
    scoreA: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
    scoreC: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
    scoreE: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
    scoreEwma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    scoreQ: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
    timeFlowRatio: typeof raw.timeFlowRatio === 'number' ? raw.timeFlowRatio : 1,
    transitInLimit: typeof raw.transitInLimit === 'number' ? raw.transitInLimit : 0,
  };
}

export function WorldList() {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const [searchText, setSearchText] = useState('');

  const worldsQuery = useQuery({
    queryKey: ['worlds-list'],
    queryFn: async () => {
      const result = await dataSync.loadWorlds();
      return Array.isArray(result) ? result.map((item) => toWorldListItem(item as Record<string, unknown>)) : [];
    },
  });

  const worlds = worldsQuery.data || [];
  
  const filteredWorlds = searchText.trim()
    ? worlds.filter((w) => 
        w.name.toLowerCase().includes(searchText.toLowerCase()) ||
        (w.description && w.description.toLowerCase().includes(searchText.toLowerCase()))
      )
    : worlds;

  const mainWorld = worlds.find((w) => w.type === 'MAIN');
  const subWorlds = filteredWorlds.filter((w) => w.type === 'SUB');

  if (worldsQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center bg-[#F0F4F8]">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#4ECCA3]" />
          <span className="text-sm">{t('World.loading')}</span>
        </div>
      </div>
    );
  }

  if (worldsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center bg-[#F0F4F8]">
        <span className="text-sm text-red-600">{t('World.loadError')}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-[#F0F4F8] overflow-y-auto">
      <div className="mx-auto max-w-6xl w-full px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">{t('World.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('World.subtitle')}</p>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="flex h-10 items-center rounded-full bg-white px-4 shadow-sm max-w-md">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="ml-2 min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
              placeholder={t('World.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>

        {/* Main World Card */}
        {mainWorld && !searchText && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-gray-500 mb-3">{t('World.mainWorld')}</h2>
            <div
              onClick={() => navigateToWorld(mainWorld.id)}
              className="cursor-pointer rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all hover:bg-white/60 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none rounded-3xl" />
              
              {/* Banner */}
              {mainWorld.bannerUrl && (
                <div className="relative -mx-6 -mt-6 mb-4 h-32 overflow-hidden">
                  <img src={mainWorld.bannerUrl} alt={mainWorld.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                </div>
              )}
              
              <div className="relative flex items-start gap-4">
                {mainWorld.iconUrl ? (
                  <img src={mainWorld.iconUrl} alt={mainWorld.name} className="h-20 w-20 rounded-2xl object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-3xl font-bold text-[#4ECCA3]">
                    {mainWorld.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-gray-900">{mainWorld.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeStyle(mainWorld.status).bg} ${getStatusBadgeStyle(mainWorld.status).text}`}>
                      {mainWorld.status}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${mainWorld.nativeCreationState === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
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
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">{mainWorld.description}</p>
                  )}
                  
                  {/* Stats Grid */}
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    <div className="bg-white/50 rounded-lg p-2">
                      <div className="text-gray-500">{t('WorldDetail.level')}</div>
                      <div className="font-semibold text-gray-900">{mainWorld.level}</div>
                    </div>
                    <div className="bg-white/50 rounded-lg p-2">
                      <div className="text-gray-500">{t('WorldDetail.agents')}</div>
                      <div className="font-semibold text-gray-900">{mainWorld.agentCount}</div>
                    </div>
                    <div className="bg-white/50 rounded-lg p-2">
                      <div className="text-gray-500">{t('WorldDetail.nativeAgentLimit')}</div>
                      <div className="font-semibold text-gray-900">{mainWorld.nativeAgentLimit}</div>
                    </div>
                    <div className="bg-white/50 rounded-lg p-2">
                      <div className="text-gray-500">{t('WorldDetail.lorebookLimit')}</div>
                      <div className="font-semibold text-gray-900">{mainWorld.lorebookEntryLimit}</div>
                    </div>
                  </div>
                  
                  {/* Time & Transit */}
                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                    <span>{t('WorldDetail.timeFlowRatio', { ratio: mainWorld.timeFlowRatio })}</span>
                    <span>•</span>
                    <span>{t('WorldDetail.transitInLimit', { limit: mainWorld.transitInLimit })}</span>
                    {mainWorld.freezeReason && (
                      <>
                        <span>•</span>
                        <span className="text-red-500">{t('WorldDetail.freezeReason', { reason: mainWorld.freezeReason })}</span>
                      </>
                    )}
                  </div>
                  
                  {/* Scores */}
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <span className="text-gray-400">{t('WorldDetail.scores')}:</span>
                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">A:{mainWorld.scoreA.toFixed(1)}</span>
                    <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">C:{mainWorld.scoreC.toFixed(1)}</span>
                    <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded">E:{mainWorld.scoreE.toFixed(1)}</span>
                    <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded">Q:{mainWorld.scoreQ.toFixed(1)}</span>
                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">EWMA:{mainWorld.scoreEwma.toFixed(1)}</span>
                  </div>
                  
                  {mainWorld.creatorId && (
                    <div className="mt-1 text-xs text-gray-400">
                      {t('WorldDetail.creatorId', { id: mainWorld.creatorId })}
                    </div>
                  )}
                </div>
                <div className="text-gray-400">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sub Worlds Grid */}
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-3">
            {searchText ? t('World.searchResults') : t('World.subWorlds')}
          </h2>
          {subWorlds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 opacity-30">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <p className="text-sm">{searchText ? t('World.noSearchResults') : t('World.noWorlds')}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {subWorlds.map((world) => {
                const statusStyle = getStatusBadgeStyle(world.status);
                return (
                  <div
                    key={world.id}
                    onClick={() => navigateToWorld(world.id)}
                    className="cursor-pointer rounded-2xl border border-white/60 bg-white/40 p-5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] backdrop-blur-xl transition-all hover:bg-white/60 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
                  >
                    {/* Banner */}
                    {world.bannerUrl && (
                      <div className="relative -mx-5 -mt-5 mb-3 h-20 overflow-hidden rounded-t-2xl">
                        <img src={world.bannerUrl} alt={world.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                      </div>
                    )}
                    
                    <div className="flex items-start gap-3">
                      {world.iconUrl ? (
                        <img src={world.iconUrl} alt={world.name} className="h-14 w-14 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-xl font-bold text-[#4ECCA3] shrink-0">
                          {world.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-semibold text-gray-900 truncate">{world.name}</h3>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                            {world.status}
                          </span>
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${world.nativeCreationState === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
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
                          <p className="mt-2 text-xs text-gray-500 line-clamp-2">{world.description}</p>
                        )}
                        
                        {/* Stats */}
                        <div className="mt-3 grid grid-cols-2 gap-1 text-[10px]">
                          <div className="bg-white/50 rounded px-2 py-1">
                            <span className="text-gray-400">{t('WorldDetail.levelShort')}</span>
                            <span className="ml-1 font-medium text-gray-700">{world.level}</span>
                          </div>
                          <div className="bg-white/50 rounded px-2 py-1">
                            <span className="text-gray-400">{t('WorldDetail.agentsShort')}</span>
                            <span className="ml-1 font-medium text-gray-700">{world.agentCount}</span>
                          </div>
                          <div className="bg-white/50 rounded px-2 py-1">
                            <span className="text-gray-400">{t('WorldDetail.nativeLimitShort')}</span>
                            <span className="ml-1 font-medium text-gray-700">{world.nativeAgentLimit}</span>
                          </div>
                          <div className="bg-white/50 rounded px-2 py-1">
                            <span className="text-gray-400">{t('WorldDetail.lorebookShort')}</span>
                            <span className="ml-1 font-medium text-gray-700">{world.lorebookEntryLimit}</span>
                          </div>
                        </div>
                        
                        {/* Scores */}
                        <div className="mt-2 flex items-center gap-1 text-[10px] flex-wrap">
                          <span className="text-gray-400">{t('WorldDetail.scoresShort')}:</span>
                          <span className="px-1 bg-blue-50 text-blue-600 rounded">A:{world.scoreA.toFixed(0)}</span>
                          <span className="px-1 bg-purple-50 text-purple-600 rounded">C:{world.scoreC.toFixed(0)}</span>
                          <span className="px-1 bg-green-50 text-green-600 rounded">E:{world.scoreE.toFixed(0)}</span>
                        </div>
                        
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
  );
}
