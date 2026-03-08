import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { PageShell, SectionTitle } from './settings-layout-components';

function formatBoolean(value: boolean, yes: string, no: string): string {
  return value ? yes : no;
}

export function DeveloperPage() {
  const { t } = useTranslation();
  const auth = useAppStore((state) => state.auth);
  const activeTab = useAppStore((state) => state.activeTab);
  const selectedWorldId = useAppStore((state) => state.selectedWorldId);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const runtimeFields = useAppStore((state) => state.runtimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);

  const snapshot = useMemo(() => ({
    authStatus: auth.status,
    hasAccessToken: Boolean(auth.token),
    hasRefreshToken: Boolean(auth.refreshToken),
    activeTab,
    selectedWorldId,
    selectedChatId,
    runtimeFields,
    generatedAt: new Date().toISOString(),
  }), [activeTab, auth.refreshToken, auth.status, auth.token, runtimeFields, selectedChatId, selectedWorldId]);

  const copySnapshot = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setStatusBanner({
        kind: 'success',
        message: t('DeveloperSettings.snapshotCopied'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.snapshotCopyFailed'),
      });
    }
  };

  return (
    <PageShell
      title={t('DeveloperSettings.pageTitle')}
      description={t('DeveloperSettings.pageDescription')}
    >
      <section>
        <SectionTitle>{t('DeveloperSettings.sessionSnapshotTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="space-y-2 text-sm text-gray-700">
            <p>
              <span className="font-semibold text-gray-900">{t('DeveloperSettings.authStatusLabel')}</span>
              {' '}
              {auth.status}
            </p>
            <p>
              <span className="font-semibold text-gray-900">{t('DeveloperSettings.hasAccessTokenLabel')}</span>
              {' '}
              {formatBoolean(
                Boolean(auth.token),
                t('DeveloperSettings.booleanTrue'),
                t('DeveloperSettings.booleanFalse'),
              )}
            </p>
            <p>
              <span className="font-semibold text-gray-900">{t('DeveloperSettings.hasRefreshTokenLabel')}</span>
              {' '}
              {formatBoolean(
                Boolean(auth.refreshToken),
                t('DeveloperSettings.booleanTrue'),
                t('DeveloperSettings.booleanFalse'),
              )}
            </p>
            <p>
              <span className="font-semibold text-gray-900">{t('DeveloperSettings.activeTabLabel')}</span>
              {' '}
              {activeTab}
            </p>
            <p>
              <span className="font-semibold text-gray-900">{t('DeveloperSettings.selectedChatLabel')}</span>
              {' '}
              {selectedChatId || '-'}
            </p>
            <p>
              <span className="font-semibold text-gray-900">{t('DeveloperSettings.selectedWorldLabel')}</span>
              {' '}
              {selectedWorldId || '-'}
            </p>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>{t('DeveloperSettings.debugHelpersTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-600">
            {t('DeveloperSettings.debugHelpersDescription')}
          </p>
          <button
            type="button"
            onClick={() => { void copySnapshot(); }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-300"
          >
            {t('DeveloperSettings.copySnapshotButton')}
          </button>
        </div>
      </section>
    </PageShell>
  );
}
