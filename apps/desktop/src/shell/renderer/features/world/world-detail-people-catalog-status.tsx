import { useTranslation } from 'react-i18next';
import { EmptyState } from '@nimiplatform/kit/ui';
import { formatNum } from './world-detail-template-model.js';
import type { WorldPeopleCatalogState } from './world-detail-types.js';

const actionButtonStyle = {
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--nimi-action-primary-bg)',
  border: '1px solid var(--nimi-border-subtle)',
  borderRadius: 999,
  background: 'var(--nimi-surface-card)',
  padding: '8px 16px',
  cursor: 'pointer',
} as const;

// Shown in place of the people list until the first page of the current query is ready: a
// loading, offline or failed first page is never presented as an empty World.
export function PeopleCatalogFirstPageStatus({ catalog }: { readonly catalog: WorldPeopleCatalogState }) {
  const { t } = useTranslation();
  if (catalog.status === 'offline') {
    // The page is waiting for the connection and loads by itself once it returns.
    return (
      <EmptyState
        data-testid="world-people-catalog-offline"
        role="status"
        title={t('WorldDetail.paper.gallery.peopleWaitingForNetwork')}
        style={{ margin: '36px 20px' }}
      />
    );
  }
  if (catalog.status === 'loading') {
    return (
      <EmptyState
        data-testid="world-people-catalog-loading"
        title={t('WorldDetail.paper.gallery.loadingPeople')}
        style={{ margin: '36px 20px' }}
      />
    );
  }
  if (catalog.status === 'error') {
    return (
      <EmptyState
        data-testid="world-people-catalog-error"
        role="alert"
        title={catalog.offline ? t('WorldDetail.paper.gallery.loadFailedOffline') : t('WorldDetail.paper.gallery.loadFailed')}
        action={(
          <button type="button" onClick={catalog.onRetry} style={actionButtonStyle}>
            {t('WorldDetail.paper.gallery.retry')}
          </button>
        )}
        style={{ margin: '36px 20px' }}
      />
    );
  }
  return null;
}

// The next-page control. A failed, offline or waiting next page keeps the loaded people and
// states why nothing more arrived; the list never ends while the catalog still has more.
export function PeopleCatalogMoreControl({
  catalog,
  loadedCount,
}: {
  readonly catalog: WorldPeopleCatalogState;
  readonly loadedCount: number;
}) {
  const { t } = useTranslation();
  if (catalog.status !== 'ready' || !catalog.hasMore) {
    return null;
  }
  const failedOffline = catalog.loadMoreFailed && catalog.offline;
  return (
    <div
      data-testid="world-detail-people-load-more"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 16 }}
    >
      {catalog.loadMorePaused ? (
        <span role="status" style={{ fontSize: 12, color: 'var(--nimi-text-secondary)' }}>
          {t('WorldDetail.paper.gallery.loadMoreWaiting')}
        </span>
      ) : catalog.loadMoreFailed ? (
        <span role="status" style={{ fontSize: 12, color: 'var(--nimi-status-danger)' }}>
          {failedOffline ? t('WorldDetail.paper.gallery.loadMoreOffline') : t('WorldDetail.paper.gallery.loadMoreError')}
        </span>
      ) : null}
      <button
        type="button"
        disabled={catalog.loadingMore || catalog.loadMorePaused}
        onClick={catalog.onLoadMore}
        style={{ ...actionButtonStyle, cursor: catalog.loadingMore || catalog.loadMorePaused ? 'default' : 'pointer' }}
      >
        {catalog.loadingMore
          ? t('WorldDetail.paper.gallery.loadingMore')
          : catalog.loadMoreFailed
            ? t('WorldDetail.paper.gallery.retry')
            : t('WorldDetail.paper.gallery.loadMore', {
              loaded: formatNum(loadedCount),
              total: formatNum(catalog.totalCount),
            })}
      </button>
    </div>
  );
}
