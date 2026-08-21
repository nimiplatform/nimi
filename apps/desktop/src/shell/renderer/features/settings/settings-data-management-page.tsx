import { useCallback, useEffect, useMemo, useState } from 'react';
import { requestNimiRealmAccountDeletion } from '@nimiplatform/sdk/realm';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useTranslation } from 'react-i18next';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import { logoutAndClearSession, useLogoutSessionDependencies } from '../auth/logout';
import type { DesktopRendererStorageDirs } from '../../renderer/settings-port.js';
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

type StorageSnapshot = {
  queryCacheBytes: number;
  localStorageBytes: number;
  estimatedUsageBytes: number;
  estimatedQuotaBytes: number;
};

export function projectAccountDeletionConfirmationState(deleting: boolean): {
  readonly actionsDisabled: boolean;
  readonly canDismiss: boolean;
} {
  return {
    actionsDisabled: deleting,
    canDismiss: !deleting,
  };
}

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
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const [resolvedDataRoot, setResolvedDataRoot] = useState('');
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

  const totalTrackedBytes = useMemo(
    () => storage.queryCacheBytes + storage.localStorageBytes + storage.estimatedUsageBytes,
    [storage.estimatedUsageBytes, storage.localStorageBytes, storage.queryCacheBytes],
  );

  const usagePercent = storage.estimatedQuotaBytes > 0
    ? Math.min(100, Math.round((storage.estimatedUsageBytes / storage.estimatedQuotaBytes) * 100))
    : 0;
  const deleteConfirmationState = projectAccountDeletionConfirmationState(deleting);

  const handleClearCache = () => {
    queryClient.clear();
    setFeedback({ kind: 'success', message: t('DataManagement.cacheCleared') });
    void refreshStorageSnapshot();
  };

  const handleDeleteAccount = async () => {
    if (deleting) {
      return;
    }
    setDeleting(true);
    try {
      const result = await requestNimiRealmAccountDeletion(bindings.sdk.realm(), {
        reason: 'user_request',
      });
      setDeleteConfirmationOpen(false);
      if (!result.accepted) {
        setFeedback({
          kind: 'warning',
          message: result.message || `${result.reasonCode || 'DELETE_UNAVAILABLE'}: ${result.actionHint || 'check backend support'}`,
        });
        return;
      }
      setFeedback({
        kind: 'warning',
        message: result.taskId
          ? t('DataManagement.deleteAccountRequested', { taskId: result.taskId })
          : t('DataManagement.deleteAccountWarning'),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DataManagement.deleteRequestFailed'),
      });
    } finally {
      setDeleting(false);
    }
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

      {/* Danger Zone */}
      <Section title={t('DataManagement.dangerTitle')}>
        <Card>
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]">
              <AlertTriangleIcon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h4 className="text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-status-danger)]">{t('DataManagement.deleteAccountTitle')}</h4>
              <p className="mt-1 text-[length:var(--nimi-type-caption-size)] leading-relaxed text-[var(--nimi-text-secondary)]">
                {t('DataManagement.deleteAccountBody')}
              </p>
              <Button
                variant="danger"
                className="mt-4"
                icon={<TrashIcon className="h-4 w-4" />}
                onClick={() => setDeleteConfirmationOpen(true)}
                disabled={deleteConfirmationState.actionsDisabled}
              >
                {deleting ? t('DataManagement.requesting') : t('DataManagement.deleteAccountButton')}
              </Button>
            </div>
          </div>
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

      <ConfirmDialog
        open={deleteConfirmationOpen}
        title={t('DataManagement.deleteAccountTitle')}
        message={t('DataManagement.deleteAccountDialogMessage')}
        confirmLabel={t('DataManagement.deleteAccountConfirmButton')}
        cancelLabel={t('DataManagement.deleteAccountCancelButton')}
        confirmTone="danger"
        pending={deleting}
        pendingLabel={t('DataManagement.requesting')}
        onConfirm={() => { void handleDeleteAccount(); }}
        onClose={() => {
          if (deleteConfirmationState.canDismiss) {
            setDeleteConfirmationOpen(false);
          }
        }}
      />
    </PageShell>
  );
}

// Icons
function AlertTriangleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
