import { useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { WorldDetail } from './world-detail';
import { WorldDetailLoadingState } from './world-detail-template';
import { fetchWorldDisplayDetail, worldDisplayDetailQueryKey } from './world-detail-queries';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { createRealmWorldData } from './data/realm-world-data.js';

export function WorldDetailActivePanel() {
  const navigation = useHomeNavigation();
  const sdk = useDesktopRendererSdk();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedWorldId = useHomeDestination().worldId ?? null;
  const selectedWorldInitialSubpage = useHomeDestination().worldSubpage ?? null;

  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const detail = useQuery({
    queryKey: worldDisplayDetailQueryKey(realmBaseUrl, selectedWorldId ?? ''),
    queryFn: () => fetchWorldDisplayDetail(selectedWorldId!, createRealmWorldData(sdk)),
    enabled: authStatus === 'authenticated' && Boolean(selectedWorldId),
    staleTime: 30_000,
  });

  if (!selectedWorldId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--nimi-text-muted)]">
        {t('WorldDetail.noWorldSelected', { defaultValue: 'No world selected' })}
      </div>
    );
  }

  if (!detail.data && detail.isPending) {
    return <WorldDetailLoadingState />;
  }

  if (!detail.data && detail.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--nimi-surface-canvas)]">
        <span className="text-sm text-[var(--nimi-status-danger)]">
          {t('WorldDetail.error', { defaultValue: 'Failed to load world details' })}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void detail.refetch();
            }}
            className="rounded-[10px] bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-sm font-medium text-[var(--nimi-action-primary-text)] hover:bg-[var(--nimi-action-primary-bg-hover)]"
          >
            {t('NotificationPanel.refresh', { defaultValue: 'Refresh' })}
          </button>
          <button
            type="button"
            onClick={navigation.back}
            className="rounded-[10px] bg-[var(--nimi-surface-panel)] px-4 py-2 text-sm font-medium text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-active)]"
          >
            {t('WorldDetail.backToList', { defaultValue: 'Back to List' })}
          </button>
        </div>
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--nimi-surface-canvas)]">
        <span className="text-sm text-[var(--nimi-text-muted)]">
          {t('WorldDetail.notFound', { defaultValue: 'World not found' })}
        </span>
        <button
          type="button"
          onClick={navigation.back}
          className="rounded-[10px] bg-[var(--nimi-surface-panel)] px-4 py-2 text-sm font-medium text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-active)]"
        >
          {t('WorldDetail.backToList', { defaultValue: 'Back to List' })}
        </button>
      </div>
    );
  }

  return <WorldDetail key={selectedWorldId} detail={detail.data} onRetry={() => { void detail.refetch(); }} onBack={navigation.back} initialSubpage={selectedWorldInitialSubpage} />;
}
