import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useTranslation } from 'react-i18next';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { logoutAndClearSession } from '@renderer/features/auth/logout';
import { dataSync } from '@runtime/data-sync';
import {
  PageShell,
  SectionTitle,
} from './settings-layout-components.js';

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

function estimateLocalStorageBytes(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    const value = window.localStorage.getItem(key) || '';
    total += (key.length + value.length) * 2;
  }
  return total;
}

function estimateQueryCacheBytes(): number {
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
  const clearAuthSession = useAppStore((s) => s.clearAuthSession);
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);
  const [deleting, setDeleting] = useState(false);
  const [storage, setStorage] = useState<StorageSnapshot>({
    queryCacheBytes: 0,
    localStorageBytes: 0,
    estimatedUsageBytes: 0,
    estimatedQuotaBytes: 0,
  });

  const refreshStorageSnapshot = useCallback(async () => {
    const queryCacheBytes = estimateQueryCacheBytes();
    const localStorageBytes = estimateLocalStorageBytes();
    let estimatedUsageBytes = 0;
    let estimatedQuotaBytes = 0;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        estimatedUsageBytes = Number(estimate.usage || 0);
        estimatedQuotaBytes = Number(estimate.quota || 0);
      } catch {
        estimatedUsageBytes = 0;
        estimatedQuotaBytes = 0;
      }
    }
    setStorage({
      queryCacheBytes,
      localStorageBytes,
      estimatedUsageBytes,
      estimatedQuotaBytes,
    });
  }, []);

  useEffect(() => {
    void refreshStorageSnapshot();
  }, [refreshStorageSnapshot]);

  const totalTrackedBytes = useMemo(
    () => storage.queryCacheBytes + storage.localStorageBytes + storage.estimatedUsageBytes,
    [storage.estimatedUsageBytes, storage.localStorageBytes, storage.queryCacheBytes],
  );

  const usagePercent = storage.estimatedQuotaBytes > 0
    ? Math.min(100, Math.round((storage.estimatedUsageBytes / storage.estimatedQuotaBytes) * 100))
    : 0;

  const handleClearCache = () => {
    queryClient.clear();
    setStatusBanner({ kind: 'success', message: t('DataManagement.cacheCleared') });
    void refreshStorageSnapshot();
  };

  const handleDeleteAccount = async () => {
    if (deleting) {
      return;
    }
    setDeleting(true);
    try {
      const result = await dataSync.requestAccountDeletion({
        reason: 'user_request',
      });
      if (!result.accepted) {
        setStatusBanner({
          kind: 'warning',
          message: result.message || `${result.reasonCode || 'DELETE_UNAVAILABLE'}: ${result.actionHint || 'check backend support'}`,
        });
        return;
      }
      setStatusBanner({
        kind: 'warning',
        message: result.taskId
          ? `Account deletion requested (task ${result.taskId}).`
          : t('DataManagement.deleteAccountWarning'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DataManagement.deleteRequestFailed'),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageShell title={t('DataManagement.pageTitle')} description={t('DataManagement.pageDescription')} contentClassName="max-w-4xl">
      {/* Storage Usage */}
      <section>
        <SectionTitle>{t('DataManagement.storageUsageTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="divide-y divide-gray-100">
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-gray-600">{t('DataManagement.storageChats')}</span>
              <span className="text-sm font-medium text-gray-900">{formatBytes(storage.queryCacheBytes)}</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-gray-600">{t('DataManagement.storageMediaFiles')}</span>
              <span className="text-sm font-medium text-gray-900">{formatBytes(storage.estimatedUsageBytes)}</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-gray-600">{t('DataManagement.storageCache')}</span>
              <span className="text-sm font-medium text-gray-900">{formatBytes(storage.localStorageBytes)}</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm font-medium text-gray-900">{t('DataManagement.storageTotalUsed')}</span>
              <span className="text-sm font-semibold text-mint-600">{formatBytes(totalTrackedBytes)}</span>
            </div>
          </div>
          {/* Progress Bar */}
          <div className="mt-4 rounded-xl bg-gray-50 p-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-mint-500 transition-all duration-500 ease-out"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {storage.estimatedQuotaBytes > 0
                ? `${usagePercent}% of ${formatBytes(storage.estimatedQuotaBytes)} used`
                : t('DataManagement.storageUsageFootnote')}
            </p>
          </div>
        </div>
      </section>

      {/* Clear Cache */}
      <section className="mt-8">
        <SectionTitle description={t('DataManagement.clearCacheDescription')}>
          {t('DataManagement.clearCacheTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">{t('DataManagement.clearCacheBody')}</p>
          <button
            type="button"
            onClick={handleClearCache}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300"
          >
            <TrashIcon className="h-4 w-4" />
            {t('DataManagement.clearCacheButton')}
          </button>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="mt-8">
        <SectionTitle description={t('DataManagement.dangerDescription')}>
          {t('DataManagement.dangerTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-red-100 bg-red-50/50 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <AlertTriangleIcon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-red-700">{t('DataManagement.deleteAccountTitle')}</h4>
              <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                {t('DataManagement.deleteAccountBody')}
              </p>
              <button
                type="button"
                onClick={() => { void handleDeleteAccount(); }}
                disabled={deleting}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-all hover:bg-red-50"
              >
                <TrashIcon className="h-4 w-4" />
                {deleting ? t('DataManagement.requesting') : t('DataManagement.deleteAccountButton')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Session */}
      <section className="mt-8">
        <SectionTitle>{t('DataManagement.sessionTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">{t('DataManagement.sessionBody')}</p>
          <button
            type="button"
            onClick={() => {
              void logoutAndClearSession({
                clearAuthSession,
                setStatusBanner,
              });
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300"
          >
            <LogOutIcon className="h-4 w-4" />
            {t('DataManagement.logOut')}
          </button>
        </div>
      </section>
    </PageShell>
  );
}

// Icons
function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function AlertTriangleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function LogOutIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
