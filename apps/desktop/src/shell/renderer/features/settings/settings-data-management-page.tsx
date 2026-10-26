import { SupportAppHostCacheCard } from '../support/support-storage-tools.js';
import { useProductUpdate } from '../home/product-update-context.js';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  DesktopRendererCheckSyncProjection,
  DesktopRendererStorageDirs,
} from '../../renderer/settings-port.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  Button,
  Card,
  FormFeedback,
  InfoRow,
  PageShell,
  Section,
} from './settings-layout-components.js';
import { TrashIcon } from './settings-assets.js';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { isExecutableCheckSyncNextAction } from '../../../shared/check-sync-next-action.js';
import { useCheckSyncPolling } from './check-sync-polling.js';

type StorageSnapshot = {
  queryCacheBytes: number;
  localStorageBytes: number;
  estimatedUsageBytes: number;
  estimatedQuotaBytes: number;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function estimateQueryCacheBytes(queryClient: QueryClient): number {
  const queries = queryClient.getQueryCache().findAll();
  let total = 0;
  for (const query of queries) {
    try {
      total += JSON.stringify(query.state.data ?? null).length * 2;
    } catch {
      total += 0;
    }
  }
  return total;
}

export function DataManagementPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bindings = useDesktopRendererBindings();
  const update = useProductUpdate();
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const [resolvedDataRoot, setResolvedDataRoot] = useState('');
  const [checkSync, setCheckSync] = useState<DesktopRendererCheckSyncProjection | null>(null);
  const [dataRootBusy, setDataRootBusy] = useState(false);
  const [pendingDataRoot, setPendingDataRoot] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageSnapshot | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [dirsError, setDirsError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refreshStorageSnapshot = useCallback(async () => {
    setStorage(null);
    setStorageError(null);
    const queryCacheBytes = estimateQueryCacheBytes(queryClient);
    try {
      const usage = await bindings.app.commands.settings.estimateStorageUsage();
      setStorage({ queryCacheBytes, ...usage });
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'DESKTOP_STORAGE_ESTIMATE_UNAVAILABLE');
    }
  }, [bindings.app.commands.settings, queryClient]);

  useEffect(() => {
    void refreshStorageSnapshot();
  }, [refreshStorageSnapshot]);

  const applyStorageDirs = useCallback((dirs: DesktopRendererStorageDirs) => {
    setResolvedDataRoot(dirs.dataRoot);
  }, []);

  const refreshDirs = useCallback(async () => {
    setDirsError(null);
    setResolvedDataRoot('');
    try { applyStorageDirs(await bindings.app.commands.settings.loadStorageDirs()); }
    catch (error) { setDirsError(error instanceof Error ? error.message : String(error)); }
  }, [applyStorageDirs, bindings.app.commands.settings]);
  useEffect(() => { void refreshDirs(); }, [refreshDirs]);

  const refreshCheckSync = useCallback(async () => {
    try {
      const projection = await bindings.app.commands.settings.loadCheckSync();
      setCheckSync(projection); setSyncError(null); return projection;
    } catch (error) { setSyncError(error instanceof Error ? error.message : String(error)); throw error; }
  }, [bindings.app.commands.settings]);

  useEffect(() => {
    void refreshCheckSync().catch(() => undefined);
  }, [refreshCheckSync]);

  useCheckSyncPolling(checkSync?.run?.state === 'running', refreshCheckSync);

  // Choosing a directory only proposes it; the switch stops apps and restarts
  // Nimi, so it runs after the user confirms those consequences.
  const handlePickDataRoot = useCallback(async () => {
    setFeedback(null);
    try {
      const targetRoot = await bindings.app.commands.settings.pickDataRootDirectory();
      if (targetRoot) setPendingDataRoot(targetRoot);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: t('DataManagement.dataRootReplaceFailed'),
        technicalDetail: error instanceof Error ? error.message : String(error || ''),
      });
    }
  }, [bindings.app.commands.settings, t]);

  const handleReplaceDataRoot = useCallback(async (targetRoot: string) => {
    setPendingDataRoot(null);
    setDataRootBusy(true);
    setFeedback(null);
    try {
      const projection = await bindings.app.commands.settings.replaceDataRoot(targetRoot);
      let refreshError: string | null = null;
      try {
        const storageDirs = await bindings.app.commands.settings.loadStorageDirs();
        applyStorageDirs(storageDirs);
        await refreshCheckSync();
      } catch (error) { refreshError = error instanceof Error ? error.message : String(error); }
      if (projection.auditDiagnostic) {
        setFeedback({ kind: 'warning', message: t('DataManagement.dataRootReplacedAuditUnrecorded'), technicalDetail: projection.auditDiagnostic.reasonCode });
      } else if (projection.error || refreshError) {
        setFeedback({ kind: projection.activation?.activated ? 'warning' : 'error', message: t(projection.activation?.activated ? 'DataManagement.dataRootReplaced' : 'DataManagement.dataRootReplaceFailed'), technicalDetail: projection.error ?? refreshError ?? undefined });
      } else if (projection.activation?.activated) {
        setFeedback({ kind: 'success', message: t('DataManagement.dataRootReplaced') });
      } else {
        setFeedback({ kind: 'success', message: t('DataManagement.dataRootUnchanged') });
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: t('DataManagement.dataRootReplaceFailed'),
        technicalDetail: error instanceof Error ? error.message : String(error || ''),
      });
    } finally {
      setDataRootBusy(false);
    }
  }, [applyStorageDirs, bindings.app.commands.settings, refreshCheckSync, t]);

  const handleCheckSync = useCallback(async () => {
    setDataRootBusy(true);
    setFeedback(null);
    try {
      setCheckSync(await bindings.app.commands.settings.startCheckSync());
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DataManagement.checkSyncFailed'),
      });
    } finally {
      setDataRootBusy(false);
    }
  }, [bindings.app.commands.settings, t]);

  const handleClearCache = () => {
    queryClient.clear();
    setFeedback({ kind: 'success', message: t('DataManagement.cacheCleared') });
    void refreshStorageSnapshot();
  };

  return (
    <PageShell title={t('DataManagement.pageTitle')} description={t('DataManagement.pageDescription')}>
      {feedback ? (
        <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} className="mb-6" />
      ) : null}
      {/* Storage Usage */}
      <Section title={t('DataManagement.storageUsageTitle')}>
        <Card>
          {!storage ? <div role={storageError ? 'alert' : 'status'} className="space-y-2 text-sm">
            <p>{t(storageError ? 'DataManagement.storageReadFailed' : 'Common.loading')}</p>
            {storageError ? <Button variant="secondary" onClick={() => { void refreshStorageSnapshot(); }}>{t('Common.retry')}</Button> : null}
          </div> : <div className="divide-y divide-[var(--nimi-border-subtle)]">
            <InfoRow label={t('DataManagement.storageChats')} value={formatBytes(storage.queryCacheBytes)} />
            <InfoRow label={t('DataManagement.storageMediaFiles')} value={formatBytes(storage.estimatedUsageBytes)} />
            <InfoRow label={t('DataManagement.storageCache')} value={formatBytes(storage.localStorageBytes)} />
          </div>}
          <p className="mt-3 text-xs text-[var(--nimi-text-muted)]">{t('DataManagement.separateStorageScopes')}</p>
        </Card>
      </Section>

      <Section title={t('DataManagement.dataDirTitle')}>
        {dirsError ? <div role="alert" className="text-sm"><p>{t('DataManagement.dataRootReadFailed')}</p><Button variant="secondary" onClick={() => { void refreshDirs(); }}>{t('Common.retry')}</Button></div> : null}
        {syncError ? <div role="alert" className="text-sm"><p>{t('DataManagement.checkSyncReadFailed')}</p><Button variant="secondary" onClick={() => { void refreshCheckSync().catch(() => undefined); }}>{t('Common.retry')}</Button></div> : null}
        <Card>
          <div className="space-y-4">
            <div className="space-y-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
              <p>{t('DataManagement.dataRootLabel')}: <span className="break-all text-[var(--nimi-text-secondary)]">{resolvedDataRoot || '-'}</span></p>
            </div>
            <p className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning)]">
              {t('DataManagement.dataDirHelp')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={dataRootBusy}
                onClick={() => { void handlePickDataRoot(); }}
              >
                {t('DataManagement.replaceDataRootButton')}
              </Button>
              <Button
                variant="secondary"
                disabled={dataRootBusy || !resolvedDataRoot}
                onClick={() => { void handleCheckSync(); }}
              >
                {t('DataManagement.checkSyncButton')}
              </Button>
            </div>
            {dataRootBusy ? (
              <p role="status" className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                {t('DataManagement.replaceDataRootProgress')}
              </p>
            ) : null}
            <ConfirmDialog
              open={pendingDataRoot !== null}
              title={t('DataManagement.replaceDataRootConfirmTitle')}
              message={t('DataManagement.replaceDataRootConfirmBody', { target: pendingDataRoot ?? '', current: resolvedDataRoot || '-' })}
              confirmLabel={t('DataManagement.replaceDataRootConfirm')}
              cancelLabel={t('DataManagement.replaceDataRootCancel')}
              confirmTone="danger"
              onConfirm={() => { if (pendingDataRoot) void handleReplaceDataRoot(pendingDataRoot); }}
              onClose={() => setPendingDataRoot(null)}
            />
            {checkSync?.run ? (
              <div className="space-y-3 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] p-4" data-testid="data-management-check-sync">
                <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">
                  {t('DataManagement.checkSyncState', { state: checkSync.run.state })}
                </p>
                {checkSync.run.owners.map((owner) => (
                  <div key={owner.ownerId} className="space-y-1 border-t border-[var(--nimi-border-subtle)] pt-2">
                    <p className="text-xs font-medium text-[var(--nimi-text-primary)]">
                      {owner.ownerId} · {t(`DataManagement.checkSyncOwnerState.${owner.state}`)}
                    </p>
                    {owner.resources.map((resource, index) => (
                      <div
                        key={`${resource.kind}-${resource.reference ?? resource.locator ?? index}`}
                        className="space-y-1"
                        data-check-sync-next-action={resource.nextAction}
                      >
                        <p className="text-xs text-[var(--nimi-text-secondary)]">
                          {resource.nextAction === 'run_local_model_offline_conversion'
                            ? t('DataManagement.checkSyncModelOfflineConversion')
                            : t(`DataManagement.checkSyncResourceStatus.${resource.status}`)}
                        </p>
                        <details className="text-xs text-[var(--nimi-text-muted)]">
                          <summary className="cursor-pointer">{t('DataManagement.checkSyncTechnicalDetails')}</summary>
                          <p className="mt-1 break-all">
                            {[resource.kind, resource.reference ?? resource.locator, resource.status, resource.reason, resource.nextAction]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </details>
                        {resource.nextAction && isExecutableCheckSyncNextAction(resource.nextAction) ? (
                          <Button
                            variant="secondary"
                            disabled={dataRootBusy}
                            onClick={() => { void handleCheckSync(); }}
                          >
                            {t('DataManagement.checkSyncRerun')}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
                {checkSync.run.unclaimed.map((entry) => (
                  <p key={entry.locator} className="break-all text-xs text-[var(--nimi-status-warning)]">
                    {entry.locator}: {entry.status} · {entry.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </Section>

      {/* Clear Cache */}
      <Section title={t('DataManagement.clearCacheTitle')}>
        <Card>
          <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">{t('DataManagement.clearCacheBody')}</p>
          <Button
            variant="secondary"
            className="mt-4"
            icon={<TrashIcon className="h-4 w-4" />}
            onClick={handleClearCache}
          >
            {t('DataManagement.clearCacheButton')}
          </Button>
        </Card>
      </Section>

      <SupportAppHostCacheCard />
      {update.status?.maintenanceAvailable ? <Section title={t('DataManagement.productVersions')}>
        <Card><Button variant="secondary" disabled={update.busy} onClick={update.openDetails}>{t('ProductUpdate.retention.open')}</Button></Card>
      </Section> : null}

    </PageShell>
  );
}
