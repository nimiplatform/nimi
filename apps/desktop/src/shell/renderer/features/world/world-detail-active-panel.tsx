import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { WorldDetail } from './world-detail';
import { worldListQueryKey } from './world-detail-queries';
import { toWorldListItem, type WorldListItem } from './world-list-model';

function createPlaceholderWorld(worldId: string): WorldListItem {
  return {
    id: worldId,
    name: 'Loading World',
    description: null,
    genre: null,
    themes: [],
    era: null,
    iconUrl: null,
    bannerUrl: null,
    type: 'CREATOR',
    status: 'DRAFT',
    level: 1,
    levelUpdatedAt: null,
    agentCount: 0,
    createdAt: '',
    updatedAt: null,
    creatorId: null,
    freezeReason: null,
    lorebookEntryLimit: 0,
    nativeAgentLimit: 0,
    nativeCreationState: 'OPEN',
    scoreA: 0,
    scoreC: 0,
    scoreE: 0,
    scoreEwma: 0,
    scoreQ: 0,
    transitInLimit: 0,
    agents: [],
    computed: {
      time: {
        currentWorldTime: null,
        currentLabel: null,
        eraLabel: null,
        flowRatio: 1,
        isPaused: false,
      },
      languages: {
        primary: null,
        common: [],
      },
      entry: {
        recommendedAgents: [],
      },
      score: {
        scoreEwma: 0,
      },
      featuredAgentCount: 0,
    },
  };
}

export function WorldDetailActivePanel() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedWorldId = useAppStore((state) => state.selectedWorldId);
  const navigateBack = useAppStore((state) => state.navigateBack);

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => {
      const result = await dataSync.loadWorlds();
      return Array.isArray(result)
        ? result.map((item) => toWorldListItem(item as Record<string, unknown>))
        : [];
    },
    enabled: authStatus === 'authenticated' && Boolean(selectedWorldId),
    staleTime: 30_000,
  });

  const selectedWorld = useMemo<WorldListItem | null>(() => {
    if (!selectedWorldId) {
      return null;
    }
    const worlds = worldsQuery.data || [];
    const matched = worlds.find((item) => item.id === selectedWorldId) || null;
    if (matched) {
      return matched;
    }
    if (worldsQuery.isSuccess) {
      return null;
    }
    return createPlaceholderWorld(selectedWorldId);
  }, [selectedWorldId, worldsQuery.data, worldsQuery.isSuccess]);

  if (!selectedWorldId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {t('WorldDetail.noWorldSelected', { defaultValue: 'No world selected' })}
      </div>
    );
  }

  if (worldsQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-gray-50">
        <span className="text-sm text-red-600">
          {t('WorldDetail.error', { defaultValue: 'Failed to load world details' })}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void worldsQuery.refetch();
            }}
            className="rounded-[10px] bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            {t('NotificationPanel.refresh', { defaultValue: 'Refresh' })}
          </button>
          <button
            type="button"
            onClick={navigateBack}
            className="rounded-[10px] bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            {t('WorldDetail.backToList', { defaultValue: 'Back to List' })}
          </button>
        </div>
      </div>
    );
  }

  if (!selectedWorld) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-gray-50">
        <span className="text-sm text-gray-500">
          {t('WorldDetail.notFound', { defaultValue: 'World not found' })}
        </span>
        <button
          type="button"
          onClick={navigateBack}
          className="rounded-[10px] bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          {t('WorldDetail.backToList', { defaultValue: 'Back to List' })}
        </button>
      </div>
    );
  }

  return <WorldDetail world={selectedWorld} onBack={navigateBack} />;
}
