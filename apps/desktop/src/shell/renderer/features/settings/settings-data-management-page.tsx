import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useTranslation } from 'react-i18next';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { logoutAndClearSession, useLogoutSessionDependencies } from '../auth/logout';
import type {
  DesktopRendererCheckSyncProjection,
  DesktopRendererStorageDirs,
} from '../../renderer/settings-port.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  Button,
  Card,
  FormFeedback,
  InfoRow,
  PageShell,
  Section,
} from './settings-layout-components.js';
import { LogOutIcon, TrashIcon } from './settings-assets.js';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { isExecutableCheckSyncNextAction } from '../../../shared/check-sync-next-action.js';

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
  const clearAuthSession = useAppStore((s) => s.clearAuthSession);
  const logoutDependencies = useLogoutSessionDependencies();
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const [resolvedDataRoot, setResolvedDataRoot] = useState('');
  const [checkSync, setCheckSync] = useState<DesktopRendererCheckSyncProjection | null>(null);
  const [dataRootBusy, setDataRootBusy] = useState(false);
  const [pendingDataRoot, setPendingDataRoot] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageSnapshot>({
    queryCacheBytes: 0,
    localStorageBytes: 0,
    estimatedUsageBytes: 0,
    estimatedQuotaBytes: 0,
  });

  const refreshStorageSnapshot = useCallback(async () => {
    const queryCacheBytes = estimateQueryCacheBytes(queryClient);
    try {
      const usage = await bindings.app.commands.settings.estimateStorageUsage();
      setStorage({ queryCacheBytes, ...usage });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'DESKTOP_STORAGE_ESTIMATE_UNAVAILABLE',
      });
    }
  }, [bindings.app.commands.settings, queryClient]);

  useEffect(() => {
    void refreshStorageSnapshot();
  }, [refreshStorageSnapshot]);

  const applyStorageDirs = useCallback((dirs: DesktopRendererStorageDirs) => {
    setResolvedDataRoot(dirs.dataRoot);
  }, []);

  useEffect(() => {
    void bindings.app.commands.settings.loadStorageDirs()
      .then(applyStorageDirs)
      .catch((error) => {
        logRendererEvent({
          level: 'warn',
          area: 'settings-data-management',
          message: 'get-desktop-storage-dirs:failed',
          details: {
            error: error instanceof Error ? error.message : String(error || ''),
          },
        });
      });
  }, [applyStorageDirs, bindings.app.commands.settings]);

  const refreshCheckSync = useCallback(async () => {
    const projection = await bindings.app.commands.settings.loadCheckSync();
    setCheckSync(projection);
    return projection;
  }, [bindings.app.commands.settings]);

  useEffect(() => {
    void refreshCheckSync().catch(() => undefined);
  }, [refreshCheckSync]);

  useEffect(() => {
    if (checkSync?.run?.state !== 'running') return undefined;
    const timeout = window.setTimeout(() => {
      void refreshCheckSync().catch(() => undefined);
    }, 1_000);
    return () => window.clearTimeout(timeout);
  }, [checkSync?.run?.state, refreshCheckSync]);

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
      const storageDirs = await bindings.app.commands.settings.loadStorageDirs();
      applyStorageDirs(storageDirs);
      await refreshCheckSync().catch(() => undefined);
      if (projection.error) {
        setFeedback({ kind: 'error', message: t('DataManagement.dataRootReplaceFailed'), technicalDetail: projection.error });
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

  const totalTrackedBytes = useMemo(
    () => storage.queryCacheBytes + storage.localStorageBytes + storage.estimatedUsageBytes,
    [storage.estimatedUsageBytes, storage.localStorageBytes, storage.queryCacheBytes],
  );

  const usagePercent = storage.estimatedQuotaBytes > 0
    ? Math.min(100, Math.round((storage.estimatedUsageBytes / storage.estimatedQuotaBytes) * 100))
    : 0;
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
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            <InfoRow label={t('DataManagement.storageChats')} value={formatBytes(storage.queryCacheBytes)} />
            <InfoRow label={t('DataManagement.storageMediaFiles')} value={formatBytes(storage.estimatedUsageBytes)} />
            <InfoRow label={t('DataManagement.storageCache')} value={formatBytes(storage.localStorageBytes)} />
            <InfoRow label={t('DataManagement.storageTotalUsed')} value={formatBytes(totalTrackedBytes)} highlight />
          </div>
          {/* Progress Bar */}
          <div className="mt-4 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] p-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--nimi-surface-active)]">
              <div
                className="h-full rounded-full bg-[var(--nimi-action-primary-bg)] transition-all duration-500 ease-out"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <p className="mt-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
              {storage.estimatedQuotaBytes > 0
                ? t('DataManagement.storageUsageSummary', {
                  percent: usagePercent,
                  quota: formatBytes(storage.estimatedQuotaBytes),
                })
                : t('DataManagement.storageUsageFootnote')}
            </p>
          </div>
        </Card>
      </Section>

      <Section title={t('DataManagement.dataDirTitle')}>
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

      {/* Session */}
      <Section title={t('DataManagement.sessionTitle')}>
        <Card>
          <p className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">{t('DataManagement.sessionBody')}</p>
          <Button
            variant="secondary"
            className="mt-4"
            icon={<LogOutIcon className="h-4 w-4" />}
            onClick={() => {
              void logoutAndClearSession(
                {
                  clearAuthSession,
                  onFeedback: setFeedback,
                },
                logoutDependencies.logout,
              );
            }}
          >
            {t('DataManagement.logOut')}
          </Button>
        </Card>
      </Section>

    </PageShell>
  );
}
