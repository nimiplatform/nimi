import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { WorldDetail } from './world-detail';
import { worldDetailWithAgentsQueryKey, worldListQueryKey } from './world-detail-queries';
import { toWorldListItem } from './world-list-model';
import { WorldDetailSkeletonPage } from './world-detail-route-state';

export function WorldDetailActivePanel() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedWorldId = useAppStore((state) => state.selectedWorldId);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const cachedWorlds = queryClient.getQueryData<ReturnType<typeof toWorldListItem>[]>(worldListQueryKey());
  const cachedSelectedWorld = selectedWorldId
    ? cachedWorlds?.find((item) => item.id === selectedWorldId) ?? null
    : null;
  const cachedWorldDetail = selectedWorldId
    ? queryClient.getQueryData<Awaited<ReturnType<typeof dataSync.loadWorldDetailWithAgents>>>(
      worldDetailWithAgentsQueryKey(selectedWorldId),
    )
    : null;
  const selectedWorldFromDetailCache = cachedWorldDetail ? toWorldListItem(cachedWorldDetail) : null;

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => {
      const result = await dataSync.loadWorlds();
      return result.map((item) => toWorldListItem(item));
    },
    enabled: authStatus === 'authenticated' && Boolean(selectedWorldId),
    initialData: cachedWorlds ?? undefined,
    staleTime: 30_000,
  });

  if (!selectedWorldId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {t('WorldDetail.noWorldSelected', { defaultValue: 'No world selected' })}
      </div>
    );
  }

  const selectedWorld = worldsQuery.data?.find((item) => item.id === selectedWorldId)
    ?? cachedSelectedWorld
    ?? selectedWorldFromDetailCache
    ?? null;

  if (!selectedWorld && worldsQuery.isPending) {
    return <WorldDetailSkeletonPage />;
  }

  if (!selectedWorld && worldsQuery.isError) {
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
            className="rounded-[10px] bg-mint-500 px-4 py-2 text-sm font-medium text-white hover:bg-mint-600"
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
