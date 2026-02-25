import React from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useTranslation } from 'react-i18next';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { logoutAndClearSession } from '@renderer/features/auth/logout';
import {
  PageShell,
  SectionTitle,
} from '../../settings-layout-components';

export function DataManagementPage() {
  const { t } = useTranslation();
  const clearAuthSession = useAppStore((s) => s.clearAuthSession);
  const setStatusBanner = useAppStore((s) => s.setStatusBanner);

  const handleExport = () => {
    setStatusBanner({ kind: 'info', message: t('DataManagement.exportStarted') });
  };

  const handleClearCache = () => {
    queryClient.clear();
    setStatusBanner({ kind: 'success', message: t('DataManagement.cacheCleared') });
  };

  const handleDeleteAccount = () => {
    setStatusBanner({ kind: 'warning', message: t('DataManagement.deleteAccountWarning') });
  };

  // Storage data
  const storageItems = [
    { label: t('DataManagement.storageChats'), value: '12.4 MB' },
    { label: t('DataManagement.storageMediaFiles'), value: '48.7 MB' },
    { label: t('DataManagement.storageCache'), value: '8.2 MB' },
  ];

  return (
    <PageShell title={t('DataManagement.pageTitle')} description={t('DataManagement.pageDescription')}>
      {/* Storage Usage */}
      <section>
        <SectionTitle>{t('DataManagement.storageUsageTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="divide-y divide-gray-50">
            {storageItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between py-3">
                <span className="text-sm text-gray-600">{item.label}</span>
                <span className="text-sm font-medium text-gray-900">{item.value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between py-3">
              <span className="text-sm font-medium text-gray-900">{t('DataManagement.storageTotalUsed')}</span>
              <span className="text-sm font-semibold text-mint-600">{t('DataManagement.storageTotalUsedValue')}</span>
            </div>
          </div>
          {/* Progress Bar */}
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full w-[35%] rounded-full bg-gradient-to-r from-mint-400 to-mint-500" />
            </div>
            <p className="mt-2 text-xs text-gray-500">{t('DataManagement.storageUsageFootnote')}</p>
          </div>
        </div>
      </section>

      {/* Export Data */}
      <section className="mt-8">
        <SectionTitle description={t('DataManagement.exportDescription')}>
          {t('DataManagement.exportTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">{t('DataManagement.exportBody')}</p>
          <button
            type="button"
            onClick={handleExport}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300"
          >
            <DownloadIcon className="h-4 w-4" />
            {t('DataManagement.exportButton')}
          </button>
        </div>
      </section>

      {/* Clear Cache */}
      <section className="mt-8">
        <SectionTitle description={t('DataManagement.clearCacheDescription')}>
          {t('DataManagement.clearCacheTitle')}
        </SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
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
                onClick={handleDeleteAccount}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 shadow-sm transition-all hover:bg-red-50"
              >
                <TrashIcon className="h-4 w-4" />
                {t('DataManagement.deleteAccountButton')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Session */}
      <section className="mt-8">
        <SectionTitle>{t('DataManagement.sessionTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
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
function DownloadIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

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
