import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';

type WorldListItem = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  type: string;
  status: string;
  level: number;
  agentCount: number;
  createdAt: string;
};

function getStatusBadgeStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case 'ACTIVE':
      return { bg: 'bg-green-100', text: 'text-green-700' };
    case 'DRAFT':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'PENDING_REVIEW':
      return { bg: 'bg-blue-100', text: 'text-blue-700' };
    case 'SUSPENDED':
      return { bg: 'bg-red-100', text: 'text-red-700' };
    case 'ARCHIVED':
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
  }
}

function toWorldListItem(raw: Record<string, unknown>): WorldListItem {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Unknown World'),
    description: typeof raw.description === 'string' ? raw.description : null,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    type: typeof raw.type === 'string' ? raw.type : 'SUB',
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
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
              <div className="relative flex items-center gap-4">
                {mainWorld.iconUrl ? (
                  <img src={mainWorld.iconUrl} alt={mainWorld.name} className="h-20 w-20 rounded-2xl object-cover" />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-3xl font-bold text-[#4ECCA3]">
                    {mainWorld.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">{mainWorld.name}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeStyle(mainWorld.status).bg} ${getStatusBadgeStyle(mainWorld.status).text}`}>
                      {mainWorld.status}
                    </span>
                  </div>
                  {mainWorld.description && (
                    <p className="mt-1 text-sm text-gray-600 line-clamp-2">{mainWorld.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
                    <span>{t('WorldDetail.level', { level: mainWorld.level })}</span>
                    <span>•</span>
                    <span>{t('WorldDetail.agents', { count: mainWorld.agentCount })}</span>
                  </div>
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
                    <div className="flex items-start gap-3">
                      {world.iconUrl ? (
                        <img src={world.iconUrl} alt={world.name} className="h-14 w-14 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-xl font-bold text-[#4ECCA3] shrink-0">
                          {world.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-gray-900 truncate">{world.name}</h3>
                        </div>
                        <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {world.status}
                        </span>
                        {world.description && (
                          <p className="mt-2 text-xs text-gray-500 line-clamp-2">{world.description}</p>
                        )}
                        <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                          <span>{t('WorldDetail.levelShort', { level: world.level })}</span>
                          <span>•</span>
                          <span>{t('WorldDetail.agents', { count: world.agentCount })}</span>
                        </div>
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
